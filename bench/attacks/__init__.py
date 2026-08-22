from .document import DOCUMENT_ATTACKS, apply_document_attack
from .image import ATTACKS, Attack, apply_attack
from .physical import PHYSICAL_ATTACKS, apply_physical_attack

__all__ = [
    "ATTACKS", "DOCUMENT_ATTACKS", "PHYSICAL_ATTACKS", "Attack",
    "apply_attack", "apply_document_attack", "apply_physical_attack",
]
