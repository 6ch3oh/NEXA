"""Local production UI built only on the controlled Creator Ops public API."""

from creator_ops.ui.adapter import CreatorOpsUIAdapter, UIAdapterError, to_public_json

__all__ = [
    "CreatorOpsUIAdapter",
    "CreatorOpsUIHost",
    "UIEndpoint",
    "UIHostLifecycleState",
    "UIHostReadiness",
    "UIAdapterError",
    "create_creator_ops_ui_host",
    "to_public_json",
]


def __getattr__(name: str):
    """Load the host lazily so ``python -m creator_ops.ui.host`` stays warning-free."""

    if name in {
        "CreatorOpsUIHost",
        "UIEndpoint",
        "UIHostLifecycleState",
        "UIHostReadiness",
        "create_creator_ops_ui_host",
    }:
        from creator_ops.ui import host

        return getattr(host, name)
    raise AttributeError(name)
