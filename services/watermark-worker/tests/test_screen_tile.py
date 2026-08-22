import numpy as np
from PIL import Image

from app.carriers.screen_tile import ScreenTileCarrier


def tiled_evidence(carrier, identity, profile):
    field = carrier.field(identity, profile)
    # Synthetic rendered page: base content plus a deterministic low energy carrier.
    raster = np.full((256, 320), 185.0, dtype=np.float32)
    raster += 16 * np.tile(field, (4, 5))[:, :320]
    return Image.fromarray(np.clip(raster, 0, 255).astype(np.uint8), "L")


def test_tile_generation_is_deterministic(identity, profile):
    carrier = ScreenTileCarrier()
    assert np.array_equal(carrier.field(identity, profile), carrier.field(identity, profile))


def test_candidate_correlation_prefers_matching_identity(identity, profile):
    carrier = ScreenTileCarrier()
    evidence = tiled_evidence(carrier, identity, profile)
    matched = carrier.detect_candidate(evidence, identity, profile)
    other = type(identity)("fedcba9876543210fedcba9876543210", "issuance", identity.profile_version, identity.created_at)
    mismatched = carrier.detect_candidate(evidence, other, profile)
    assert matched.score > 0.75
    assert matched.score > mismatched.score + 0.30
    assert "margin" in matched.raw
