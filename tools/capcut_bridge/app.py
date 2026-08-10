from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.getenv("CAPCUT_BRIDGE_CONFIG", ROOT / "capcut.local.json"))

app = FastAPI(title="Content Factory CapCut TTS Bridge", version="0.1.0")


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str = Field(min_length=1)
    resource_id: str | None = None
    rate: float = 1.0


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise HTTPException(
            503,
            detail=(
                f"Missing {CONFIG_PATH.name}. Copy capcut.local.example.json to "
                "capcut.local.json and paste request values from your own CapCut session."
            ),
        )
    try:
        return json.loads(CONFIG_PATH.read_text("utf-8"))
    except Exception as exc:
        raise HTTPException(500, detail=f"Invalid CapCut bridge config: {exc}") from exc


def deep_replace(value: Any, replacements: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {k: deep_replace(v, replacements) for k, v in value.items()}
    if isinstance(value, list):
        return [deep_replace(v, replacements) for v in value]
    if isinstance(value, str):
        for key, replacement in replacements.items():
            value = value.replace("{{" + key + "}}", str(replacement if replacement is not None else ""))
    return value


def normalize_voices(config: dict[str, Any]) -> list[dict[str, Any]]:
    voices = config.get("voices", [])
    return [
        {
            "voice_type": item.get("voice_type"),
            "resource_id": item.get("resource_id"),
            "lang": item.get("lang", "vi"),
            "display_name": item.get("display_name") or item.get("voice_type"),
            "gender": item.get("gender", ""),
            "description": item.get("description", "CapCut local voice"),
        }
        for item in voices
        if item.get("voice_type")
    ]


def find_first(obj: Any, keys: set[str]) -> Any:
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in keys and value:
                return value
            found = find_first(value, keys)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = find_first(value, keys)
            if found:
                return found
    return None


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "configured": CONFIG_PATH.exists(), "config": str(CONFIG_PATH)}


@app.get("/api/voices")
def voices() -> list[dict[str, Any]]:
    return normalize_voices(load_config())


@app.post("/api/tts")
async def tts(request: TTSRequest) -> dict[str, Any]:
    config = load_config()
    create = config.get("create_request")
    query = config.get("query_request")
    if not isinstance(create, dict) or not create.get("url"):
        raise HTTPException(503, detail="create_request.url is missing in capcut.local.json")

    replacements = {
        "text": request.text,
        "voice": request.voice,
        "voice_type": request.voice,
        "resource_id": request.resource_id or "",
        "rate": request.rate,
    }
    create = deep_replace(create, replacements)
    timeout = httpx.Timeout(60.0, connect=15.0)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.request(
            create.get("method", "POST"),
            create["url"],
            params=create.get("params"),
            headers=create.get("headers"),
            json=create.get("json"),
            data=create.get("data"),
        )
        if response.is_error:
            raise HTTPException(response.status_code, detail=f"CapCut create failed: {response.text[:1000]}")
        try:
            create_payload = response.json()
        except Exception:
            raise HTTPException(502, detail=f"CapCut create returned non-JSON: {response.text[:500]}")

        speech_url = find_first(create_payload, {"speech_url", "audio_url", "download_url", "url"})
        if speech_url and isinstance(speech_url, str) and speech_url.startswith("http"):
            return {"status": "success", "speech_url": speech_url, "voice": request.voice}

        task_id = find_first(create_payload, {"task_id", "taskid", "id"})
        if not task_id:
            raise HTTPException(502, detail=f"Cannot find task_id/audio URL in CapCut response: {create_payload}")
        if not isinstance(query, dict) or not query.get("url"):
            raise HTTPException(503, detail="query_request.url is required because create response returned a task id")

        query_replacements = {**replacements, "task_id": task_id}
        for _ in range(int(config.get("poll_attempts", 30))):
            query_call = deep_replace(query, query_replacements)
            poll = await client.request(
                query_call.get("method", "GET"),
                query_call["url"],
                params=query_call.get("params"),
                headers=query_call.get("headers"),
                json=query_call.get("json"),
                data=query_call.get("data"),
            )
            if poll.is_error:
                raise HTTPException(poll.status_code, detail=f"CapCut query failed: {poll.text[:1000]}")
            payload = poll.json()
            speech_url = find_first(payload, {"speech_url", "audio_url", "download_url", "url"})
            if speech_url and isinstance(speech_url, str) and speech_url.startswith("http"):
                return {"status": "success", "speech_url": speech_url, "voice": request.voice}
            import asyncio
            await asyncio.sleep(float(config.get("poll_interval_seconds", 1.0)))

    raise HTTPException(504, detail="CapCut TTS task timed out")
