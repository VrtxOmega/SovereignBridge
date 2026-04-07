"""
Sovereign Bridge — Chunked Transfer Protocol
==============================================
Splits files into 64KB chunks with base64 encoding for WebSocket transport.
SHA-256 verification on reassembly. Progress callbacks per chunk.
"""
import base64
import hashlib
import io
import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger("Bridge.Chunked")

CHUNK_SIZE = 65536  # 64KB raw, ~87KB base64


def file_hash(path: str) -> str:
    """Compute SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def bytes_hash(data: bytes) -> str:
    """Compute SHA-256 hash of bytes."""
    return hashlib.sha256(data).hexdigest()


def chunk_file(path: str, transfer_id: str = None):
    """
    Generator that yields chunk dicts for WebSocket transmission.
    
    Yields:
        {
            type: 'FILE_CHUNK',
            transfer_id: str,
            filename: str,
            file_hash: str,
            file_size: int,
            chunk_index: int,
            chunks_total: int,
            data_b64: str
        }
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")

    fsize = p.stat().st_size
    fhash = file_hash(path)
    tid = transfer_id or hashlib.sha256(f"{path}:{time.time()}".encode()).hexdigest()[:12]

    chunks_total = (fsize + CHUNK_SIZE - 1) // CHUNK_SIZE
    if chunks_total == 0:
        chunks_total = 1

    with open(path, "rb") as f:
        for i in range(chunks_total):
            raw = f.read(CHUNK_SIZE)
            yield {
                "type": "FILE_CHUNK",
                "transfer_id": tid,
                "filename": p.name,
                "file_hash": fhash,
                "file_size": fsize,
                "chunk_index": i,
                "chunks_total": chunks_total,
                "data_b64": base64.b64encode(raw).decode("ascii"),
            }


def chunk_bytes(data: bytes, filename: str, transfer_id: str = None):
    """
    Generator that yields chunk dicts from raw bytes (for clipboard images).
    """
    fsize = len(data)
    fhash = bytes_hash(data)
    tid = transfer_id or hashlib.sha256(f"{filename}:{time.time()}".encode()).hexdigest()[:12]

    chunks_total = (fsize + CHUNK_SIZE - 1) // CHUNK_SIZE
    if chunks_total == 0:
        chunks_total = 1

    offset = 0
    for i in range(chunks_total):
        raw = data[offset : offset + CHUNK_SIZE]
        offset += CHUNK_SIZE
        yield {
            "type": "FILE_CHUNK",
            "transfer_id": tid,
            "filename": filename,
            "file_hash": fhash,
            "file_size": fsize,
            "chunk_index": i,
            "chunks_total": chunks_total,
            "data_b64": base64.b64encode(raw).decode("ascii"),
        }


class ChunkReassembler:
    """
    Collects incoming chunks and reassembles them into a complete file.
    Verifies SHA-256 hash on completion.
    """

    def __init__(self, on_complete, on_progress=None):
        """
        on_complete(transfer_id, filename, data_bytes, file_hash)
        on_progress(transfer_id, chunk_index, chunks_total)
        """
        self.on_complete = on_complete
        self.on_progress = on_progress
        self._transfers = {}  # transfer_id → {chunks: {}, meta: {}}

    def feed(self, chunk_msg: dict) -> bool:
        """
        Feed a FILE_CHUNK message. Returns True when transfer is complete.
        """
        tid = chunk_msg["transfer_id"]
        idx = chunk_msg["chunk_index"]
        total = chunk_msg["chunks_total"]
        filename = chunk_msg["filename"]
        expected_hash = chunk_msg["file_hash"]
        data_b64 = chunk_msg["data_b64"]

        if tid not in self._transfers:
            self._transfers[tid] = {
                "chunks": {},
                "filename": filename,
                "expected_hash": expected_hash,
                "chunks_total": total,
                "started_at": time.time(),
            }

        self._transfers[tid]["chunks"][idx] = base64.b64decode(data_b64)

        if self.on_progress:
            self.on_progress(tid, idx + 1, total)

        # Check if all chunks received
        if len(self._transfers[tid]["chunks"]) >= total:
            return self._finalize(tid)

        return False

    def _finalize(self, transfer_id: str) -> bool:
        """Reassemble and verify."""
        transfer = self._transfers.pop(transfer_id)
        chunks = transfer["chunks"]

        # Reassemble in order
        data = b""
        for i in range(transfer["chunks_total"]):
            if i not in chunks:
                log.error(f"Missing chunk {i} in transfer {transfer_id}")
                return False
            data += chunks[i]

        # Verify hash
        actual_hash = bytes_hash(data)
        expected_hash = transfer["expected_hash"]

        if actual_hash != expected_hash:
            log.error(
                f"Hash mismatch for {transfer_id}: "
                f"expected {expected_hash[:16]}... got {actual_hash[:16]}..."
            )
            return False

        elapsed = time.time() - transfer["started_at"]
        log.info(
            f"Transfer {transfer_id} complete: {transfer['filename']} "
            f"({len(data)} bytes, {elapsed:.1f}s)"
        )

        self.on_complete(transfer_id, transfer["filename"], data, actual_hash)
        return True

    def cleanup_stale(self, max_age_s: int = 300):
        """Remove transfers that have been in progress for too long."""
        now = time.time()
        stale = [
            tid
            for tid, t in self._transfers.items()
            if now - t["started_at"] > max_age_s
        ]
        for tid in stale:
            log.warning(f"Cleaning up stale transfer {tid}")
            del self._transfers[tid]
