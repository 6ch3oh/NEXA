"""Local-first Works/Media application service.

The database owns identities and relationships. User media stays at its original
absolute path unless the operator explicitly enables and invokes the restricted
move operation.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


WORKS_CONTRACT_VERSION = "0.1"
SUPPORTED_IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"})
SUPPORTED_VIDEO_EXTENSIONS = frozenset({".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"})


class WorkMediaType(str, Enum):
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"


class WorkLocationState(str, Enum):
    MANAGED = "MANAGED"
    EXTERNAL = "EXTERNAL"
    MISSING = "MISSING"


class WorksError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class MediaItem:
    media_id: str
    work_id: str
    media_type: WorkMediaType
    absolute_path: str
    created_at: datetime
    order_index: int
    size_bytes: int
    extension: str
    identity_hint: str
    location_state: WorkLocationState


@dataclass(frozen=True)
class Work:
    work_id: str
    title: str
    created_at: datetime
    portfolio: bool
    cover_media_id: str
    source_kind: str
    media: tuple[MediaItem, ...]


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _dump_time(value: datetime) -> str:
    return _utc(value).isoformat()


def _load_time(value: str) -> datetime:
    return _utc(datetime.fromisoformat(value.replace("Z", "+00:00")))


class LocalWorksService:
    """Authoritative Works owner assembled into the existing Creator Ops store."""

    def __init__(
        self, store: Any, *, nexa_root: str | Path | None = None,
        managed_root: str | Path | None = None, cache_root: str | Path | None = None,
        process_runner: Any = subprocess.run, process_launcher: Any = subprocess.Popen,
        created_time_resolver: Any = None,
    ) -> None:
        self.store = store
        module_root = Path(__file__).resolve().parents[3]
        self.nexa_root = Path(nexa_root).resolve() if nexa_root else module_root.parents[1].resolve()
        managed_override = managed_root or os.environ.get("CREATOR_OPS_WORKS_MANAGED_ROOT")
        cache_override = cache_root or os.environ.get("CREATOR_OPS_WORKS_CACHE_ROOT")
        self.managed_root = Path(managed_override).resolve() if managed_override else self.nexa_root / "自媒体作品"
        self.cache_root = Path(cache_override).resolve() if cache_override else module_root / "runtime" / "cache" / "works"
        for local_root in (self.managed_root, self.cache_root):
            if not local_root.is_absolute() or local_root == Path(local_root.anchor):
                raise WorksError("INVALID_WORKS_ROOT", "Works local root must be an absolute non-root path")
        self.process_runner = process_runner
        self.process_launcher = process_launcher
        self.created_time_resolver = created_time_resolver
        self._move_permission = False
        self._schema_ready = False

    @property
    def move_permission(self) -> bool:
        return self._move_permission

    def set_move_permission(self, enabled: bool) -> dict[str, Any]:
        if not isinstance(enabled, bool):
            raise WorksError("INVALID_MOVE_PERMISSION", "Move permission must be boolean")
        self._move_permission = enabled
        return {"enabled": enabled, "boot_default": "OFF", "persisted": False}

    def managed_root_status(self) -> dict[str, Any]:
        self._ensure_schema()
        self.managed_root.mkdir(parents=True, exist_ok=True)
        return {"absolute_path": str(self.managed_root), "exists": True}

    def list_works(self, view: str = "recent", *, now: datetime | None = None) -> tuple[Work, ...]:
        self._ensure_schema()
        normalized = str(view).lower()
        if normalized not in {"all", "recent", "portfolio"}:
            raise WorksError("INVALID_WORKS_VIEW", "Unknown works view")
        params: list[Any] = []
        where = ""
        if normalized == "portfolio":
            where = "WHERE portfolio=1"
        elif normalized == "recent":
            cutoff = _utc(now or datetime.now(timezone.utc)) - timedelta(days=7)
            where = "WHERE created_at>=?"
            params.append(_dump_time(cutoff))
        rows = self.store.connection.execute(
            f"SELECT * FROM local_works {where} ORDER BY created_at DESC,work_id DESC", params,
        ).fetchall()
        return tuple(self._hydrate(row, refresh=True) for row in rows)

    def get_work(self, work_id: str) -> Work:
        self._ensure_schema()
        row = self.store.connection.execute(
            "SELECT * FROM local_works WHERE work_id=?", (work_id,),
        ).fetchone()
        if row is None:
            raise WorksError("WORK_NOT_FOUND", "Work was not found")
        return self._hydrate(row, refresh=True)

    def intake_resources(
        self, resources: Sequence[Mapping[str, Any]], *, now: datetime | None = None,
    ) -> tuple[Work, ...]:
        self._ensure_schema()
        if not isinstance(resources, Sequence) or isinstance(resources, (str, bytes)) or not resources:
            raise WorksError("INVALID_RESOURCE_HANDOFF", "At least one local resource is required")
        normalized: list[tuple[str, Path]] = []
        for resource in resources:
            if not isinstance(resource, Mapping) or resource.get("kind") not in {"file", "directory"}:
                raise WorksError("INVALID_RESOURCE_HANDOFF", "Resource kind is invalid")
            raw = resource.get("absolute_path")
            path = Path(raw) if isinstance(raw, str) else Path()
            if not path.is_absolute():
                raise WorksError("INVALID_RESOURCE_HANDOFF", "Resource path must be absolute")
            resolved = path.resolve(strict=True)
            expected = resolved.is_file() if resource["kind"] == "file" else resolved.is_dir()
            if not expected:
                raise WorksError("RESOURCE_KIND_MISMATCH", "Resource kind does not match the selected path")
            normalized.append((str(resource["kind"]), resolved))

        groups: list[tuple[str, str, list[Path]]] = []
        loose = [path for kind, path in normalized if kind == "file"]
        if loose:
            title = loose[0].stem if len(loose) == 1 else f"本地作品 · {len(loose)} 项"
            groups.append(("SELECTION", title, loose))
        for kind, directory in normalized:
            if kind != "directory":
                continue
            media = sorted(
                (item for item in directory.iterdir() if item.is_file() and self._media_type(item) is not None),
                key=lambda item: item.name.casefold(),
            )
            if not media:
                raise WorksError("NO_SUPPORTED_MEDIA", "Selected folder contains no supported media")
            groups.append(("FOLDER", directory.name, media))

        result: list[Work] = []
        stamp = _utc(now or datetime.now(timezone.utc))
        for source_kind, title, paths in groups:
            result.append(self._insert_work(source_kind, title, paths, stamp))
        return tuple(result)

    def set_portfolio(self, work_id: str, included: bool) -> Work:
        if not isinstance(included, bool):
            raise WorksError("INVALID_PORTFOLIO_STATE", "Portfolio state must be boolean")
        self._require_work(work_id)
        self.store.connection.execute(
            "UPDATE local_works SET portfolio=?,updated_at=? WHERE work_id=?",
            (int(included), _dump_time(datetime.now(timezone.utc)), work_id),
        )
        return self.get_work(work_id)

    def relocate(self, media_id: str, absolute_path: str) -> Work:
        row = self._require_media(media_id)
        target = Path(absolute_path)
        if not target.is_absolute() or not target.is_file():
            raise WorksError("RELOCATE_TARGET_UNAVAILABLE", "Relocate target must be an existing local file")
        target = target.resolve(strict=True)
        media_type = self._media_type(target)
        if media_type is None or media_type.value != row["media_type"]:
            raise WorksError("RELOCATE_TYPE_MISMATCH", "Relocate target media type does not match")
        stat = target.stat()
        self.store.connection.execute(
            "UPDATE local_work_media SET absolute_path=?,size_bytes=?,extension=?,identity_hint=?,"
            "location_state=?,updated_at=? WHERE media_id=?",
            (str(target), stat.st_size, target.suffix.lower(), self._identity_hint(target, stat),
             self._location_state(target).value, _dump_time(datetime.now(timezone.utc)), media_id),
        )
        return self.get_work(row["work_id"])

    def move_to_managed(self, work_id: str, *, explicit_user_intent: bool) -> Work:
        if not self._move_permission:
            raise WorksError("MOVE_PERMISSION_OFF", "作品文件移动权限当前为关闭")
        if explicit_user_intent is not True:
            raise WorksError("EXPLICIT_INTENT_REQUIRED", "Move requires explicit user intent")
        work = self.get_work(work_id)
        if any(item.location_state is WorkLocationState.MISSING for item in work.media):
            raise WorksError("SOURCE_MISSING", "A work file is missing")
        root = self.managed_root.resolve(strict=False)
        root.mkdir(parents=True, exist_ok=True)
        target_dir = (root / work.work_id).resolve(strict=False)
        if target_dir != root and not target_dir.is_relative_to(root):
            raise WorksError("INVALID_MOVE_TARGET", "Move target is outside the managed works root")
        targets = [(Path(item.absolute_path), target_dir / Path(item.absolute_path).name, item.media_id) for item in work.media]
        if len({str(target).casefold() for _, target, _ in targets}) != len(targets) or any(target.exists() for _, target, _ in targets):
            raise WorksError("MOVE_COLLISION", "Target already contains a file with the same name")
        target_dir.mkdir(parents=True, exist_ok=True)
        moved: list[tuple[Path, Path, str]] = []
        try:
            for source, target, media_id in targets:
                if not source.is_file():
                    raise WorksError("SOURCE_MISSING", "A work file is missing")
                shutil.move(str(source), str(target))
                moved.append((source, target, media_id))
            with self.store.transaction():
                for _, target, media_id in moved:
                    stat = target.stat()
                    self.store.connection.execute(
                        "UPDATE local_work_media SET absolute_path=?,size_bytes=?,identity_hint=?,"
                        "location_state='MANAGED',updated_at=? WHERE media_id=?",
                        (str(target), stat.st_size, self._identity_hint(target, stat),
                         _dump_time(datetime.now(timezone.utc)), media_id),
                    )
        except Exception:
            for source, target, _ in reversed(moved):
                if target.exists() and not source.exists():
                    shutil.move(str(target), str(source))
            raise
        return self.get_work(work_id)

    def media_path(self, media_id: str) -> Path:
        row = self._require_media(media_id)
        path = Path(row["absolute_path"])
        if not path.is_file():
            self._mark_missing(media_id)
            raise WorksError("MEDIA_MISSING", "原文件位置已变化")
        return path.resolve(strict=True)

    def thumbnail_path(self, media_id: str) -> Path:
        source = self.media_path(media_id)
        self.cache_root.mkdir(parents=True, exist_ok=True)
        target = self.cache_root / f"{media_id}.jpg"
        if target.is_file() and target.stat().st_mtime_ns >= source.stat().st_mtime_ns:
            return target
        ffmpeg = self._ffmpeg_path()
        if ffmpeg is None:
            return source
        args = [str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
        if self._media_type(source) is WorkMediaType.VIDEO:
            args.extend(["-ss", "00:00:00.500"])
        args.extend(["-i", str(source), "-frames:v", "1", "-vf", "scale=640:640:force_original_aspect_ratio=decrease", str(target)])
        kwargs: dict[str, Any] = {"check": True, "timeout": 20, "capture_output": True}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        try:
            self.process_runner(args, **kwargs)
        except Exception as exc:
            if target.exists():
                target.unlink()
            raise WorksError("THUMBNAIL_UNAVAILABLE", "Unable to create local thumbnail") from exc
        return target

    def open_original(self, media_id: str) -> dict[str, Any]:
        path = self.media_path(media_id)
        if sys.platform != "win32" or not hasattr(os, "startfile"):
            raise WorksError("OPEN_ORIGINAL_UNAVAILABLE", "Open original is available on Windows")
        os.startfile(path)  # type: ignore[attr-defined]
        return {"opened": True, "media_id": media_id}

    def open_location(self, media_id: str) -> dict[str, Any]:
        path = self.media_path(media_id)
        if sys.platform != "win32":
            raise WorksError("OPEN_LOCATION_UNAVAILABLE", "Open location is available on Windows")
        self.process_runner(["explorer.exe", "/select,", str(path)], check=True, timeout=10)
        return {"opened": True, "media_id": media_id}

    def potplayer_status(self) -> dict[str, Any]:
        self._ensure_schema()
        configured = self.store.connection.execute(
            "SELECT value FROM local_works_settings WHERE key='potplayer_executable'",
        ).fetchone()
        path = Path(configured["value"]) if configured else self._discover_potplayer()
        valid = self._valid_potplayer(path)
        return {"available": valid, "executable": str(path) if valid else None}

    def configure_potplayer(self, absolute_path: str) -> dict[str, Any]:
        path = Path(absolute_path)
        if not self._valid_potplayer(path):
            raise WorksError("INVALID_POTPLAYER_EXECUTABLE", "Selected executable is not PotPlayer")
        self.store.connection.execute(
            "INSERT INTO local_works_settings(key,value) VALUES('potplayer_executable',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(path.resolve(strict=True)),),
        )
        return self.potplayer_status()

    def open_potplayer(self, media_id: str) -> dict[str, Any]:
        source = self.media_path(media_id)
        if self._media_type(source) is not WorkMediaType.VIDEO:
            raise WorksError("NOT_VIDEO", "PotPlayer is available for video media")
        status = self.potplayer_status()
        if not status["available"]:
            raise WorksError("POTPLAYER_NOT_FOUND", "未找到 PotPlayer，请先指定程序位置")
        self.process_launcher([status["executable"], str(source)], close_fds=True)
        return {"opened": True, "media_id": media_id}

    def work_payload(self, work: Work) -> dict[str, Any]:
        payload = asdict(work)
        payload["created_at"] = _dump_time(work.created_at)
        payload["portfolio"] = work.portfolio
        for media, raw in zip(work.media, payload["media"]):
            raw["media_type"] = media.media_type.value
            raw["created_at"] = _dump_time(media.created_at)
            raw["location_state"] = media.location_state.value
        return payload

    def _insert_work(self, source_kind: str, title: str, paths: list[Path], observed_at: datetime) -> Work:
        supported = [(path, self._media_type(path)) for path in paths]
        if any(kind is None for _, kind in supported):
            raise WorksError("UNSUPPORTED_MEDIA", "Only supported image and video files can be added")
        work_id = f"work-{uuid.uuid4()}"
        media_rows = []
        for index, (path, media_type) in enumerate(supported):
            stat = path.stat()
            created_at = self._created_time(path, stat)
            media_rows.append((f"media-{uuid.uuid4()}", path, media_type, stat, created_at, index))
        work_created = max(row[4] for row in media_rows)
        now_text = _dump_time(observed_at)
        with self.store.transaction():
            self.store.connection.execute(
                "INSERT INTO local_works(work_id,title,created_at,portfolio,cover_media_id,source_kind,created_on,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (work_id, title, _dump_time(work_created), 0, media_rows[0][0], source_kind, now_text, now_text),
            )
            for media_id, path, media_type, stat, created_at, index in media_rows:
                self.store.connection.execute(
                    "INSERT INTO local_work_media(media_id,work_id,media_type,absolute_path,created_at,order_index,"
                    "size_bytes,extension,identity_hint,location_state,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (media_id, work_id, media_type.value, str(path), _dump_time(created_at), index,
                     stat.st_size, path.suffix.lower(), self._identity_hint(path, stat),
                     self._location_state(path).value, now_text),
                )
        return self.get_work(work_id)

    def _ensure_schema(self) -> None:
        if self._schema_ready:
            return
        self.store.connection.executescript("""
        CREATE TABLE IF NOT EXISTS local_works (
         work_id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,
         portfolio INTEGER NOT NULL CHECK(portfolio IN (0,1)),cover_media_id TEXT NOT NULL,
         source_kind TEXT NOT NULL,created_on TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_local_works_created ON local_works(created_at DESC,work_id);
        CREATE INDEX IF NOT EXISTS idx_local_works_portfolio ON local_works(portfolio,created_at DESC);
        CREATE TABLE IF NOT EXISTS local_work_media (
         media_id TEXT PRIMARY KEY,work_id TEXT NOT NULL REFERENCES local_works(work_id),
         media_type TEXT NOT NULL CHECK(media_type IN ('IMAGE','VIDEO')),absolute_path TEXT NOT NULL,
         created_at TEXT NOT NULL,order_index INTEGER NOT NULL,size_bytes INTEGER NOT NULL,
         extension TEXT NOT NULL,identity_hint TEXT NOT NULL,
         location_state TEXT NOT NULL CHECK(location_state IN ('MANAGED','EXTERNAL','MISSING')),
         updated_at TEXT NOT NULL,UNIQUE(work_id,order_index));
        CREATE INDEX IF NOT EXISTS idx_local_work_media_work ON local_work_media(work_id,order_index);
        CREATE TABLE IF NOT EXISTS local_works_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
        """)
        self._schema_ready = True

    def _hydrate(self, row: sqlite3.Row, *, refresh: bool) -> Work:
        media_rows = self.store.connection.execute(
            "SELECT * FROM local_work_media WHERE work_id=? ORDER BY order_index,media_id", (row["work_id"],),
        ).fetchall()
        media = []
        for item in media_rows:
            state = WorkLocationState(item["location_state"])
            if refresh:
                actual = self._location_state(Path(item["absolute_path"]))
                if actual is not state:
                    self.store.connection.execute(
                        "UPDATE local_work_media SET location_state=?,updated_at=? WHERE media_id=?",
                        (actual.value, _dump_time(datetime.now(timezone.utc)), item["media_id"]),
                    )
                    state = actual
            media.append(MediaItem(
                item["media_id"], item["work_id"], WorkMediaType(item["media_type"]), item["absolute_path"],
                _load_time(item["created_at"]), item["order_index"], item["size_bytes"], item["extension"],
                item["identity_hint"], state,
            ))
        return Work(row["work_id"], row["title"], _load_time(row["created_at"]), bool(row["portfolio"]),
                    row["cover_media_id"], row["source_kind"], tuple(media))

    def _require_work(self, work_id: str) -> sqlite3.Row:
        self._ensure_schema()
        row = self.store.connection.execute("SELECT * FROM local_works WHERE work_id=?", (work_id,)).fetchone()
        if row is None:
            raise WorksError("WORK_NOT_FOUND", "Work was not found")
        return row

    def _require_media(self, media_id: str) -> sqlite3.Row:
        self._ensure_schema()
        row = self.store.connection.execute("SELECT * FROM local_work_media WHERE media_id=?", (media_id,)).fetchone()
        if row is None:
            raise WorksError("MEDIA_NOT_FOUND", "Media was not found")
        return row

    def _mark_missing(self, media_id: str) -> None:
        self.store.connection.execute(
            "UPDATE local_work_media SET location_state='MISSING',updated_at=? WHERE media_id=?",
            (_dump_time(datetime.now(timezone.utc)), media_id),
        )

    def _location_state(self, path: Path) -> WorkLocationState:
        if not path.is_file():
            return WorkLocationState.MISSING
        resolved = path.resolve(strict=True)
        root = self.managed_root.resolve(strict=False)
        return WorkLocationState.MANAGED if resolved == root or resolved.is_relative_to(root) else WorkLocationState.EXTERNAL

    @staticmethod
    def _media_type(path: Path) -> WorkMediaType | None:
        suffix = path.suffix.lower()
        if suffix in SUPPORTED_IMAGE_EXTENSIONS:
            return WorkMediaType.IMAGE
        if suffix in SUPPORTED_VIDEO_EXTENSIONS:
            return WorkMediaType.VIDEO
        return None

    def _created_time(self, path: Path, stat: os.stat_result) -> datetime:
        if self.created_time_resolver is not None:
            return _utc(self.created_time_resolver(path, stat))
        seconds = getattr(stat, "st_birthtime", None)
        if seconds is None:
            seconds = stat.st_ctime
        return datetime.fromtimestamp(seconds, timezone.utc)

    @staticmethod
    def _identity_hint(path: Path, stat: os.stat_result) -> str:
        return json.dumps({"size": stat.st_size, "created_ns": getattr(stat, "st_birthtime_ns", stat.st_ctime_ns),
                           "extension": path.suffix.lower()}, separators=(",", ":"), sort_keys=True)

    def _ffmpeg_path(self) -> Path | None:
        found = shutil.which("ffmpeg")
        if found:
            return Path(found)
        bundled = Path(__file__).resolve().parents[3] / "source_import" / "00_Codex项目调教" / "tools" / "video_tools" / "ffmpeg" / "bin" / "ffmpeg.exe"
        return bundled if bundled.is_file() else None

    @staticmethod
    def _valid_potplayer(path: Path | None) -> bool:
        return bool(path and path.is_absolute() and path.is_file() and path.name.lower() in {
            "potplayermini64.exe", "potplayermini.exe", "potplayer.exe",
        })

    def _discover_potplayer(self) -> Path | None:
        if sys.platform != "win32":
            return None
        try:
            import winreg
            keys = (
                (winreg.HKEY_CURRENT_USER, r"Software\DAUM\PotPlayer64", "ProgramPath"),
                (winreg.HKEY_CURRENT_USER, r"Software\DAUM\PotPlayer", "ProgramPath"),
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\DAUM\PotPlayer64", "ProgramPath"),
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\DAUM\PotPlayer", "ProgramPath"),
            )
            for hive, key_name, value_name in keys:
                try:
                    with winreg.OpenKey(hive, key_name) as key:
                        candidate = Path(winreg.QueryValueEx(key, value_name)[0])
                        if self._valid_potplayer(candidate):
                            return candidate
                except OSError:
                    continue
        except ImportError:
            pass
        for name in ("PotPlayerMini64.exe", "PotPlayerMini.exe"):
            found = shutil.which(name)
            if found and self._valid_potplayer(Path(found)):
                return Path(found)
        return None
