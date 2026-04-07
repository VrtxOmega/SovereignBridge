"""
Sovereign Bridge — Main Daemon
================================
aiohttp server on port 5003.
WebSocket relay, clipboard monitor, file watcher, QR pairing.
All data stays local. Tunnel is traversal only.

Usage:
    python bridge_daemon.py
    pythonw bridge_daemon.py   (headless, no console)
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
import signal
import sys
import time
from pathlib import Path

import aiohttp
from aiohttp import web
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Crypto Shim
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad

# TODO: Change this before deployment
STATIC_SECRET = hashlib.sha256(b"YOUR_SECURE_PASSPHRASE_HERE").digest()

def encrypt_payload(payload_dict: dict) -> str:
    iv = os.urandom(16)
    cipher = AES.new(STATIC_SECRET, AES.MODE_CBC, iv)
    payload_bytes = json.dumps(payload_dict).encode("utf-8")
    ct_bytes = cipher.encrypt(pad(payload_bytes, AES.block_size))
    return base64.b64encode(iv).decode("utf-8") + ":" + base64.b64encode(ct_bytes).decode("utf-8")

def decrypt_payload(payload_str: str) -> dict:
    parts = payload_str.split(":")
    if len(parts) != 2:
        return json.loads(payload_str)
    iv = base64.b64decode(parts[0])
    ct = base64.b64decode(parts[1])
    cipher = AES.new(STATIC_SECRET, AES.MODE_CBC, iv)
    pt = unpad(cipher.decrypt(ct), AES.block_size)
    return json.loads(pt.decode("utf-8"))

async def send_payload(ws, data: dict):
    """Encrypt and send JSON payload."""
    try:
        enc_str = encrypt_payload(data)
        await ws.send_str(enc_str)
    except Exception as e:
        log.error(f"[WS] Failed to send encrypted payload: {e}")

# Bridge modules
import bridge_db as db
import bridge_clipboard as clip
import bridge_chunked as chunked
import bridge_tray as tray

# ══════════════════════════════════════════════════════════════
# LOGGING
# ══════════════════════════════════════════════════════════════
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("Bridge")

# ══════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════
PORT = 5003
HOST = "0.0.0.0"
TUNNEL_SUBDOMAIN = "sovereign-bridge-vrts"
TUNNEL_URL = f"https://{TUNNEL_SUBDOMAIN}.loca.lt"

# ══════════════════════════════════════════════════════════════
# STATE
# ══════════════════════════════════════════════════════════════
connected_clients = set()   # WebSocket objects
paired_devices = {}         # device_id → {name, paired_at}
_bridge_clipboard = None    # Staging area for phone → PC clipboard (manual paste)

def show_toast(title: str, msg: str):
    """Trigger a native Windows 10/11 toast notification."""
    try:
        from winotify import Notification, audio
        toast = Notification(
            app_id="Sovereign Bridge",
            title=title,
            msg=msg,
            icon=str(Path(__file__).parent.absolute() / "desktop" / "icon.png"),
            duration="short"
        )
        toast.set_audio(audio.Default, loop=False)
        toast.show()
    except ImportError:
        pass
    except Exception as e:
        log.error(f"[TOAST] Failed to show toast: {e}")

# ══════════════════════════════════════════════════════════════
# WEBSOCKET HANDLER
# ══════════════════════════════════════════════════════════════

async def handle_ws(request):
    ws = web.WebSocketResponse(
        heartbeat=30,
        max_msg_size=16 * 1024 * 1024,  # 16MB max for chunked transfers
    )
    await ws.prepare(request)
    connected_clients.add(ws)
    device_name = "unknown"
    log.info(f"[WS] Client connected ({len(connected_clients)} total)")

    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    data = decrypt_payload(msg.data)
                    await handle_message(ws, data)
                except json.JSONDecodeError:
                    log.warning("[WS] Invalid JSON received")
                except Exception as e:
                    log.error(f"[WS] Message handler error: {e}")
            elif msg.type == aiohttp.WSMsgType.ERROR:
                log.error(f"[WS] Error: {ws.exception()}")
    finally:
        connected_clients.discard(ws)
        log.info(f"[WS] Client disconnected ({len(connected_clients)} total)")

    return ws


async def handle_message(ws, data: dict):
    msg_type = data.get("type", "")

    # ── Heartbeat ──
    if msg_type == "PING":
        await send_payload(ws, {"type": "PONG", "ts": int(time.time() * 1000)})
        return

    # ── Device registration ──
    if msg_type == "REGISTER_DEVICE":
        device_id = data.get("device_id", "unknown")
        device_name = data.get("device_name", "Phone")
        paired_devices[device_id] = {
            "name": device_name,
            "paired_at": int(time.time() * 1000),
        }
        log.info(f"[WS] Device registered: {device_name} ({device_id})")
        await send_payload(ws, {
            "type": "REGISTERED",
            "status": "ok",
            "server": "SovereignBridge",
            "ts": int(time.time() * 1000),
        })
        return

    # ── Clipboard from phone (manual paste staging) ──
    if msg_type == "CLIPBOARD_UPDATE":
        global _bridge_clipboard
        content = data.get("content", "")
        fmt = data.get("format", "text")  # text, url, image
        source = data.get("source", "phone")

        _bridge_clipboard = {
            "content": content,
            "format": fmt,
            "source": source,
            "timestamp": int(time.time() * 1000),
        }

        # Store in capture history
        db.insert_capture(
            capture_type="clipboard",
            content=content[:4096] if fmt != "image" else "[image]",
            source=source,
            lane=data.get("lane", "ephemeral"),
            metadata={"format": fmt},
        )
        log.info(f"[CLIPBOARD] Staged from {source}: {fmt} ({len(content)} chars)")
        if source != "pc":
            show_toast("Sovereign Bridge", f"Clipboard received: {fmt}")

        # Broadcast to other connected clients (not back to sender)
        await broadcast(data, exclude=ws)
        return

    # ── Bridge Paste (phone requests current PC clipboard staging) ──
    if msg_type == "PASTE_REQUEST":
        if _bridge_clipboard:
            await send_payload(ws, {
                "type": "PASTE_RESPONSE",
                **_bridge_clipboard,
            })
        else:
            await send_payload(ws, {
                "type": "PASTE_RESPONSE",
                "content": "",
                "format": "text",
                "source": "pc",
                "timestamp": 0,
            })
        return

    # ── Config Toggles ──
    if msg_type == "SET_AUTO_SYNC":
        global _auto_sync_enabled
        _auto_sync_enabled = data.get("enabled", False)
        log.info(f"[CONFIG] AUTO_SYNC set to {_auto_sync_enabled}")
        return

    # ── Photo/image from phone (base64 encoded) ──
    if msg_type == "PHOTO_CAPTURE":
        image_b64 = data.get("data_b64", "")
        filename = data.get("filename", f"photo_{int(time.time())}.jpg")
        source = data.get("source", "phone")

        if image_b64:
            import base64 as b64mod
            try:
                img_bytes = b64mod.b64decode(image_b64)
                dest = str(db.CAPTURES_DIR / filename)
                if os.path.exists(dest):
                    base_name, ext = os.path.splitext(filename)
                    dest = str(db.CAPTURES_DIR / f"{base_name}_{int(time.time())}{ext}")

                with open(dest, "wb") as f:
                    f.write(img_bytes)

                capture = db.insert_capture(
                    capture_type="photo",
                    content=filename,
                    source=source,
                    filename=os.path.basename(dest),
                    file_path=dest,
                    file_size=len(img_bytes),
                    lane="persistent",
                )

                # OCR on image
                if capture:
                    try:
                        from bridge_ocr import extract_text
                        ocr_text = extract_text(dest)
                        if ocr_text:
                            conn = db.get_conn()
                            conn.execute(
                                "UPDATE captures SET ocr_text = ? WHERE id = ?",
                                (ocr_text, capture["id"]),
                            )
                            conn.commit()
                            conn.close()
                    except ImportError:
                        pass

                log.info(f"[PHOTO] Received from {source}: {filename} ({len(img_bytes)} bytes)")
                if source != "pc":
                    show_toast("Sovereign Bridge - Capture", f"Received: {filename}")

                # Broadcast thumbnail (first 50KB of base64) to other clients
                thumb_b64 = image_b64[:65536] if len(image_b64) > 65536 else image_b64
                await broadcast({
                    "type": "PHOTO_RECEIVED",
                    "filename": os.path.basename(dest),
                    "file_size": len(img_bytes),
                    "source": source,
                    "thumbnail_b64": thumb_b64,
                    "capture_id": capture["id"] if capture else None,
                    "timestamp": int(time.time() * 1000),
                }, exclude=ws)

            except Exception as e:
                log.error(f"[PHOTO] Failed to save: {e}")
        return

    # ── Clipboard image (base64 PNG from either side) ──
    if msg_type == "CLIPBOARD_IMAGE":
        image_b64 = data.get("data_b64", "")
        source = data.get("source", "phone")
        filename = f"clipboard_{int(time.time())}.png"

        if image_b64:
            import base64 as b64mod
            try:
                img_bytes = b64mod.b64decode(image_b64)
                dest = str(db.CAPTURES_DIR / filename)

                with open(dest, "wb") as f:
                    f.write(img_bytes)

                capture = db.insert_capture(
                    capture_type="clipboard",
                    content="[image]",
                    source=source,
                    filename=filename,
                    file_path=dest,
                    file_size=len(img_bytes),
                    lane="ephemeral",
                    metadata={"format": "image"},
                )

                log.info(f"[CLIPBOARD-IMG] Saved: {filename} ({len(img_bytes)} bytes)")
                if source != "pc":
                    show_toast("Sovereign Bridge - File", "Clipboard Image Received")

                await broadcast({
                    "type": "CLIPBOARD_IMAGE",
                    "data_b64": image_b64[:65536],
                    "filename": filename,
                    "file_size": len(img_bytes),
                    "source": source,
                    "capture_id": capture["id"] if capture else None,
                    "timestamp": int(time.time() * 1000),
                }, exclude=ws)

            except Exception as e:
                log.error(f"[CLIPBOARD-IMG] Failed: {e}")
        return

    # ── File transfer (chunked) ──
    if msg_type == "FILE_CHUNK":
        app = ws._req.app
        reassembler = app["reassembler"]
        reassembler.feed(data)
        return

    # ── Note sync ──
    if msg_type == "NOTE_UPDATE":
        note_id = data.get("note_id")
        content = data.get("content", "")
        source = data.get("source", "phone")

        if note_id:
            result = db.update_note(note_id, content, source)
        else:
            result = db.create_note(
                title=data.get("title", "Untitled"),
                content=content,
                source=source,
            )

        if result:
            await broadcast({
                "type": "NOTE_UPDATED",
                **result,
            }, exclude=ws)
        return

    # ── Link beam ──
    if msg_type == "LINK_BEAM":
        url = data.get("url", "")
        title = data.get("title", "")
        source = data.get("source", "phone")

        db.insert_capture(
            capture_type="link",
            content=url,
            source=source,
            metadata={"title": title},
        )

        # Open in default browser on PC if from phone
        if source == "phone":
            import webbrowser
            webbrowser.open(url)
            log.info(f"[LINK] Opened from phone: {url}")

        await broadcast(data, exclude=ws)
        return

    # ── History request ──
    if msg_type == "HISTORY_REQUEST":
        captures = db.get_captures(
            limit=data.get("limit", 50),
            capture_type=data.get("capture_type"),
            tag=data.get("tag"),
        )
        await send_payload(ws, {
            "type": "HISTORY_RESPONSE",
            "captures": captures,
        })
        return

    # ── Notes list request ──
    if msg_type == "NOTES_REQUEST":
        notes = db.get_notes()
        await send_payload(ws, {
            "type": "NOTES_RESPONSE",
            "notes": notes,
        })
        return

    # ── Tag update ──
    if msg_type == "TAG_UPDATE":
        capture_id = data.get("capture_id")
        tags = data.get("tags", [])
        if capture_id:
            db.update_capture_tags(capture_id, tags)
            await broadcast(data, exclude=ws)
        return

    # ── Lane toggle ──
    if msg_type == "LANE_UPDATE":
        capture_id = data.get("capture_id")
        lane = data.get("lane", "ephemeral")
        if capture_id:
            db.update_capture_lane(capture_id, lane)
            await broadcast(data, exclude=ws)
        return

    # ── Sync request (initial state hydration) ──
    if msg_type == "SYNC_REQUEST":
        captures = db.get_captures(limit=100)
        notes = db.get_notes()
        await send_payload(ws, {
            "type": "SYNC_RESPONSE",
            "captures": captures,
            "notes": notes,
            "paired_devices": list(paired_devices.values()),
        })
        return

    log.warning(f"[WS] Unknown message type: {msg_type}")


async def broadcast(data: dict, exclude=None):
    """Broadcast message to all connected clients except the sender."""
    dead = set()
    for ws in connected_clients:
        if ws is exclude:
            continue
        try:
            await send_payload(ws, data)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


# ══════════════════════════════════════════════════════════════
# CLIPBOARD MONITOR INTEGRATION
# ══════════════════════════════════════════════════════════════

_auto_sync_enabled = False

def on_clipboard_change(content: str, fmt: str):
    """Called by ClipboardMonitor when PC clipboard changes."""
    global _bridge_clipboard, _auto_sync_enabled
    if not _auto_sync_enabled:
        return

    _bridge_clipboard = {
        "content": content,
        "format": fmt,
        "source": "pc",
        "timestamp": int(time.time() * 1000),
    }

    # Store in capture history
    db.insert_capture(
        capture_type="clipboard",
        content=content[:4096] if fmt != "image" else "[image]",
        source="pc",
        lane="ephemeral",
        metadata={"format": fmt},
    )

    # Broadcast to all connected phones
    asyncio.get_event_loop().call_soon_threadsafe(
        asyncio.ensure_future,
        broadcast({
            "type": "CLIPBOARD_UPDATE",
            "content": content,
            "format": fmt,
            "source": "pc",
            "timestamp": int(time.time() * 1000),
        }),
    )
    log.info(f"[CLIPBOARD] PC clipboard changed: {fmt} ({len(content)} chars)")


# ══════════════════════════════════════════════════════════════
# FILE WATCHER (DROPZONE)
# ══════════════════════════════════════════════════════════════

class DropzoneHandler(FileSystemEventHandler):
    """Watches ~/.veritas/bridge/dropzone/ for new files."""

    def on_created(self, event):
        if event.is_directory:
            return
        path = event.src_path
        log.info(f"[DROPZONE] New file detected: {path}")

        # Wait for file to finish writing
        time.sleep(0.5)

        try:
            # Hash and store
            fhash = chunked.file_hash(path)
            fsize = os.path.getsize(path)
            filename = os.path.basename(path)

            # Move to captures dir
            dest = str(db.CAPTURES_DIR / filename)
            if os.path.exists(dest):
                base, ext = os.path.splitext(filename)
                dest = str(db.CAPTURES_DIR / f"{base}_{int(time.time())}{ext}")

            import shutil
            shutil.move(path, dest)

            capture = db.insert_capture(
                capture_type="file",
                content=filename,
                source="pc",
                filename=filename,
                file_path=dest,
                file_size=fsize,
                lane="persistent",
            )

            if capture:
                # Send chunked to connected phones
                asyncio.get_event_loop().call_soon_threadsafe(
                    asyncio.ensure_future,
                    _send_file_to_phones(dest, filename),
                )
                log.info(f"[DROPZONE] File queued for transfer: {filename} ({fsize} bytes)")
        except Exception as e:
            log.error(f"[DROPZONE] Error processing {path}: {e}")


async def _send_file_to_phones(file_path: str, filename: str):
    """Send file to all connected phones via chunked transfer."""
    for chunk_data in chunked.chunk_file(file_path):
        await broadcast(chunk_data)
        await asyncio.sleep(0.01)  # Yield to event loop between chunks


# ══════════════════════════════════════════════════════════════
# CHUNK REASSEMBLY (phone → PC files)
# ══════════════════════════════════════════════════════════════

def on_transfer_complete(transfer_id: str, filename: str, data: bytes, file_hash: str):
    """Called when a chunked file transfer from phone is complete."""
    dest = str(db.CAPTURES_DIR / filename)
    if os.path.exists(dest):
        base, ext = os.path.splitext(filename)
        dest = str(db.CAPTURES_DIR / f"{base}_{int(time.time())}{ext}")

    with open(dest, "wb") as f:
        f.write(data)

    capture = db.insert_capture(
        capture_type="photo" if _is_image(filename) else "file",
        content=filename,
        source="phone",
        filename=filename,
        file_path=dest,
        file_size=len(data),
        lane="persistent",
    )

    # Try OCR on images
    if _is_image(filename):
        try:
            from bridge_ocr import extract_text
            ocr_text = extract_text(dest)
            if ocr_text and capture:
                conn = db.get_conn()
                conn.execute(
                    "UPDATE captures SET ocr_text = ? WHERE id = ?",
                    (ocr_text, capture["id"]),
                )
                conn.commit()
                conn.close()
        except ImportError:
            pass  # OCR not available — graceful

    log.info(f"[TRANSFER] Complete: {filename} → {dest}")
    show_toast("Sovereign Bridge - File", f"Transfer Complete: {filename}")


def _is_image(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    return ext in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"}


# ══════════════════════════════════════════════════════════════
# EXPIRY SWEEPER
# ══════════════════════════════════════════════════════════════

async def expiry_sweeper():
    """Periodic task to clean up expired ephemeral captures."""
    while True:
        try:
            count = db.sweep_expired()
            if count > 0:
                log.info(f"[SWEEPER] Cleaned {count} expired captures")
        except Exception as e:
            log.error(f"[SWEEPER] Error: {e}")
        await asyncio.sleep(60)


# ══════════════════════════════════════════════════════════════
# HTTP ENDPOINTS
# ══════════════════════════════════════════════════════════════

async def health(request):
    return web.json_response({
        "status": "ok",
        "service": "SovereignBridge",
        "port": PORT,
        "clients": len(connected_clients),
        "paired_devices": len(paired_devices),
        "ts": int(time.time() * 1000),
    })


async def api_history(request):
    limit = int(request.query.get("limit", "50"))
    capture_type = request.query.get("type")
    tag = request.query.get("tag")
    lane = request.query.get("lane")
    search = request.query.get("search")
    offset = int(request.query.get("offset", "0"))

    captures = db.get_captures(
        limit=limit,
        capture_type=capture_type if capture_type != "all" else None,
        tag=tag,
        lane=lane,
        search=search,
        offset=offset,
    )
    return web.json_response({"captures": captures})


async def api_notes(request):
    notes = db.get_notes()
    return web.json_response({"notes": notes})


async def api_note_detail(request):
    note_id = request.match_info["id"]
    note = db.get_note(note_id)
    if not note:
        return web.json_response({"error": "Not found"}, status=404)
    history = db.get_note_history(note_id)
    return web.json_response({"note": note, "history": history})


async def api_download(request):
    """Serve a captured file by ID with Range header support."""
    capture_id = request.match_info["id"]
    capture = db.get_capture(capture_id)

    if not capture or not capture.get("file_path"):
        return web.json_response({"error": "Not found"}, status=404)

    path = capture["file_path"]
    if not os.path.exists(path):
        return web.json_response({"error": "File missing"}, status=404)

    return web.FileResponse(path)


async def api_upload(request):
    """Receive a file upload via multipart form."""
    reader = await request.multipart()
    field = await reader.next()

    if field is None:
        return web.json_response({"error": "No file"}, status=400)

    filename = field.filename or f"upload_{int(time.time())}"
    dest = str(db.CAPTURES_DIR / filename)

    with open(dest, "wb") as f:
        while True:
            chunk = await field.read_chunk(65536)
            if not chunk:
                break
            f.write(chunk)

    fsize = os.path.getsize(dest)
    capture = db.insert_capture(
        capture_type="photo" if _is_image(filename) else "file",
        content=filename,
        source=request.query.get("source", "phone"),
        filename=filename,
        file_path=dest,
        file_size=fsize,
        lane="persistent",
    )

    return web.json_response({
        "status": "ok",
        "capture": capture,
    })


async def api_clipboard(request):
    """GET: current bridge clipboard staging. POST: set from external source."""
    if request.method == "GET":
        return web.json_response({
            "clipboard": _bridge_clipboard or {
                "content": "",
                "format": "text",
                "source": "pc",
                "timestamp": 0,
            }
        })

    if request.method == "POST":
        data = await request.json()
        content = data.get("content", "")
        fmt = data.get("format", "text")

        if fmt == "text" or fmt == "url":
            clip.set_clipboard_text(content)

        return web.json_response({"status": "ok"})


async def api_pair_qr(request):
    """Generate a QR code PNG containing the pairing URL."""
    try:
        import qrcode
        from io import BytesIO

        pair_data = json.dumps({
            "type": "sovereign_bridge",
            "ws": f"wss://{TUNNEL_SUBDOMAIN}.loca.lt/ws",
            "http": TUNNEL_URL,
            "ts": int(time.time()),
        })

        qr = qrcode.QRCode(version=1, box_size=10, border=2)
        qr.add_data(pair_data)
        qr.make(fit=True)

        from PIL import Image as PILImage
        img = qr.make_image(fill_color="#D4AF37", back_color="#0A0A0A")

        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        return web.Response(
            body=buf.read(),
            content_type="image/png",
            headers={"Cache-Control": "no-cache"},
        )
    except ImportError:
        # qrcode or Pillow not installed — return JSON fallback
        return web.json_response({
            "pair_url": f"wss://{TUNNEL_SUBDOMAIN}.loca.lt/ws",
            "http_url": TUNNEL_URL,
            "qr_available": False,
            "install_hint": "pip install qrcode[pil]",
        })


async def api_pair_info(request):
    """Return pairing info as JSON for the mobile app QR scanner."""
    return web.json_response({
        "type": "sovereign_bridge",
        "ws": f"wss://{TUNNEL_SUBDOMAIN}.loca.lt/ws",
        "ws_local": f"ws://{_get_local_ip()}:{PORT}/ws",
        "http": TUNNEL_URL,
        "http_local": f"http://{_get_local_ip()}:{PORT}",
        "paired_devices": len(paired_devices),
    })


def _get_local_ip():
    """Get the local LAN IP address."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ══════════════════════════════════════════════════════════════
# CORS MIDDLEWARE
# ══════════════════════════════════════════════════════════════

@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        return web.Response(
            status=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Max-Age": "86400",
            },
        )
    response = await handler(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response


# ══════════════════════════════════════════════════════════════
# APP SETUP
# ══════════════════════════════════════════════════════════════

def setup_app():
    app = web.Application(middlewares=[cors_middleware])

    # Chunk reassembler
    app["reassembler"] = chunked.ChunkReassembler(
        on_complete=on_transfer_complete,
        on_progress=lambda tid, idx, total: log.debug(
            f"[TRANSFER] {tid}: {idx}/{total}"
        ),
    )

    # Routes
    app.router.add_get("/ws", handle_ws)
    app.router.add_get("/health", health)
    app.router.add_get("/api/history", api_history)
    app.router.add_get("/api/notes", api_notes)
    app.router.add_get("/api/notes/{id}", api_note_detail)
    app.router.add_get("/api/download/{id}", api_download)
    app.router.add_post("/api/upload", api_upload)
    app.router.add_get("/api/clipboard", api_clipboard)
    app.router.add_post("/api/clipboard", api_clipboard)
    app.router.add_get("/api/pair/qr", api_pair_qr)
    app.router.add_get("/api/pair/info", api_pair_info)

    return app


async def start_background_tasks(app):
    """Start the clipboard monitor, file watcher, and expiry sweeper."""
    # Initialize database
    db.init_db()
    log.info(f"[DB] Initialized at {db.DB_PATH}")

    # Start clipboard monitor
    app["clipboard_monitor"] = clip.ClipboardMonitor(on_clipboard_change)
    app["clipboard_monitor"].start()

    # Start file watcher
    observer = Observer()
    observer.schedule(DropzoneHandler(), str(db.DROPZONE_DIR), recursive=False)
    observer.start()
    app["file_observer"] = observer
    log.info(f"[DROPZONE] Watching {db.DROPZONE_DIR}")

    # Start expiry sweeper
    app["sweeper_task"] = asyncio.ensure_future(expiry_sweeper())

    # Start system tray icon (blocks its thread, so run in daemon thread)
    import threading
    tray_thread = threading.Thread(target=tray.start_tray, daemon=True)
    tray_thread.start()
    app["tray_thread"] = tray_thread

    log.info(f"[BRIDGE] Sovereign Bridge online — port {PORT}")
    log.info(f"[BRIDGE] Tunnel: {TUNNEL_URL}")
    log.info(f"[BRIDGE] QR Pairing: http://localhost:{PORT}/api/pair/qr")
    log.info(f"[BRIDGE] Dropzone: {db.DROPZONE_DIR}")


async def cleanup_background_tasks(app):
    """Clean shutdown of background tasks."""
    if "clipboard_monitor" in app:
        app["clipboard_monitor"].stop()
    if "file_observer" in app:
        app["file_observer"].stop()
    if "sweeper_task" in app:
        app["sweeper_task"].cancel()

    # Stop system tray
    tray.stop_tray()

    # Close all WebSocket connections
    for ws in set(connected_clients):
        await ws.close(code=aiohttp.WSCloseCode.GOING_AWAY, message=b"Server shutdown")
    connected_clients.clear()

    log.info("[BRIDGE] Shutdown complete")


def main():
    app = setup_app()
    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)

    log.info("═" * 60)
    log.info("  SOVEREIGN BRIDGE")
    log.info("  Examina omnia, venerare nihil, pro te cogita")
    log.info("═" * 60)

    web.run_app(app, host=HOST, port=PORT, print=None)


if __name__ == "__main__":
    main()
