from PIL import Image

from bench.attacks import Attack, apply_attack


def test_resize_is_deterministic() -> None:
    source = Image.new("RGB", (100, 80), "white")
    assert apply_attack(source, Attack("resize", 0.5)).size == (50, 40)
