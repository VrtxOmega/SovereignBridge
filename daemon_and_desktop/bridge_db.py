"""
Sovereign Bridge — SQLite Storage Engine
=========================================
Captures, notes, and note version history.
SHA-256 deduplication on content_hash.
Ephemeral lane auto-expires after 24 hours.
"""
import sqlite3
import hashlib
import json
import time
import os
from pathlib import Path

DB_DIR = Path(os.path.expanduser("~/.veritas/bridge"))
DB_PATH = DB_DIR / "bridge.db"
CAPTURES_DIR = DB_DIR / "captures"
DROPZONE_DIR = DB_DIR / "dropzone"


def _ensure_dirs():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    CAPTURES_DIR.mkdir(parents=True, exist_ok=True)
    DROPZONE_DIR.mkdir(parents=True, exist_ok=True)


def get_conn():
    _ensure_dirs()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    _ensure_dirs()
    conn = get_conn()

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS captures (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            content TEXT,
            content_hash TEXT,
            filename TEXT,
            file_path TEXT,
            file_size INTEGER,
            tags TEXT DEFAULT '[]',
            lane TEXT DEFAULT 'ephemeral',
            source TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            expires_at INTEGER,
            ocr_text TEXT,
            metadata TEXT DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_captures_hash ON captures(content_hash);
        CREATE INDEX IF NOT EXISTS idx_captures_type ON captures(type);
        CREATE INDEX IF NOT EXISTS idx_captures_lane ON captures(lane);
        CREATE INDEX IF NOT EXISTS idx_captures_ts ON captures(timestamp DESC);

        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT DEFAULT 'Untitled',
            content TEXT DEFAULT '',
            version INTEGER DEFAULT 1,
            updated_at INTEGER NOT NULL,
            updated_by TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS note_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id TEXT NOT NULL,
            content TEXT,
            version INTEGER,
            saved_at INTEGER,
            saved_by TEXT,
            FOREIGN KEY (note_id) REFERENCES notes(id)
        );
    """)
    conn.commit()
    conn.close()


# ══════════════════════════════════════════════════════════════
# CAPTURES
# ══════════════════════════════════════════════════════════════

EPHEMERAL_TTL = 86400  # 24 hours in seconds


def content_hash(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def capture_id(source: str, timestamp: int, content_hash_val: str) -> str:
    raw = f"{source}:{timestamp}:{content_hash_val}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def insert_capture(
    capture_type: str,
    content: str,
    source: str,
    filename: str = None,
    file_path: str = None,
    file_size: int = None,
    tags: list = None,
    lane: str = "ephemeral",
    ocr_text: str = None,
    metadata: dict = None,
) -> dict | None:
    """Insert a capture. Returns None if duplicate (same content_hash)."""
    conn = get_conn()
    now = int(time.time() * 1000)
    chash = content_hash(content if content else (filename or ""))

    # Deduplication check
    existing = conn.execute(
        "SELECT id FROM captures WHERE content_hash = ?", (chash,)
    ).fetchone()
    if existing:
        conn.close()
        return None  # Duplicate — skip

    cid = capture_id(source, now, chash)
    expires = now + (EPHEMERAL_TTL * 1000) if lane == "ephemeral" else None

    conn.execute(
        """INSERT INTO captures 
           (id, type, content, content_hash, filename, file_path, file_size,
            tags, lane, source, timestamp, expires_at, ocr_text, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            cid,
            capture_type,
            content,
            chash,
            filename,
            file_path,
            file_size,
            json.dumps(tags or []),
            lane,
            source,
            now,
            expires,
            ocr_text,
            json.dumps(metadata or {}),
        ),
    )
    conn.commit()

    row = conn.execute("SELECT * FROM captures WHERE id = ?", (cid,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_captures(
    limit: int = 50,
    capture_type: str = None,
    tag: str = None,
    lane: str = None,
    search: str = None,
    offset: int = 0,
) -> list[dict]:
    conn = get_conn()
    query = "SELECT * FROM captures WHERE 1=1"
    params = []

    if capture_type:
        query += " AND type = ?"
        params.append(capture_type)
    if lane:
        query += " AND lane = ?"
        params.append(lane)
    if tag:
        query += " AND tags LIKE ?"
        params.append(f"%{tag}%")
    if search:
        query += " AND (content LIKE ? OR ocr_text LIKE ? OR filename LIKE ?)"
        params.extend([f"%{search}%"] * 3)

    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_capture(capture_id: str) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM captures WHERE id = ?", (capture_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_capture_tags(capture_id: str, tags: list):
    conn = get_conn()
    conn.execute(
        "UPDATE captures SET tags = ? WHERE id = ?",
        (json.dumps(tags), capture_id),
    )
    conn.commit()
    conn.close()


def update_capture_lane(capture_id: str, lane: str):
    conn = get_conn()
    now = int(time.time() * 1000)
    expires = now + (EPHEMERAL_TTL * 1000) if lane == "ephemeral" else None
    conn.execute(
        "UPDATE captures SET lane = ?, expires_at = ? WHERE id = ?",
        (lane, expires, capture_id),
    )
    conn.commit()
    conn.close()


def delete_capture(capture_id: str):
    conn = get_conn()
    row = conn.execute(
        "SELECT file_path FROM captures WHERE id = ?", (capture_id,)
    ).fetchone()
    if row and row["file_path"]:
        try:
            os.remove(row["file_path"])
        except OSError:
            pass
    conn.execute("DELETE FROM captures WHERE id = ?", (capture_id,))
    conn.commit()
    conn.close()


def sweep_expired():
    """Delete ephemeral captures past their expiry. Returns count deleted."""
    conn = get_conn()
    now = int(time.time() * 1000)
    rows = conn.execute(
        "SELECT id, file_path FROM captures WHERE expires_at IS NOT NULL AND expires_at < ?",
        (now,),
    ).fetchall()

    for row in rows:
        if row["file_path"]:
            try:
                os.remove(row["file_path"])
            except OSError:
                pass

    result = conn.execute(
        "DELETE FROM captures WHERE expires_at IS NOT NULL AND expires_at < ?",
        (now,),
    )
    count = result.rowcount
    conn.commit()
    conn.close()
    return count


# ══════════════════════════════════════════════════════════════
# NOTES
# ══════════════════════════════════════════════════════════════

def create_note(title: str = "Untitled", content: str = "", source: str = "pc") -> dict:
    conn = get_conn()
    now = int(time.time() * 1000)
    nid = hashlib.sha256(f"{title}:{now}".encode()).hexdigest()[:12]

    conn.execute(
        "INSERT INTO notes (id, title, content, version, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?)",
        (nid, title, content, now, source),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (nid,)).fetchone()
    conn.close()
    return dict(row)


def update_note(note_id: str, content: str, source: str) -> dict | None:
    conn = get_conn()
    now = int(time.time() * 1000)

    current = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not current:
        conn.close()
        return None

    new_version = current["version"] + 1

    # Save current version to history (for conflict resolution)
    conn.execute(
        "INSERT INTO note_versions (note_id, content, version, saved_at, saved_by) VALUES (?, ?, ?, ?, ?)",
        (note_id, current["content"], current["version"], current["updated_at"], current["updated_by"]),
    )

    # Update the note
    conn.execute(
        "UPDATE notes SET content = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?",
        (content, new_version, now, source, note_id),
    )
    conn.commit()

    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    return dict(row)


def get_notes() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM notes ORDER BY updated_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_note(note_id: str) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_note_history(note_id: str) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM note_versions WHERE note_id = ? ORDER BY version DESC",
        (note_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_note(note_id: str):
    conn = get_conn()
    conn.execute("DELETE FROM note_versions WHERE note_id = ?", (note_id,))
    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    conn.commit()
    conn.close()
