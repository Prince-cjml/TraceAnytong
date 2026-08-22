from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageEnhance, ImageFilter


@dataclass(frozen=True)
class Attack:
    name: str
    value: float


ATTACKS = (Attack("jpeg", 95), Attack("jpeg", 80), Attack("jpeg", 60), Attack("resize", 0.5), Attack("resize", 0.75), Attack("crop", 0.75), Attack("crop", 0.5), Attack("blur", 1.0), Attack("brightness", 1.15))


def apply_attack(image: Image.Image, attack: Attack) -> Image.Image:
    source = image.convert("RGB")
    if attack.name == "jpeg":
        buffer = BytesIO()
        source.save(buffer, format="JPEG", quality=int(attack.value), optimize=False)
        return Image.open(BytesIO(buffer.getvalue())).copy()
    if attack.name == "resize":
        return source.resize((max(1, int(source.width * attack.value)), max(1, int(source.height * attack.value))))
    if attack.name == "crop":
        width, height = int(source.width * attack.value), int(source.height * attack.value)
        return source.crop(((source.width - width) // 2, (source.height - height) // 2, (source.width + width) // 2, (source.height + height) // 2))
    if attack.name == "blur":
        return source.filter(ImageFilter.GaussianBlur(attack.value))
    if attack.name == "brightness":
        return ImageEnhance.Brightness(source).enhance(attack.value)
    raise ValueError(f"Unsupported attack: {attack.name}")
