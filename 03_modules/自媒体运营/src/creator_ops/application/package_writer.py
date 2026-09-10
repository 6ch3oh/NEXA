"""Fail-safe local Content Package writer for the authoritative package route."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path, PurePosixPath
from typing import Mapping, Sequence

class PackageWriteStatus(str, Enum):
    CREATED = "CREATED"
    IDEMPOTENT = "IDEMPOTENT"
    CONFLICT = "CONFLICT"
    FAILED = "FAILED"


@dataclass(frozen=True)
class PackageFileInput:
    logical_name: str
    relative_path: str
    content: bytes
    required: bool = True
    media_type: str = "application/octet-stream"


@dataclass(frozen=True)
class PackageBuildRequest:
    package_id: str
    content_id: str
    account: str
    files: tuple[PackageFileInput, ...]
    asset_references: tuple[str, ...]
    provenance: Mapping[str, object]
    generated_at: datetime
    qa_state: str = "PENDING"
    schema_version: str = "creator_ops_package_v0.2"
    asset_inventory: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class PackageWriteResult:
    status: PackageWriteStatus
    package_id: str
    target_path: Path
    manifest_path: Path | None
    package_digest: str | None
    staging_path: Path | None = None
    message: str = ""


class LocalPackageWriter:
    """Writes one package using create-only staging and atomic directory rename."""

    MANIFEST = "metadata/package_manifest.json"

    def __init__(self, target_root: str | Path) -> None:
        root = Path(target_root)
        if not root.is_absolute():
            raise ValueError("package target root must be absolute")
        self.root = root.resolve(strict=False)
        module = Path(__file__).resolve().parents[3]
        temp = Path(os.environ.get("TEMP", str(Path.cwd()))).resolve()
        if not (self.root.is_relative_to(module) or self.root.is_relative_to(temp)):
            raise ValueError("package target root is outside allowed local roots")
        source_import = module / "source_import"
        if self.root == source_import or self.root.is_relative_to(source_import):
            raise ValueError("source_import is immutable and cannot be a package target")
        if self.root == Path(self.root.anchor):
            raise ValueError("package target root is too broad")

    def write(self, request: PackageBuildRequest) -> PackageWriteResult:
        self._validate_request(request)
        target = self.root / request.account / request.content_id
        staging = self.root / ".staging" / f"{request.package_id}.staging"
        manifest_bytes, digest = self._manifest(request)
        if target.exists():
            existing = target / self.MANIFEST
            if existing.is_file():
                try:
                    current = json.loads(existing.read_text(encoding="utf-8"))
                    if current.get("package_digest") == digest and current.get("package_id") == request.package_id:
                        return PackageWriteResult(
                            PackageWriteStatus.IDEMPOTENT, request.package_id, target, existing, digest,
                            message="identical package already finalized",
                        )
                except (OSError, json.JSONDecodeError):
                    pass
            return PackageWriteResult(
                PackageWriteStatus.CONFLICT, request.package_id, target, existing, None,
                message="target exists and is not the identical package",
            )
        if staging.exists():
            return PackageWriteResult(
                PackageWriteStatus.FAILED, request.package_id, target, None, None, staging,
                "staging exists; recovery must decide before retry",
            )
        created_staging = False
        try:
            staging.mkdir(parents=True, exist_ok=False)
            created_staging = True
            for item in request.files:
                destination = staging / PurePosixPath(item.relative_path)
                destination.parent.mkdir(parents=True, exist_ok=True)
                self._create_file(destination, item.content)
            manifest = staging / self.MANIFEST
            manifest.parent.mkdir(parents=True, exist_ok=True)
            self._create_file(manifest, manifest_bytes)
            self._validate_staging(staging, request, digest)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staging, target)
            return PackageWriteResult(
                PackageWriteStatus.CREATED, request.package_id, target,
                target / self.MANIFEST, digest, message="package finalized atomically",
            )
        except Exception as exc:
            if created_staging and staging.exists():
                resolved = staging.resolve()
                if resolved.is_relative_to((self.root / ".staging").resolve()):
                    shutil.rmtree(resolved)
            return PackageWriteResult(
                PackageWriteStatus.FAILED, request.package_id, target, None, None,
                message=f"package write failed: {type(exc).__name__}",
            )

    def inspect_staging(self, package_id: str) -> Path | None:
        self._safe_identity("package_id", package_id)
        path = self.root / ".staging" / f"{package_id}.staging"
        return path if path.is_dir() else None

    def rollback_staging(self, package_id: str) -> bool:
        """Remove only this writer's unfinalized staging directory."""
        path = self.inspect_staging(package_id)
        if path is None:
            return False
        resolved = path.resolve()
        staging_root = (self.root / ".staging").resolve()
        if not resolved.is_relative_to(staging_root) or resolved.parent != staging_root:
            raise ValueError("staging rollback target is unsafe")
        shutil.rmtree(resolved)
        return True

    @staticmethod
    def _create_file(path: Path, content: bytes) -> None:
        with path.open("xb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())

    def _manifest(self, request: PackageBuildRequest) -> tuple[bytes, str]:
        files = [{
            "logical_name": item.logical_name, "path": item.relative_path,
            "required": item.required, "media_type": item.media_type,
            "size": len(item.content), "sha256": hashlib.sha256(item.content).hexdigest(),
        } for item in sorted(request.files, key=lambda value: value.relative_path)]
        stable_projection = {
            "schema_version": request.schema_version, "package_id": request.package_id,
            "content_id": request.content_id, "account": request.account, "files": files,
            "asset_references": list(request.asset_references), "qa_state": request.qa_state,
            "asset_inventory": dict(request.asset_inventory),
            "package_state": "FINALIZED", "provenance": dict(request.provenance),
        }
        canonical = json.dumps(stable_projection, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        projection = dict(stable_projection)
        projection["generated_at"] = request.generated_at.isoformat()
        projection["package_digest"] = digest
        rendered = json.dumps(projection, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        return rendered.encode("utf-8"), digest

    def _validate_staging(self, staging: Path, request: PackageBuildRequest, digest: str) -> None:
        manifest = json.loads((staging / self.MANIFEST).read_text(encoding="utf-8"))
        if manifest.get("package_digest") != digest:
            raise ValueError("manifest digest mismatch")
        for item in request.files:
            path = staging / PurePosixPath(item.relative_path)
            if item.required and not path.is_file():
                raise ValueError(f"required package file is missing: {item.relative_path}")
            if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() != hashlib.sha256(item.content).hexdigest():
                raise ValueError(f"staged package file changed: {item.relative_path}")

    def _validate_request(self, request: PackageBuildRequest) -> None:
        self._safe_identity("package_id", request.package_id)
        self._safe_identity("content_id", request.content_id)
        self._safe_identity("account", request.account)
        if not request.files or not request.provenance:
            raise ValueError("package files and provenance are required")
        paths = set()
        for item in request.files:
            relative = PurePosixPath(item.relative_path)
            if relative.is_absolute() or ".." in relative.parts or not relative.parts:
                raise ValueError("package file path is unsafe")
            normalized = relative.as_posix()
            if normalized == self.MANIFEST or normalized in paths:
                raise ValueError("package file path conflicts or duplicates manifest")
            paths.add(normalized)

    @staticmethod
    def _safe_identity(name: str, value: str) -> None:
        if not value or not re.fullmatch(r"[A-Za-z0-9._-]{1,96}", value) or value.endswith((".", " ")):
            raise ValueError(f"{name} is unsafe")
