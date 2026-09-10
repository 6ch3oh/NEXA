"""One-shot subprocess fixture for the frozen consumer CLI process protocol."""

from __future__ import annotations

import json
import sys
import time


def evidence(provider_calls: int) -> dict[str, object]:
    return {
        "provider_call_count": provider_calls,
        "authorization_owned_by_executionhub": True,
        "consumed_permit_owned_by_executionhub": True,
        "credential_owned_by_executionhub": True,
        "credential_exposure": "NO",
        "secret_returned": False,
        "opencode_used": False,
        "tools_enabled": False,
        "file_access_enabled": False,
    }


def response(request: dict[str, object], *, status: str = "COMPLETED") -> dict[str, object]:
    if status == "DENIED":
        return {
            "schema_version": "CREDENTIAL_FREE_CONSUMER_RESPONSE_V1",
            "status": "DENIED",
            "code": "CALLER_NOT_ALLOWED",
            "request_id": request["request_id"],
            "correlation_id": request.get("correlation_id", request["request_id"]),
            "execution_id": "fixture-cli-denied",
            "caller_id": request.get("caller_id"),
            "capability_id": request.get("capability_id"),
            "result": None,
            "provider": None,
            "error_category": "CALLER",
            "safe_evidence": evidence(0),
        }
    if status == "FAILED":
        return {
            "schema_version": "CREDENTIAL_FREE_CONSUMER_RESPONSE_V1",
            "status": "FAILED",
            "code": "PROVIDER_FAILED",
            "request_id": request["request_id"],
            "correlation_id": request.get("correlation_id", request["request_id"]),
            "execution_id": "fixture-cli-failed",
            "caller_id": request.get("caller_id"),
            "capability_id": request.get("capability_id"),
            "result": None,
            "provider": {"provider": "deepseek", "model": "deepseek-v4-flash"},
            "error_category": "PROVIDER",
            "safe_evidence": evidence(0),
        }
    input_value = request["input"]
    selected = input_value["candidates"][:input_value["target_count"]]
    utf8_reason = "中文选择理由：自媒体、星枢优化、人工智能、摄影、足球、长跑；NEXA Mix ✅。"
    return {
        "schema_version": "CREDENTIAL_FREE_CONSUMER_RESPONSE_V1",
        "status": "COMPLETED",
        "code": "CONSUMER_EXECUTION_COMPLETED",
        "request_id": request["request_id"],
        "correlation_id": request.get("correlation_id", request["request_id"]),
        "execution_id": "fixture-cli-completed",
        "caller_id": request["caller_id"],
        "capability_id": request["capability_id"],
        "result": {
            "schema_version": "RADAR_AI_SELECTION_RESULT_V1",
            "request_id": request["request_id"],
            "selections": [
                {
                    "item_id": candidate["candidate_id"],
                    "rank": index,
                    "reason": utf8_reason,
                    "confidence": 0.9,
                }
                for index, candidate in enumerate(selected, 1)
            ],
        },
        "provider": {"provider": "deepseek", "model": "deepseek-v4-flash"},
        "error_category": None,
        "safe_evidence": evidence(1),
    }


raw = sys.stdin.buffer.read()
request = json.loads(raw.decode("utf-8", errors="strict"))
mode = request.get("request_id")


def emit(value: object) -> None:
    serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    sys.stdout.buffer.write(serialized.encode("utf-8"))

if mode == "fixture-timeout":
    time.sleep(5)
elif mode == "fixture-malformed":
    sys.stdout.buffer.write(b"not-json\n")
elif mode == "fixture-oversized-stdout":
    sys.stdout.buffer.write(b"x" * 8192)
elif mode == "fixture-oversized-stderr":
    sys.stderr.write("x" * 8192)
    emit(response(request, status="FAILED"))
    raise SystemExit(3)
elif mode == "fixture-unexpected-stderr":
    sys.stderr.buffer.write(b"unexpected-diagnostic\n")
    emit(response(request))
elif mode == "fixture-unexpected-utf8-stderr":
    sys.stderr.buffer.write("中文诊断：严格 UTF-8。\n".encode("utf-8"))
    emit(response(request))
elif mode == "fixture-invalid-utf8-stderr":
    sys.stderr.buffer.write(b"\xff\xfe\n")
    emit(response(request))
elif mode == "fixture-version-mismatch":
    value = response(request)
    value["schema_version"] = "CREDENTIAL_FREE_CONSUMER_RESPONSE_V0"
    emit(value)
elif mode == "fixture-exit-2":
    emit(response(request, status="DENIED"))
    raise SystemExit(2)
elif mode == "fixture-exit-3":
    emit(response(request, status="FAILED"))
    raise SystemExit(3)
elif mode == "fixture-exit-70":
    sys.stderr.write('{"schema_version":"CREDENTIAL_FREE_CONSUMER_CLI_DIAGNOSTIC_V1","code":"CLI_INTERNAL_FAILURE"}\n')
    raise SystemExit(70)
else:
    emit(response(request))
