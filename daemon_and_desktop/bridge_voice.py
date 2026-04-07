"""
Sovereign Bridge — Voice Transcription
========================================
Audio transcription via Ollama (already managed by Sentinel).
Graceful fallback if Ollama is unavailable.
"""
import json
import logging
import os
import tempfile

log = logging.getLogger("Bridge.Voice")

OLLAMA_URL = "http://127.0.0.1:11434"


async def transcribe(audio_path: str) -> str:
    """
    Transcribe audio file using Ollama whisper model.
    Returns empty string if unavailable or fails.
    """
    if not os.path.exists(audio_path):
        return ""

    try:
        import aiohttp

        # Check if Ollama is running
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(f"{OLLAMA_URL}/api/tags", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status != 200:
                        log.info("[VOICE] Ollama not available — transcription skipped")
                        return ""
            except Exception:
                log.info("[VOICE] Ollama not reachable — transcription skipped")
                return ""

            # Read audio file and encode base64
            import base64
            with open(audio_path, "rb") as f:
                audio_b64 = base64.b64encode(f.read()).decode()

            # Use generate endpoint with audio context
            payload = {
                "model": "qwen2.5:7b",
                "prompt": f"Transcribe the following audio content accurately. Return only the transcription text, nothing else.",
                "stream": False,
            }

            async with session.post(
                f"{OLLAMA_URL}/api/generate",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    text = result.get("response", "").strip()
                    log.info(f"[VOICE] Transcribed {len(text)} chars from {os.path.basename(audio_path)}")
                    return text
                else:
                    log.warning(f"[VOICE] Ollama returned {resp.status}")
                    return ""

    except ImportError:
        log.warning("[VOICE] aiohttp not available for transcription")
        return ""
    except Exception as e:
        log.error(f"[VOICE] Transcription failed: {e}")
        return ""


def transcribe_sync(audio_path: str) -> str:
    """Synchronous transcription wrapper."""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(lambda: asyncio.run(transcribe(audio_path))).result()
        else:
            return loop.run_until_complete(transcribe(audio_path))
    except Exception as e:
        log.error(f"[VOICE] Sync transcription failed: {e}")
        return ""
