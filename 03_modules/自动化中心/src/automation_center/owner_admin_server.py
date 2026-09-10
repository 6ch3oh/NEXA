"""Minimal loopback-only read bridge for the OWNER administration UI."""

from __future__ import annotations

from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from automation_center.adapters.owner_read import SQLiteOwnerReadRepository
from automation_center.application.owner_admin import (
    NONPROD_DEMO_DATASET,
    OwnerAdminReadAdapter,
    OwnerAdminRequestError,
)
from automation_center.application.owner_read import OwnerReadQueryService
from automation_center.adapters.request_ledger import RequestNotFoundError


API_PREFIX = "/api/owner-read/"


class OwnerAdminHTTPServer(HTTPServer):

    def __init__(
        self,
        server_address: tuple[str, int],
        adapter: OwnerAdminReadAdapter,
        *,
        dataset_mode: str = NONPROD_DEMO_DATASET,
    ) -> None:
        host, _ = server_address
        if host != "127.0.0.1":
            raise ValueError("OWNER admin bridge must bind exactly to 127.0.0.1")
        if dataset_mode != NONPROD_DEMO_DATASET:
            raise ValueError("v0.1 bridge accepts the NONPROD demo dataset only")
        self.adapter = adapter
        self.dataset_mode = dataset_mode
        super().__init__(server_address, OwnerAdminRequestHandler)


class OwnerAdminRequestHandler(BaseHTTPRequestHandler):
    server: OwnerAdminHTTPServer

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/owner-read/health":
            self._send(HTTPStatus.OK, {"data": {"ready": True}})
            return
        if not parsed.path.startswith(API_PREFIX):
            self._send(HTTPStatus.NOT_FOUND, {"error": "read endpoint not found"})
            return
        operation = parsed.path[len(API_PREFIX):]
        raw = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=30)
        if any(len(values) != 1 for values in raw.values()):
            self._send(HTTPStatus.BAD_REQUEST, {"error": "duplicate query parameter"})
            return
        params = {key: values[0] for key, values in raw.items()}
        try:
            data = self.server.adapter.dispatch(operation, params)
        except OwnerAdminRequestError as error:
            self._send(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        except (RequestNotFoundError, KeyError):
            self._send(HTTPStatus.NOT_FOUND, {"error": "read record not found"})
            return
        except ValueError:
            self._send(HTTPStatus.BAD_REQUEST, {"error": "invalid read request"})
            return
        self._send(HTTPStatus.OK, {"data": data})

    def do_POST(self) -> None:  # noqa: N802
        self._read_only()

    def do_PUT(self) -> None:  # noqa: N802
        self._read_only()

    def do_PATCH(self) -> None:  # noqa: N802
        self._read_only()

    def do_DELETE(self) -> None:  # noqa: N802
        self._read_only()

    def _read_only(self) -> None:
        self._send(
            HTTPStatus.METHOD_NOT_ALLOWED,
            {"error": "OWNER admin v0.1 is read-only"},
            extra_headers={"Allow": "GET"},
        )

    def _send(
        self,
        status: HTTPStatus,
        payload: dict[str, Any],
        *,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        envelope = {
            **payload,
            "meta": {
                "dataset_mode": self.server.dataset_mode,
                "read_only": True,
            },
        }
        encoded = json.dumps(
            envelope, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-NEXA-Dataset", self.server.dataset_mode)
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: Any) -> None:
        return


def create_owner_admin_server(
    ledger_path: str | Path,
    *,
    port: int = 18765,
    clock=None,
) -> tuple[OwnerAdminHTTPServer, SQLiteOwnerReadRepository]:
    """Compose the loopback bridge over the existing read-only repository."""

    repository = SQLiteOwnerReadRepository(ledger_path)
    service = OwnerReadQueryService(repository)
    adapter = OwnerAdminReadAdapter(service, clock=clock)
    try:
        server = OwnerAdminHTTPServer(("127.0.0.1", port), adapter)
    except Exception:
        repository.close()
        raise
    return server, repository
