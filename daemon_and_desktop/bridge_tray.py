"""
Sovereign Bridge — System Tray
================================
Gold Ω icon in system tray with status, QR pairing window, and dropzone.
Uses pystray for tray icon, tkinter for QR display window.
"""
import io
import logging
import os
import threading
import time
import webbrowser
import subprocess
from pathlib import Path
log = logging.getLogger("Bridge.Tray")

PORT = 5003
DROPZONE_DIR = os.path.expanduser("~/.veritas/bridge/dropzone")

_tray_icon = None
_running = False


def _create_icon_image(connected: bool = False):
    """Generate a gold Ω on obsidian background as tray icon."""
    try:
        from PIL import Image, ImageDraw, ImageFont

        size = 64
        img = Image.new("RGBA", (size, size), (10, 10, 10, 255))
        draw = ImageDraw.Draw(img)

        # Gold circle border
        gold = (212, 175, 55, 255)
        border_color = (0, 200, 0, 255) if connected else gold
        draw.ellipse([2, 2, size - 3, size - 3], outline=border_color, width=2)

        # Ω symbol
        try:
            font = ImageFont.truetype("arial.ttf", 36)
        except IOError:
            font = ImageFont.load_default()

        text = "Ω"
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        x = (size - tw) // 2
        y = (size - th) // 2 - 4
        draw.text((x, y), text, fill=gold, font=font)

        return img
    except ImportError:
        log.warning("Pillow not installed — tray icon unavailable")
        return None


def _show_qr_window():
    """Open a small tkinter window showing the pairing QR code."""
    try:
        import tkinter as tk
        from io import BytesIO
        from urllib.request import urlopen, Request

        def _fetch_and_show():
            root = tk.Tk()
            root.title("Sovereign Bridge — Pairing")
            root.configure(bg="#0A0A0A")
            root.resizable(False, False)

            # Center on screen
            root.geometry("400x500")
            root.eval("tk::PlaceWindow . center")

            # Title
            title = tk.Label(
                root,
                text="SOVEREIGN BRIDGE",
                font=("Segoe UI", 16, "bold"),
                fg="#D4AF37",
                bg="#0A0A0A",
            )
            title.pack(pady=(20, 5))

            subtitle = tk.Label(
                root,
                text="Scan to pair your phone",
                font=("Segoe UI", 11),
                fg="#888888",
                bg="#0A0A0A",
            )
            subtitle.pack(pady=(0, 15))

            # Fetch QR image
            try:
                req = Request(
                    f"http://127.0.0.1:{PORT}/api/pair/qr",
                    headers={"Bypass-Tunnel-Reminder": "true"},
                )
                response = urlopen(req, timeout=5)
                qr_data = response.read()

                from PIL import Image, ImageTk

                img = Image.open(BytesIO(qr_data))
                img = img.resize((300, 300), Image.NEAREST)
                photo = ImageTk.PhotoImage(img)

                label = tk.Label(root, image=photo, bg="#0A0A0A")
                label.image = photo  # Keep reference
                label.pack(pady=10)

            except Exception as e:
                error_label = tk.Label(
                    root,
                    text=f"QR unavailable\n{e}",
                    font=("Segoe UI", 10),
                    fg="#FF4444",
                    bg="#0A0A0A",
                )
                error_label.pack(pady=20)

            # Motto
            motto = tk.Label(
                root,
                text="Examina omnia, venerare nihil,\npro te cogita",
                font=("Segoe UI", 9, "italic"),
                fg="#555555",
                bg="#0A0A0A",
            )
            motto.pack(pady=(15, 10))

            # Close button
            close_btn = tk.Button(
                root,
                text="Close",
                command=root.destroy,
                font=("Segoe UI", 10),
                fg="#0A0A0A",
                bg="#D4AF37",
                activebackground="#F9E596",
                relief="flat",
                padx=20,
                pady=5,
            )
            close_btn.pack(pady=(0, 20))

            root.mainloop()

        thread = threading.Thread(target=_fetch_and_show, daemon=True)
        thread.start()

    except ImportError:
        log.warning("tkinter not available for QR window")
        webbrowser.open(f"http://127.0.0.1:{PORT}/api/pair/qr")


def _open_dropzone():
    """Open the dropzone folder in Explorer."""
    os.makedirs(DROPZONE_DIR, exist_ok=True)
    os.startfile(DROPZONE_DIR)


def _open_dashboard():
    """Open desktop electron dashboard."""
    log.info("Launching Desktop Dashboard...")
    try:
        # Determine the dynamic absolute path for the desktop folder
        bridge_root = Path(__file__).parent.resolve()
        desktop_dir = bridge_root / "desktop"
        
        # Try to run npm run dev
        subprocess.Popen(
            ["npm", "run", "dev"], 
            cwd=str(desktop_dir),
            creationflags=subprocess.CREATE_NEW_CONSOLE,
            shell=True
        )
    except Exception as e:
        log.error(f"Failed to launch dashboard: {e}")


def _quit_app(icon, item):
    """Quit the tray icon."""
    global _running
    _running = False
    icon.stop()


def start_tray(daemon_running_event=None):
    """Start the system tray icon. Blocks the calling thread."""
    global _tray_icon, _running

    try:
        import pystray
        from pystray import MenuItem, Menu
    except ImportError:
        log.warning("pystray not installed — system tray disabled")
        return

    icon_image = _create_icon_image(connected=False)
    if icon_image is None:
        return

    menu = Menu(
        MenuItem("Sovereign Bridge", None, enabled=False),
        Menu.SEPARATOR,
        MenuItem("Show Pairing QR", lambda: _show_qr_window()),
        MenuItem("Open Dropzone", lambda: _open_dropzone()),
        MenuItem("Open Dashboard", lambda: _open_dashboard()),
        Menu.SEPARATOR,
        MenuItem("Quit", _quit_app),
    )

    _tray_icon = pystray.Icon(
        name="SovereignBridge",
        icon=icon_image,
        title="Sovereign Bridge — 0 devices",
        menu=menu,
    )

    _running = True
    log.info("[TRAY] System tray icon started")
    _tray_icon.run()


def update_tray_status(connected_count: int):
    """Update tray icon to reflect connection status."""
    global _tray_icon
    if _tray_icon is None:
        return

    _tray_icon.icon = _create_icon_image(connected=connected_count > 0)
    _tray_icon.title = f"Sovereign Bridge — {connected_count} device{'s' if connected_count != 1 else ''}"


def stop_tray():
    global _tray_icon, _running
    _running = False
    if _tray_icon:
        _tray_icon.stop()
