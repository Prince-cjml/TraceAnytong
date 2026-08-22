from PIL import Image

from bench.attacks import Attack, apply_attack, apply_physical_attack


def test_resize_is_deterministic() -> None:
    source = Image.new("RGB", (100, 80), "white")
    assert apply_attack(source, Attack("resize", 0.5)).size == (50, 40)


def test_physical_occlusion_is_repeatable() -> None:
    source = Image.new("RGB", (100, 80), "white")
    first = apply_physical_attack(source, Attack("partial_occlusion", 0.2))
    second = apply_physical_attack(source, Attack("partial_occlusion", 0.2))
    assert first.tobytes() == second.tobytes()
    assert first.getpixel((99, 40)) == (0, 0, 0)
