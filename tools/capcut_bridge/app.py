from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.getenv("CAPCUT_BRIDGE_CONFIG", ROOT / "capcut.local.json"))

app = FastAPI(title="Content Factory CapCut TTS Bridge", version="0.2.0")


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str = Field(min_length=1)
    resource_id: str | None = None
    rate: float = 1.0


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise HTTPException(503, detail=f"Missing {CONFIG_PATH.name}. Copy capcut.local.example.json to capcut.local.json and configure your CapCut session request.")
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
    return [{
        "voice_type": item.get("voice_type"),
        "resource_id": item.get("resource_id"),
        "lang": item.get("lang", "vi"),
        "display_name": item.get("display_name") or item.get("voice_type"),
        "gender": item.get("gender", ""),
        "description": item.get("description", "CapCut local voice"),
    } for item in config.get("voices", []) if item.get("voice_type")]


def extract_task(payload: dict[str, Any]) -> dict[str, Any] | None:
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    tasks = data.get("tasks")
    if not isinstance(tasks, list) or not tasks or not isinstance(tasks[0], dict):
        return None
    return tasks[0]


def extract_speech_url(payload: Any) -> str | None:
    if isinstance(payload, str):
        try:
            return extract_speech_url(json.loads(payload))
        except (json.JSONDecodeError, TypeError):
            return payload if payload.startswith("http") else None
    if isinstance(payload, dict):
        speech_url = payload.get("speech_url")
        if isinstance(speech_url, str) and speech_url.startswith("http"):
            return speech_url
        for value in payload.values():
            found = extract_speech_url(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = extract_speech_url(value)
            if found:
                return found
    return None


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "configured": CONFIG_PATH.exists(), "config": str(CONFIG_PATH), "version": "0.2.0"}


@app.get("/api/voices")
def voices() -> list[dict[str, Any]]:
    return normalize_voices(load_config())


@app.post("/api/tts")
async def tts(request: TTSRequest) -> dict[str, Any]:
    config = load_config()
    create_template = config.get("create_request")
    query_template = config.get("query_request")
    if not isinstance(create_template, dict) or not create_template.get("url"):
        raise HTTPException(503, detail="create_request.url is missing in capcut.local.json")

    replacements = {
        "text": request.text,
        "voice": request.voice,
        "voice_type": request.voice,
        "resource_id": request.resource_id or "",
        "rate": request.rate,
    }
    create = deep_replace(create_template, replacements)
    timeout = httpx.Timeout(60.0, connect=15.0)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        response = await client.request(create.get("method", "POST"), create["url"], params=create.get("params"), headers=create.get("headers"), json=create.get("json"), data=create.get("data"))
        if response.is_error:
            raise HTTPException(response.status_code, detail=f"CapCut create failed: {response.text[:1000]}")
        try:
            create_payload = response.json()
        except Exception:
            raise HTTPException(502, detail=f"CapCut create returned non-JSON: {response.text[:500]}")

        speech_url = extract_speech_url(create_payload)
        if speech_url:
            return {"status": "success", "speech_url": speech_url, "voice": request.voice}

        task = extract_task(create_payload)
        if not task or not task.get("id"):
            raise HTTPException(502, detail=f"Cannot find data.tasks[0].id in CapCut response: {create_payload}")
        if not isinstance(query_template, dict) or not query_template.get("url"):
            raise HTTPException(503, detail="query_request.url is required because create returned a task")

        query_replacements = {
            **replacements,
            "task_id": task["id"],
            "task_token": task.get("token", ""),
            "task_context": task.get("context", ""),
        }

        for _ in range(int(config.get("poll_attempts", 30))):
            query_call = deep_replace(query_template, query_replacements)
            poll = await client.request(query_call.get("method", "POST"), query_call["url"], params=query_call.get("params"), headers=query_call.get("headers"), json=query_call.get("json"), data=query_call.get("data"))
            if poll.is_error:
                raise HTTPException(poll.status_code, detail=f"CapCut query failed: {poll.text[:1000]}")
            try:
                payload = poll.json()
            except Exception:
                raise HTTPException(502, detail=f"CapCut query returned non-JSON: {poll.text[:500]}")

            polled_task = extract_task(payload)
            status = str((polled_task or {}).get("status", "")).lower()
            speech_url = extract_speech_url(payload)
            if speech_url:
                return {"status": "success", "speech_url": speech_url, "voice": request.voice, "task_id": task["id"]}
            if status in {"failed", "fail", "error"}:
                raise HTTPException(502, detail=f"CapCut TTS task failed: {polled_task}")
            await asyncio.sleep(float(config.get("poll_interval_seconds", 1.0)))

    raise HTTPException(504, detail="CapCut TTS task timed out")
