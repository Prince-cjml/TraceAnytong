from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import math

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


@dataclass(frozen=True)
class Attack:
    name: str
    value: float


ATTACKS = (
    Attack("jpeg", 95), Attack("jpeg", 80), Attack("jpeg", 60), Attack("jpeg", 40),
    Attack("resize", 0.5), Attack("resize", 0.75), Attack("resize", 1.5),
    Attack("crop", 0.75), Attack("crop", 0.5), Attack("crop", 0.35),
    Attack("rotation", -10), Attack("rotation", -5), Attack("rotation", -2),
    Attack("rotation", 2), Attack("rotation", 5), Attack("rotation", 10),
    Attack("perspective", 0.06), Attack("blur", 1.0), Attack("sharpen", 1.5),
    Attack("gaussian_noise", 8), Attack("brightness", 1.15), Attack("gamma", 0.8),
    Attack("grayscale", 1), Attack("png_to_jpeg", 75), Attack("screenshot_scale", 0.75),
)


def apply_attack(image: Image.Image, attack: Attack) -> Image.Image:
    source = image.convert("RGB")
    if attack.name == "jpeg":
        buffer = BytesIO()
        source.save(buffer, format="JPEG", quality=int(attack.value), optimize=False)
        return Image.open(BytesIO(buffer.getvalue())).copy()
    if attack.name == "resize":
        return source.resize((max(1, int(source.width * attack.value)), max(1, int(source.height * attack.value))), Image.Resampling.LANCZOS)
    if attack.name == "crop":
        width, height = int(source.width * attack.value), int(source.height * attack.value)
        return source.crop(((source.width - width) // 2, (source.height - height) // 2, (source.width + width) // 2, (source.height + height) // 2))
    if attack.name == "blur":
        return source.filter(ImageFilter.GaussianBlur(attack.value))
    if attack.name == "sharpen":
        return ImageEnhance.Sharpness(source).enhance(attack.value)
    if attack.name == "brightness":
        return ImageEnhance.Brightness(source).enhance(attack.value)
    if attack.name == "rotation":
        return source.rotate(attack.value, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white")
    if attack.name == "perspective":
        offset = max(1, round(min(source.size) * attack.value))
        return source.transform(
            source.size,
            Image.Transform.QUAD,
            (offset, 0, source.width - offset, offset, source.width, source.height - offset, 0, source.height),
            resample=Image.Resampling.BICUBIC,
        )
    if attack.name == "gaussian_noise":
        amplitude = int(attack.value)
        pixels = source.load()
        for y in range(source.height):
            for x in range(source.width):
                # The formula is a deterministic pseudo-noise field; no global RNG state is used.
                noise = ((x * 37 + y * 17 + x * y * 13) % (2 * amplitude + 1)) - amplitude
                red, green, blue = pixels[x, y]
                pixels[x, y] = tuple(max(0, min(255, value + noise)) for value in (red, green, blue))
        return source
    if attack.name == "gamma":
        gamma = attack.value
        lut = [round(255 * math.pow(index / 255, gamma)) for index in range(256)]
        return source.point(lut * 3)
    if attack.name == "grayscale":
        return ImageOps.grayscale(source).convert("RGB")
    if attack.name == "png_to_jpeg":
        buffer = BytesIO()
        source.save(buffer, format="JPEG", quality=int(attack.value), optimize=False)
        return Image.open(BytesIO(buffer.getvalue())).convert("RGB")
    if attack.name == "screenshot_scale":
        scaled = source.resize((max(1, round(source.width * attack.value)), max(1, round(source.height * attack.value))), Image.Resampling.LANCZOS)
        return scaled.resize(source.size, Image.Resampling.BICUBIC)
    raise ValueError(f"Unsupported attack: {attack.name}")
