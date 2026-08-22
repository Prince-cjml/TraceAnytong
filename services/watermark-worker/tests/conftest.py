import hashlib

import pytest

from app.models import CarrierProfile, TraceIdentity


@pytest.fixture
def identity() -> TraceIdentity:
    return TraceIdentity("0123456789abcdef0123456789abcdef", "issuance", "profile-2026-08", 1_725_000_000)


@pytest.fixture
def profile() -> CarrierProfile:
    return CarrierProfile("document-screen", "profile-2026-08", "key-1", hashlib.sha256(b"fixed-test-key").digest(), strength=0.18, tile_size=64)
