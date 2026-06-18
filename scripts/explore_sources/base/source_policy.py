from __future__ import annotations

from dashboard.provider_registry import (
    PROHIBITED_SYSTEMATIC_SOURCES,
    PROVIDER_REGISTRY,
    assert_provider_allowed,
)

PERMITTED_PRODUCTION_SOURCES = set(PROVIDER_REGISTRY)


def assert_source_allowed(source: str) -> None:
    assert_provider_allowed(source)
