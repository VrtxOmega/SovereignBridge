"""
Sovereign Bridge — Clipboard Monitor
======================================
Polls the Windows clipboard via ctypes for changes.
Detects text (CF_UNICODETEXT) and images (CF_DIB → PNG).
Self-set guard prevents echo loops.
Manual paste model: phone clipboard is a staging area.
"""
import ctypes
import ctypes.wintypes
import io
import logging
import re
import threading
import time

log = logging.getLogger("Bridge.Clipboard")

# Windows clipboard constants
CF_UNICODETEXT = 13
CF_DIB = 8
CF_BITMAP = 2

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# Track self-set operations to prevent echo loops
_self_set_seq = -1
_lock = threading.Lock()

URL_PATTERN = re.compile(
    r"^https?://[^\s]+$", re.IGNORECASE
)


def _open_clipboard(retries=5, delay=0.05):
    """Open clipboard with retry — other apps may hold it briefly."""
    for _ in range(retries):
        if user32.OpenClipboard(0):
            return True
        time.sleep(delay)
    return False


def _close_clipboard():
    user32.CloseClipboard()


def get_sequence_number() -> int:
    """Get clipboard sequence number — changes on every clipboard update."""
    return user32.GetClipboardSequenceNumber()


def get_clipboard_text() -> str | None:
    """Read text from clipboard. Returns None if no text."""
    if not _open_clipboard():
        return None
    try:
        handle = user32.GetClipboardData(CF_UNICODETEXT)
        if not handle:
            return None
        kernel32.GlobalLock.restype = ctypes.c_wchar_p
        text = kernel32.GlobalLock(handle)
        if text:
            result = str(text)
            kernel32.GlobalUnlock(handle)
            return result
        return None
    except Exception as e:
        log.error(f"Clipboard read error: {e}")
        return None
    finally:
        _close_clipboard()


def get_clipboard_image() -> bytes | None:
    """Read image from clipboard as PNG bytes. Returns None if no image."""
    try:
        from PIL import ImageGrab
        img = ImageGrab.grabclipboard()
        if img is None:
            return None
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except ImportError:
        log.warning("Pillow not installed — image clipboard disabled")
        return None
    except Exception as e:
        log.error(f"Clipboard image read error: {e}")
        return None


def set_clipboard_text(text: str):
    """Write text to clipboard and mark as self-set to prevent echo."""
    global _self_set_seq
    if not _open_clipboard():
        log.error("Failed to open clipboard for writing")
        return False
    try:
        user32.EmptyClipboard()
        data = text.encode("utf-16-le") + b"\x00\x00"
        h = kernel32.GlobalAlloc(0x0042, len(data))  # GMEM_MOVEABLE | GMEM_ZEROINIT
        kernel32.GlobalLock.restype = ctypes.c_void_p
        ptr = kernel32.GlobalLock(h)
        ctypes.memmove(ptr, data, len(data))
        kernel32.GlobalUnlock(h)
        user32.SetClipboardData(CF_UNICODETEXT, h)
        return True
    except Exception as e:
        log.error(f"Clipboard write error: {e}")
        return False
    finally:
        _close_clipboard()
        # Mark the sequence number AFTER close so the new seq is visible
        with _lock:
            _self_set_seq = get_sequence_number()


def classify_content(text: str) -> str:
    """Classify clipboard text content as 'text', 'url', or 'code'."""
    if URL_PATTERN.match(text.strip()):
        return "url"
    return "text"


class ClipboardMonitor:
    """
    Background thread that polls the clipboard for changes.
    Calls on_change(content, format) when clipboard content changes.
    
    format: 'text' | 'image' | 'url'
    content: str for text/url, base64 str for image
    """

    def __init__(self, on_change, poll_interval=0.5):
        self.on_change = on_change
        self.poll_interval = poll_interval
        self._running = False
        self._thread = None
        self._last_seq = get_sequence_number()

    def start(self):
        if self._running:
            return
        self._running = True
        self._last_seq = get_sequence_number()
        self._thread = threading.Thread(
            target=self._poll_loop, daemon=True, name="bridge-clipboard"
        )
        self._thread.start()
        log.info("Clipboard monitor started")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
        log.info("Clipboard monitor stopped")

    def _poll_loop(self):
        while self._running:
            try:
                current_seq = get_sequence_number()

                if current_seq != self._last_seq:
                    self._last_seq = current_seq

                    # Check if this was a self-set operation
                    with _lock:
                        if current_seq == _self_set_seq:
                            continue  # Skip — we set this ourselves

                    # Try text first (most common)
                    text = get_clipboard_text()
                    if text and text.strip():
                        fmt = classify_content(text)
                        self.on_change(text.strip(), fmt)
                        time.sleep(self.poll_interval)
                        continue

                    # Try image
                    import base64
                    img_bytes = get_clipboard_image()
                    if img_bytes:
                        b64 = base64.b64encode(img_bytes).decode("ascii")
                        self.on_change(b64, "image")

            except Exception as e:
                log.error(f"Clipboard poll error: {e}")

            time.sleep(self.poll_interval)
