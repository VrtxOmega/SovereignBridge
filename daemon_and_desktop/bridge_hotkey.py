"""
Sovereign Bridge — Global Hotkey
==================================
Ctrl+Shift+B: Capture selected text from any app → broadcast to phone.
Uses pynput for global keyboard hook.
"""
import logging
import threading
import time

log = logging.getLogger("Bridge.Hotkey")

_listener = None
_callback = None


def _get_selected_text() -> str | None:
    """
    Grab currently selected text from any app by simulating Ctrl+C,
    reading clipboard, and restoring the original clipboard.
    """
    try:
        import ctypes
        import bridge_clipboard as clip

        # Save current clipboard
        original_seq = clip.get_sequence_number()
        original_text = clip.get_clipboard_text()

        # Simulate Ctrl+C
        INPUT_KEYBOARD = 1
        KEYEVENTF_KEYUP = 0x0002
        VK_CONTROL = 0x11
        VK_C = 0x43

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [
                ("wVk", ctypes.c_ushort),
                ("wScan", ctypes.c_ushort),
                ("dwFlags", ctypes.c_ulong),
                ("time", ctypes.c_ulong),
                ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
            ]

        class INPUT(ctypes.Structure):
            class _I(ctypes.Union):
                _fields_ = [("ki", KEYBDINPUT)]
            _fields_ = [("type", ctypes.c_ulong), ("ii", _I)]

        def send_key(vk, flags=0):
            inp = INPUT()
            inp.type = INPUT_KEYBOARD
            inp.ii.ki.wVk = vk
            inp.ii.ki.dwFlags = flags
            ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

        # Ctrl down, C down, C up, Ctrl up
        send_key(VK_CONTROL)
        send_key(VK_C)
        time.sleep(0.05)
        send_key(VK_C, KEYEVENTF_KEYUP)
        send_key(VK_CONTROL, KEYEVENTF_KEYUP)

        # Wait for clipboard to update
        time.sleep(0.15)

        new_text = clip.get_clipboard_text()

        # Restore original clipboard if we had something
        if original_text and original_text != new_text:
            # We got new text — this is what we want
            # Restore original after a brief delay to let our capture complete
            def _restore():
                time.sleep(0.3)
                clip.set_clipboard_text(original_text)
            threading.Thread(target=_restore, daemon=True).start()

        if new_text and new_text != original_text:
            return new_text
        elif new_text:
            return new_text

        return None

    except Exception as e:
        log.error(f"Failed to get selected text: {e}")
        return None


def _get_foreground_window_title() -> str:
    """Get the title of the foreground window."""
    try:
        import ctypes
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
        return buf.value
    except Exception:
        return "Unknown"


def _on_hotkey():
    """Called when Ctrl+Shift+B is pressed."""
    log.info("[HOTKEY] Ctrl+Shift+B pressed — capturing selected text")

    selected = _get_selected_text()
    if not selected or not selected.strip():
        log.info("[HOTKEY] No text selected")
        return

    source_app = _get_foreground_window_title()
    log.info(f"[HOTKEY] Captured {len(selected)} chars from '{source_app}'")

    if _callback:
        _callback(selected.strip(), source_app)


def start_hotkey_listener(on_capture):
    """
    Start global hotkey listener.
    on_capture(text: str, source_app: str) — called when Ctrl+Shift+B captures text.
    """
    global _listener, _callback
    _callback = on_capture

    try:
        from pynput import keyboard

        # Track modifier state
        ctrl_held = False
        shift_held = False

        def on_press(key):
            nonlocal ctrl_held, shift_held

            if key in (keyboard.Key.ctrl_l, keyboard.Key.ctrl_r):
                ctrl_held = True
            elif key in (keyboard.Key.shift_l, keyboard.Key.shift_r):
                shift_held = True
            elif ctrl_held and shift_held:
                try:
                    if hasattr(key, "char") and key.char and key.char.lower() == "b":
                        threading.Thread(target=_on_hotkey, daemon=True).start()
                except AttributeError:
                    pass

        def on_release(key):
            nonlocal ctrl_held, shift_held
            if key in (keyboard.Key.ctrl_l, keyboard.Key.ctrl_r):
                ctrl_held = False
            elif key in (keyboard.Key.shift_l, keyboard.Key.shift_r):
                shift_held = False

        _listener = keyboard.Listener(on_press=on_press, on_release=on_release)
        _listener.start()
        log.info("[HOTKEY] Global hotkey listener started (Ctrl+Shift+B)")

    except ImportError:
        log.warning("pynput not installed — global hotkey disabled")
    except Exception as e:
        log.error(f"Hotkey listener failed: {e}")


def stop_hotkey_listener():
    global _listener
    if _listener:
        _listener.stop()
        log.info("[HOTKEY] Hotkey listener stopped")
