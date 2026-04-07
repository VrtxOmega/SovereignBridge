"""
Sovereign Bridge — OCR Module
===============================
Extract text from images using Tesseract.
Graceful fallback if Tesseract not installed.
"""
import logging
import os

log = logging.getLogger("Bridge.OCR")

_tesseract_available = None


def _check_tesseract():
    global _tesseract_available
    if _tesseract_available is not None:
        return _tesseract_available

    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        _tesseract_available = True
        log.info("[OCR] Tesseract available")
    except Exception:
        _tesseract_available = False
        log.info("[OCR] Tesseract not installed — OCR disabled (graceful)")
    return _tesseract_available


def extract_text(image_path: str) -> str:
    """
    Extract text from an image file using Tesseract OCR.
    Returns empty string if Tesseract is not available or extraction fails.
    """
    if not _check_tesseract():
        return ""

    if not os.path.exists(image_path):
        return ""

    try:
        import pytesseract
        from PIL import Image

        img = Image.open(image_path)
        text = pytesseract.image_to_string(img)
        text = text.strip()

        if text:
            log.info(f"[OCR] Extracted {len(text)} chars from {os.path.basename(image_path)}")
        return text

    except Exception as e:
        log.error(f"[OCR] Extraction failed for {image_path}: {e}")
        return ""


def extract_text_from_bytes(image_bytes: bytes) -> str:
    """Extract text from raw image bytes."""
    if not _check_tesseract():
        return ""

    try:
        import pytesseract
        from PIL import Image
        from io import BytesIO

        img = Image.open(BytesIO(image_bytes))
        text = pytesseract.image_to_string(img)
        return text.strip()

    except Exception as e:
        log.error(f"[OCR] Extraction from bytes failed: {e}")
        return ""
