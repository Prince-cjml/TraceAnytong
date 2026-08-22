"""Deterministic screen/print-camera channel simulations."""

from __future__ import annotations

import math

from PIL import Image, ImageEnhance, ImageFilter

from .image import Attack, apply_attack


PHYSICAL_ATTACKS = (
    Attack("physical_perspective", 0.08), Attack("physical_gamma", 1.18),
    Attack("white_balance", 1.10), Attack("moire_resample", 0.63),
    Attack("defocus", 1.4), Attack("sensor_noise", 10), Attack("physical_jpeg", 60),
    Attack("vignette", 0.45), Attack("partial_occlusion", 0.2),
)


def apply_physical_attack(image: Image.Image, attack: Attack) -> Image.Image:
    source = image.convert("RGB")
    if attack.name == "physical_perspective":
        return apply_attack(source, Attack("perspective", attack.value))
    if attack.name == "physical_gamma":
        return apply_attack(source, Attack("gamma", attack.value))
    if attack.name == "white_balance":
        red, green, blue = source.split()
        return Image.merge("RGB", (ImageEnhance.Brightness(red).enhance(attack.value), green, ImageEnhance.Brightness(blue).enhance(2 - attack.value)))
    if attack.name == "moire_resample":
        scaled = source.resize((max(1, round(source.width * attack.value)), max(1, round(source.height * attack.value))), Image.Resampling.NEAREST)
        return scaled.resize(source.size, Image.Resampling.NEAREST)
    if attack.name == "defocus":
        return source.filter(ImageFilter.GaussianBlur(attack.value))
    if attack.name == "sensor_noise":
        return apply_attack(source, Attack("gaussian_noise", attack.value))
    if attack.name == "physical_jpeg":
        return apply_attack(source, Attack("jpeg", attack.value))
    if attack.name == "vignette":
        pixels = source.load()
        centre_x, centre_y = (source.width - 1) / 2, (source.height - 1) / 2
        maximum = math.hypot(centre_x, centre_y) or 1
        for y in range(source.height):
            for x in range(source.width):
                distance = math.hypot(x - centre_x, y - centre_y) / maximum
                factor = 1 - attack.value * distance * distance
                pixels[x, y] = tuple(round(channel * factor) for channel in pixels[x, y])
        return source
    if attack.name == "partial_occlusion":
        result = source.copy()
        width = max(1, round(source.width * attack.value))
        result.paste((0, 0, 0), (source.width - width, 0, source.width, source.height))
        return result
    raise ValueError(f"Unsupported physical attack: {attack.name}")
