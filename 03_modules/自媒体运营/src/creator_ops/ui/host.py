"""Loopback-only standard-library host for Creator Ops Local UI V0.1."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import secrets
import socket
import threading
import webbrowser
from dataclasses import dataclass
from enum import Enum
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from creator_ops import CreatorOpsAPIError, CreatorOpsApplication, create_creator_ops_application
from creator_ops.ui.adapter import CreatorOpsUIAdapter, UIAdapterError


LOOPBACK_HOST = "127.0.0.1"
DEFAULT_UI_PORT = 8765
UI_HOST_CONTRACT_VERSION = "1.0"
UI_HOST_OWNERSHIP_CONTRACT_VERSION = "0.1"
MAX_REQUEST_BYTES = 1_048_576
STATIC_ROOT = Path(__file__).resolve().parent / "static"
OWNER_WATCH_INTERVAL_SECONDS = 0.25


class UIHostLifecycleState(str, Enum):
    CREATED = "CREATED"
    STARTING = "STARTING"
    READY = "READY"
    STOPPING = "STOPPING"
    STOPPED = "STOPPED"
    ERROR = "ERROR"


@dataclass(frozen=True)
class UIEndpoint:
    host: str
    port: int
    url: str
    surface: str = "CREATOR_OPS_LOCAL_UI_V0.1"

    def as_dict(self) -> dict[str, Any]:
        return {"host": self.host, "port": self.port, "url": self.url, "surface": self.surface}


@dataclass(frozen=True)
class UIHostReadiness:
    contract_version: str
    state: UIHostLifecycleState
    ready: bool
    error_code: str | None
    message: str
    endpoint: UIEndpoint | None
    runtime_instance_count: int
    generation: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "contractVersion": self.contract_version,
            "state": self.state.value,
            "ready": self.ready,
            "errorCode": self.error_code,
            "message": self.message,
            "endpoint": self.endpoint.as_dict() if self.endpoint else None,
            "runtimeInstanceCount": self.runtime_instance_count,
            "generation": self.generation,
        }


class _LocalHTTPServer(HTTPServer):
    # SO_REUSEADDR on Windows permits multiple processes to bind the exact same
    # address. That made 127.0.0.1:8765 a request lottery between control tokens.
    allow_reuse_address = os.name != "nt"

    def server_bind(self) -> None:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class CreatorOpsUIHost:
    def __init__(
        self, application: CreatorOpsApplication, *, host: str = LOOPBACK_HOST, port: int = 0,
        static_root: str | Path = STATIC_ROOT, control_token: str | None = None,
        owner_id: str | None = None, owner_generation: int | None = None,
        owner_process_id: int | None = None,
    ) -> None:
        if host != LOOPBACK_HOST:
            raise ValueError("Creator Ops UI may bind only to 127.0.0.1")
        if not 0 <= port <= 65535:
            raise ValueError("port must be between 0 and 65535")
        owner_values = (owner_id, owner_generation, owner_process_id)
        if any(value is not None for value in owner_values):
            if (
                control_token is None
                or not isinstance(owner_id, str)
                or not owner_id.strip()
                or not isinstance(owner_generation, int)
                or owner_generation < 1
                or not isinstance(owner_process_id, int)
                or owner_process_id < 1
            ):
                raise ValueError("managed UI host ownership requires token, owner, generation, and process")
        self.application = application
        self.adapter = CreatorOpsUIAdapter(application)
        self.host = host
        self.requested_port = port
        self.static_root = Path(static_root).resolve()
        self.csrf_token = secrets.token_urlsafe(32)
        self._control_token = control_token
        self._owner_id = owner_id
        self._owner_generation = owner_generation
        self._owner_process_id = owner_process_id
        self._server: _LocalHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._shutdown_thread: threading.Thread | None = None
        self._owner_watch_thread: threading.Thread | None = None
        self._lifecycle_lock = threading.RLock()
        self._startup_event = threading.Event()
        self._stopped_event = threading.Event()
        self._startup_error: BaseException | None = None
        self._state = UIHostLifecycleState.CREATED
        self._error_code: str | None = None
        self._safe_message = "Creator Ops UI host created"
        self._last_endpoint: UIEndpoint | None = None
        self._generation = 0

    @property
    def running(self) -> bool:
        return (
            self._state is UIHostLifecycleState.READY
            and self._server is not None
            and self._thread is not None
            and self._thread.is_alive()
        )

    @property
    def port(self) -> int:
        if self._server is None:
            return self.requested_port
        return int(self._server.server_address[1])

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    def status(self) -> UIHostReadiness:
        with self._lifecycle_lock:
            active = self._state in {
                UIHostLifecycleState.STARTING,
                UIHostLifecycleState.READY,
                UIHostLifecycleState.STOPPING,
            }
            return UIHostReadiness(
                contract_version=UI_HOST_CONTRACT_VERSION,
                state=self._state,
                ready=self._state is UIHostLifecycleState.READY and self.running,
                error_code=self._error_code,
                message=self._safe_message,
                endpoint=self._last_endpoint,
                runtime_instance_count=1 if active else 0,
                generation=self._generation,
            )

    def ownership_status(self) -> dict[str, Any]:
        """Return the authenticated process-owner handshake without exposing its token."""

        status = self.status()
        return {
            "contractVersion": UI_HOST_OWNERSHIP_CONTRACT_VERSION,
            "ownerId": self._owner_id,
            "ownerGeneration": self._owner_generation,
            "ownerProcessId": self._owner_process_id,
            "hostProcessId": os.getpid(),
            "controlTokenVerified": True,
            "state": status.state.value,
            "ready": status.ready,
            "endpoint": status.endpoint.as_dict() if status.endpoint else None,
            "runtimeGeneration": status.generation,
        }

    def start(self) -> "CreatorOpsUIHost":
        shutdown_thread = self._shutdown_thread
        if (
            shutdown_thread is not None
            and shutdown_thread is not threading.current_thread()
            and shutdown_thread.is_alive()
        ):
            shutdown_thread.join(timeout=5)
            if shutdown_thread.is_alive():
                raise RuntimeError("Creator Ops UI host shutdown did not complete")
        start_thread: threading.Thread | None = None
        with self._lifecycle_lock:
            if self.running:
                return self
            if self._state is UIHostLifecycleState.STOPPING:
                raise RuntimeError("Creator Ops UI host shutdown is in progress")
            if self._state is UIHostLifecycleState.STARTING:
                startup_event = self._startup_event
            else:
                startup_event = self._startup_event
                # SQLite connections are thread-affine. The host owns the application
                # lifecycle and opens/closes it on the same thread that serves requests.
                self.application.close()
                startup_event.clear()
                self._stopped_event.clear()
                self._startup_error = None
                self._state = UIHostLifecycleState.STARTING
                self._error_code = None
                self._safe_message = "Creator Ops UI host is starting"
                try:
                    self._server = _LocalHTTPServer((self.host, self.requested_port), self._handler_type())
                    bound_port = int(self._server.server_address[1])
                    self._last_endpoint = UIEndpoint(
                        host=self.host, port=bound_port, url=f"http://{self.host}:{bound_port}/",
                    )
                    self._thread = threading.Thread(
                        target=self._serve,
                        name="creator-ops-local-ui",
                        daemon=True,
                    )
                    start_thread = self._thread
                except Exception:
                    if self._server is not None:
                        self._server.server_close()
                    self._server = None
                    self._thread = None
                    self._set_error("HOST_BIND_FAILED", "Creator Ops UI host could not bind")
                    self._stopped_event.set()
                    raise

        if start_thread is not None:
            start_thread.start()

        if not startup_event.wait(timeout=5):
            with self._lifecycle_lock:
                server, thread = self._server, self._thread
            if server is not None and thread is not None and thread.is_alive():
                server.shutdown()
                thread.join(timeout=5)
            if server is not None:
                server.server_close()
            with self._lifecycle_lock:
                self._server = None
                self._thread = None
            self._set_error("HOST_START_TIMEOUT", "Creator Ops UI host could not become ready")
            self._stopped_event.set()
            raise RuntimeError("Creator Ops UI application startup timed out")

        if self._startup_error is not None:
            with self._lifecycle_lock:
                server, thread = self._server, self._thread
            if thread is not None and thread.is_alive():
                thread.join(timeout=5)
            if server is not None:
                server.server_close()
            with self._lifecycle_lock:
                self._server = None
                self._thread = None
            self._set_error("APPLICATION_OPEN_FAILED", "Creator Ops application could not open")
            self._stopped_event.set()
            raise RuntimeError("Creator Ops application could not open") from self._startup_error

        return self

    def _set_error(self, code: str, message: str) -> None:
        with self._lifecycle_lock:
            self._state = UIHostLifecycleState.ERROR
            self._error_code = code
            self._safe_message = message

    def _serve(self) -> None:
        try:
            result = self.application.open()
            if result.database_state.value != "OPEN":
                raise RuntimeError(f"Creator Ops application could not open: {result.message}")
            with self._lifecycle_lock:
                self._state = UIHostLifecycleState.READY
                self._error_code = None
                self._safe_message = "Creator Ops UI host is ready"
                self._generation += 1
                if self._owner_process_id is not None:
                    self._owner_watch_thread = threading.Thread(
                        target=self._watch_owner,
                        name="creator-ops-owner-watch",
                        daemon=True,
                    )
                    self._owner_watch_thread.start()
            self._startup_event.set()
            assert self._server is not None
            self._server.serve_forever()
        except BaseException as exc:
            self._startup_error = exc
            self._set_error("HOST_RUNTIME_ERROR", "Creator Ops UI host encountered a runtime error")
            self._startup_event.set()
        finally:
            self.application.close()
            with self._lifecycle_lock:
                if self._state is not UIHostLifecycleState.ERROR:
                    self._state = UIHostLifecycleState.STOPPED
                    self._error_code = None
                    self._safe_message = "Creator Ops UI host is stopped"
            self._stopped_event.set()

    def _watch_owner(self) -> None:
        assert self._owner_process_id is not None
        while not self._stopped_event.wait(OWNER_WATCH_INTERVAL_SECONDS):
            with self._lifecycle_lock:
                if self._state not in {UIHostLifecycleState.STARTING, UIHostLifecycleState.READY}:
                    return
            if not self._owner_process_is_alive():
                self.request_shutdown()
                return

    def _owner_process_is_alive(self) -> bool:
        assert self._owner_process_id is not None
        if os.name == "nt":
            # os.kill(pid, 0) is not a harmless existence probe on Windows: it
            # maps to TerminateProcess. Use a synchronize-only process handle.
            import ctypes
            from ctypes import wintypes

            synchronize = 0x00100000
            wait_timeout = 0x00000102
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
            kernel32.WaitForSingleObject.restype = wintypes.DWORD
            kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
            kernel32.CloseHandle.restype = wintypes.BOOL
            handle = kernel32.OpenProcess(synchronize, False, self._owner_process_id)
            if not handle:
                return False
            try:
                return kernel32.WaitForSingleObject(handle, 0) == wait_timeout
            finally:
                kernel32.CloseHandle(handle)
        try:
            os.kill(self._owner_process_id, 0)
        except OSError:
            return False
        return True

    def shutdown(self) -> UIHostReadiness:
        with self._lifecycle_lock:
            if self._state in {UIHostLifecycleState.CREATED, UIHostLifecycleState.STOPPED}:
                self._state = UIHostLifecycleState.STOPPED
                self._error_code = None
                self._safe_message = "Creator Ops UI host is stopped"
                self._stopped_event.set()
                return self.status()
            self._state = UIHostLifecycleState.STOPPING
            self._error_code = None
            self._safe_message = "Creator Ops UI host is stopping"
            server, thread = self._server, self._thread
        if server is not None:
            server.shutdown()
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=5)
        if server is not None:
            server.server_close()
        with self._lifecycle_lock:
            self._server = None
            self._thread = None
            self._state = UIHostLifecycleState.STOPPED
            self._error_code = None
            self._safe_message = "Creator Ops UI host is stopped"
            self._stopped_event.set()
        return self.status()

    def request_shutdown(self) -> UIHostReadiness:
        with self._lifecycle_lock:
            if self._state in {UIHostLifecycleState.CREATED, UIHostLifecycleState.STOPPED}:
                return self.shutdown()
            if self._shutdown_thread is not None and self._shutdown_thread.is_alive():
                return self.status()
            self._state = UIHostLifecycleState.STOPPING
            self._error_code = None
            self._safe_message = "Creator Ops UI host is stopping"
            self._shutdown_thread = threading.Thread(
                target=self.shutdown, name="creator-ops-local-ui-shutdown", daemon=True,
            )
            self._shutdown_thread.start()
            return self.status()

    def wait_until_stopped(self, timeout: float | None = None) -> bool:
        if not self._stopped_event.wait(timeout):
            return False
        shutdown_thread = self._shutdown_thread
        if (
            shutdown_thread is not None
            and shutdown_thread is not threading.current_thread()
            and shutdown_thread.is_alive()
        ):
            shutdown_thread.join(timeout=timeout)
            return not shutdown_thread.is_alive()
        return True

    def __enter__(self) -> "CreatorOpsUIHost":
        return self.start()

    def __exit__(self, *_: object) -> None:
        self.shutdown()

    def _handler_type(self) -> type[BaseHTTPRequestHandler]:
        ui_host = self

        class RequestHandler(BaseHTTPRequestHandler):
            server_version = "CreatorOpsLocalUI/0.1"
            sys_version = ""

            def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
                try:
                    self._check_host()
                    parsed = urlsplit(self.path)
                    if parsed.path.startswith("/api/v1/"):
                        self._get_api(parsed.path, parse_qs(parsed.query, keep_blank_values=True))
                    else:
                        self._get_static(parsed.path)
                except UIAdapterError as exc:
                    self._json_error(exc.status, exc.code, str(exc))
                except CreatorOpsAPIError as exc:
                    self._json_error(400, exc.code, str(exc))
                except Exception:
                    self._json_error(500, "INTERNAL_ERROR", "Creator Ops UI could not complete the request")

            def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
                try:
                    self._check_host()
                    parsed = urlsplit(self.path)
                    if parsed.path == "/api/v1/host-shutdown":
                        self._check_control_guard()
                        self._send_json(202, ui_host.request_shutdown().as_dict())
                        return
                    if parsed.path == "/api/v1/integration/works/intake":
                        self._check_control_guard()
                        payload = self._read_json()
                        resources = payload.get("resources")
                        if not isinstance(resources, list):
                            raise UIAdapterError("VALIDATION_ERROR", "resources must be a list")
                        self._send_json(200, ui_host.adapter.intake_work_resources(resources))
                        return
                    if parsed.path == "/api/v1/integration/works/relocate":
                        self._check_control_guard()
                        payload = self._read_json()
                        self._send_json(200, ui_host.adapter.relocate_work_media(
                            str(payload.get("media_id", "")), str(payload.get("absolute_path", "")),
                        ))
                        return
                    if parsed.path == "/api/v1/integration/works/potplayer":
                        self._check_control_guard()
                        payload = self._read_json()
                        self._send_json(200, ui_host.application.configure_local_work_potplayer(
                            absolute_path=str(payload.get("absolute_path", "")),
                        ))
                        return
                    if parsed.path == "/api/v1/integration/works/query":
                        self._check_control_guard()
                        payload = self._read_json()
                        operation = payload.get("operation")
                        if operation == "list":
                            self._send_json(200, ui_host.adapter.works(str(payload.get("view", "recent"))))
                        elif operation == "detail":
                            self._send_json(200, ui_host.adapter.work_detail(str(payload.get("work_id", ""))))
                        else:
                            raise UIAdapterError("VALIDATION_ERROR", "Unknown Works query")
                        return
                    if parsed.path == "/api/v1/integration/works/command":
                        self._check_control_guard()
                        payload = self._read_json()
                        operation = payload.get("operation")
                        if operation == "intake":
                            resources = payload.get("resources")
                            if not isinstance(resources, list):
                                raise UIAdapterError("VALIDATION_ERROR", "resources must be a list")
                            value = ui_host.adapter.intake_work_resources(resources)
                        elif operation == "relocate":
                            value = ui_host.adapter.relocate_work_media(
                                str(payload.get("media_id", "")), str(payload.get("absolute_path", "")),
                            )
                        elif operation == "configure_potplayer":
                            value = ui_host.application.configure_local_work_potplayer(
                                absolute_path=str(payload.get("absolute_path", "")),
                            )
                        elif operation == "portfolio":
                            value = ui_host.application.set_local_work_portfolio(
                                str(payload.get("work_id", "")), included=payload.get("included") is True,
                            )
                        elif operation == "move_permission":
                            value = ui_host.application.set_local_work_move_permission(enabled=payload.get("enabled") is True)
                        elif operation == "move_managed":
                            value = ui_host.application.move_local_work_to_managed(
                                str(payload.get("work_id", "")), explicit_user_intent=payload.get("explicit_user_intent") is True,
                            )
                        elif operation == "open_original":
                            value = ui_host.application.open_local_work_original(str(payload.get("media_id", "")))
                        elif operation == "open_location":
                            value = ui_host.application.open_local_work_location(str(payload.get("media_id", "")))
                        elif operation == "open_potplayer":
                            value = ui_host.application.open_local_work_potplayer(str(payload.get("media_id", "")))
                        else:
                            raise UIAdapterError("VALIDATION_ERROR", "Unknown Works command")
                        self._send_json(200, value)
                        return
                    prefix = "/api/v1/actions/"
                    if not parsed.path.startswith(prefix):
                        raise UIAdapterError("NOT_FOUND", "Unknown endpoint", status=404)
                    self._check_write_guard()
                    action = unquote(parsed.path[len(prefix):]).strip("/")
                    payload = self._read_json()
                    self._send_json(200, ui_host.adapter.dispatch(action, payload))
                except UIAdapterError as exc:
                    self._json_error(exc.status, exc.code, str(exc))
                except CreatorOpsAPIError as exc:
                    self._json_error(400, exc.code, str(exc))
                except Exception:
                    self._json_error(500, "INTERNAL_ERROR", "Creator Ops UI could not complete the request")

            def _get_api(self, path: str, query: dict[str, list[str]]) -> None:
                if path == "/api/v1/host-status":
                    self._send_json(200, ui_host.status().as_dict())
                elif path == "/api/v1/host-ownership":
                    self._check_control_guard()
                    self._send_json(200, ui_host.ownership_status())
                elif path == "/api/v1/bootstrap":
                    self._send_json(200, ui_host.adapter.bootstrap())
                elif path == "/api/v1/dashboard":
                    self._send_json(200, ui_host.adapter.dashboard())
                elif path == "/api/v1/works":
                    view = query.get("view", ["recent"])[-1]
                    self._send_json(200, ui_host.adapter.works(view))
                elif path.startswith("/api/v1/works/media/") and path.endswith("/thumbnail"):
                    media_id = unquote(path.removeprefix("/api/v1/works/media/").removesuffix("/thumbnail").strip("/"))
                    self._send_local_media(ui_host.adapter.work_thumbnail_path(media_id), allow_range=False)
                elif path.startswith("/api/v1/works/media/") and path.endswith("/content"):
                    media_id = unquote(path.removeprefix("/api/v1/works/media/").removesuffix("/content").strip("/"))
                    self._send_local_media(ui_host.adapter.work_media_path(media_id), allow_range=True)
                elif path.startswith("/api/v1/works/"):
                    self._send_json(200, ui_host.adapter.work_detail(unquote(path.rsplit("/", 1)[-1])))
                elif path == "/api/v1/work-queue":
                    self._send_json(200, ui_host.adapter.work_queue())
                elif path == "/api/v1/contents":
                    filters = {key: values[-1] for key, values in query.items() if values}
                    self._send_json(200, ui_host.adapter.contents(filters))
                elif path.startswith("/api/v1/contents/"):
                    self._send_json(200, ui_host.adapter.content_detail(unquote(path.rsplit("/", 1)[-1])))
                elif path == "/api/v1/accounts":
                    self._send_json(200, ui_host.adapter.accounts())
                elif path.startswith("/api/v1/accounts/"):
                    self._send_json(200, ui_host.adapter.account_detail(unquote(path.rsplit("/", 1)[-1])))
                elif path == "/api/v1/assets":
                    self._send_json(200, ui_host.adapter.assets())
                elif path == "/api/v1/reviews":
                    self._send_json(200, ui_host.adapter.reviews())
                elif path == "/api/v1/publishing":
                    self._send_json(200, ui_host.adapter.publishing())
                elif path == "/api/v1/research":
                    self._send_json(200, ui_host.adapter.research())
                elif path == "/api/v1/health":
                    self._send_json(200, ui_host.adapter.health())
                elif path.startswith("/api/v1/visual-reviews/") and path.endswith("/preview"):
                    submission_id = unquote(path.removeprefix("/api/v1/visual-reviews/").removesuffix("/preview").strip("/"))
                    self._send_preview(ui_host.adapter.preview_path(submission_id))
                elif path.startswith("/api/v1/visual-reviews/"):
                    self._send_json(200, ui_host.adapter.visual_review(unquote(path.rsplit("/", 1)[-1])))
                else:
                    raise UIAdapterError("NOT_FOUND", "Unknown endpoint", status=404)

            def _get_static(self, path: str) -> None:
                relative = "index.html" if path in {"", "/"} else unquote(path).lstrip("/")
                candidate = (ui_host.static_root / relative).resolve()
                try:
                    candidate.relative_to(ui_host.static_root)
                except ValueError as exc:
                    raise UIAdapterError("NOT_FOUND", "Static asset not found", status=404) from exc
                if not candidate.is_file():
                    if "." not in Path(relative).name:
                        candidate = ui_host.static_root / "index.html"
                    else:
                        raise UIAdapterError("NOT_FOUND", "Static asset not found", status=404)
                data = candidate.read_bytes()
                if candidate.name == "index.html":
                    data = data.replace(b"__CREATOR_OPS_CSRF_TOKEN__", ui_host.csrf_token.encode("ascii"))
                content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
                self.send_response(HTTPStatus.OK)
                self._security_headers(no_store=True)
                self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _send_preview(self, path: Path) -> None:
                data = path.read_bytes()
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                self.send_response(HTTPStatus.OK)
                self._security_headers(no_store=True)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Disposition", "inline")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _send_local_media(self, path: Path, *, allow_range: bool) -> None:
                size = path.stat().st_size
                start, end, status = 0, size - 1, HTTPStatus.OK
                if allow_range and self.headers.get("Range"):
                    value = self.headers["Range"]
                    if not value.startswith("bytes=") or "," in value:
                        raise UIAdapterError("INVALID_RANGE", "Invalid media range", status=416)
                    first, _, last = value[6:].partition("-")
                    try:
                        start = int(first) if first else 0
                        end = int(last) if last else size - 1
                    except ValueError as exc:
                        raise UIAdapterError("INVALID_RANGE", "Invalid media range", status=416) from exc
                    if start < 0 or end < start or start >= size:
                        raise UIAdapterError("INVALID_RANGE", "Invalid media range", status=416)
                    end = min(end, size - 1)
                    status = HTTPStatus.PARTIAL_CONTENT
                length = end - start + 1
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                self.send_response(status)
                self._security_headers(no_store=True)
                self.send_header("Content-Type", content_type)
                self.send_header("Accept-Ranges", "bytes")
                if status is HTTPStatus.PARTIAL_CONTENT:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.send_header("Content-Length", str(length))
                self.end_headers()
                with path.open("rb") as stream:
                    stream.seek(start)
                    remaining = length
                    while remaining:
                        chunk = stream.read(min(64 * 1024, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)

            def _read_json(self) -> dict[str, Any]:
                if self.headers.get_content_type() != "application/json":
                    raise UIAdapterError("UNSUPPORTED_MEDIA_TYPE", "JSON request required", status=415)
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError as exc:
                    raise UIAdapterError("VALIDATION_ERROR", "Invalid Content-Length") from exc
                if length <= 0 or length > MAX_REQUEST_BYTES:
                    raise UIAdapterError("VALIDATION_ERROR", "Request body size is invalid", status=413)
                try:
                    value = json.loads(self.rfile.read(length).decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise UIAdapterError("VALIDATION_ERROR", "Invalid JSON") from exc
                if not isinstance(value, dict):
                    raise UIAdapterError("VALIDATION_ERROR", "JSON object required")
                return value

            def _check_host(self) -> None:
                host = self.headers.get("Host", "")
                allowed = {f"{LOOPBACK_HOST}:{ui_host.port}", f"localhost:{ui_host.port}"}
                if host not in allowed:
                    raise UIAdapterError("FORBIDDEN_HOST", "Invalid local Host header", status=403)

            def _check_write_guard(self) -> None:
                if not secrets.compare_digest(
                    self.headers.get("X-Creator-Ops-Token", ""), ui_host.csrf_token,
                ):
                    raise UIAdapterError("FORBIDDEN", "Missing or invalid local UI token", status=403)
                origin = self.headers.get("Origin")
                allowed = {ui_host.url.rstrip("/"), f"http://localhost:{ui_host.port}"}
                if origin is not None and origin not in allowed:
                    raise UIAdapterError("FORBIDDEN_ORIGIN", "Invalid local Origin", status=403)

            def _check_control_guard(self) -> None:
                if ui_host._control_token is None:
                    raise UIAdapterError("CONTROL_UNAVAILABLE", "Host control is unavailable", status=404)
                if not secrets.compare_digest(
                    self.headers.get("X-Creator-Ops-Control", ""), ui_host._control_token,
                ):
                    raise UIAdapterError("FORBIDDEN", "Missing or invalid host control", status=403)
                if ui_host._owner_id is not None:
                    supplied_owner = self.headers.get("X-Creator-Ops-Owner", "")
                    supplied_generation = self.headers.get("X-Creator-Ops-Generation", "")
                    if (
                        not secrets.compare_digest(supplied_owner, ui_host._owner_id)
                        or supplied_generation != str(ui_host._owner_generation)
                    ):
                        raise UIAdapterError(
                            "OWNER_MISMATCH", "Host control does not belong to this lifecycle owner", status=409,
                        )

            def _send_json(self, status: int, payload: Any) -> None:
                data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self._security_headers(no_store=True)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _json_error(self, status: int, code: str, message: str) -> None:
                self._send_json(status, {"ok": False, "error": {"code": code, "message": message}})

            def _security_headers(self, *, no_store: bool) -> None:
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Cross-Origin-Resource-Policy", "same-origin")
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
                    "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
                )
                self.send_header("Cache-Control", "no-store" if no_store else "public, max-age=300")

            def log_message(self, _format: str, *_args: object) -> None:
                return

        return RequestHandler


def create_creator_ops_ui_host(
    *, application: CreatorOpsApplication | None = None,
    host: str = LOOPBACK_HOST,
    port: int = DEFAULT_UI_PORT,
    control_token: str | None = None,
    owner_id: str | None = None,
    owner_generation: int | None = None,
    owner_process_id: int | None = None,
) -> CreatorOpsUIHost:
    """Create the versioned authoritative local UI host without opening it."""

    return CreatorOpsUIHost(
        application or create_creator_ops_application(),
        host=host,
        port=port,
        control_token=control_token,
        owner_id=owner_id,
        owner_generation=owner_generation,
        owner_process_id=owner_process_id,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Creator Ops Local Production UI V0.1")
    parser.add_argument("--host", default=LOOPBACK_HOST, choices=[LOOPBACK_HOST])
    parser.add_argument("--port", type=int, default=DEFAULT_UI_PORT)
    database_override = os.environ.get("CREATOR_OPS_DATABASE")
    parser.add_argument("--database", type=Path, default=Path(database_override) if database_override else None)
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args(argv)
    application = create_creator_ops_application(args.database) if args.database else create_creator_ops_application()
    if args.database and not args.database.exists():
        application.initialize_local_store(confirmation=True)
    ui_host = create_creator_ops_ui_host(
        application=application,
        host=args.host,
        port=args.port,
        control_token=os.environ.get("CREATOR_OPS_INTERNAL_CONTROL_TOKEN") or None,
        owner_id=os.environ.get("CREATOR_OPS_UI_OWNER_ID") or None,
        owner_generation=(
            int(os.environ["CREATOR_OPS_UI_OWNER_GENERATION"])
            if os.environ.get("CREATOR_OPS_UI_OWNER_GENERATION") else None
        ),
        owner_process_id=(
            int(os.environ["CREATOR_OPS_UI_OWNER_PID"])
            if os.environ.get("CREATOR_OPS_UI_OWNER_PID") else None
        ),
    )
    try:
        ui_host.start()
        print(f"Creator Ops Local UI V0.1: {ui_host.url}", flush=True)
        if args.open_browser:
            webbrowser.open(ui_host.url)
        ui_host.wait_until_stopped()
    except KeyboardInterrupt:
        return 0
    finally:
        ui_host.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
