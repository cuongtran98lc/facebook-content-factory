from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
import threading
import time
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.getenv("CAPCUT_BRIDGE_CONFIG", ROOT / "capcut.local.json"))
CUSTOM_VOICES_PATH = Path(os.getenv("VIENEU_CUSTOM_VOICES", ROOT / "custom_voices.json"))
logger = logging.getLogger("capcut_bridge")

app = FastAPI(title="Content Factory Local TTS Bridge", version="0.3.0")

_vieneu_engine: Any | None = None
_vieneu_load_lock = threading.Lock()
_vieneu_infer_lock = asyncio.Lock()

TTS_SIGN_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmTd34Lw4b7IuldSXh/zY
CMla+ITdGG5TeWz6ad+OySd4r+IrY45AoqrYUxhQ2dl+7z+i7r/5vEa8rr39BYfB
8AGMQLmZA8HmgpWBsqrn/V6daUALkKnkLb70Fn32CJigIuGXAYqxUdGuI340aC+0
v5Es3puJsHyzf01/AelE4Cdc6bZhQrASJLBh8R3BQToYClmDVSDUQk28o8sl/guA
Z4n303Vj+6Siv1HayPCdV6kpVVnMBAG4+umUbwGmn132N3fgpzLarFF3XyWmS1zh
D/J07iM/rP8GDO9IskHNHd2phrO0G6KzrcFAnTBHjVv+hCBEfzN/no3FNA9AuC36
mwIDAQAB
-----END PUBLIC KEY-----"""


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str = Field(min_length=1)
    resource_id: str | None = None
    rate: float = 1.0


class VieNeuTTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str = Field(default="Ngọc Linh", min_length=1)
    style: str = Field(default="doc_truyen", pattern="^(tu_nhien|tin_tuc|doc_truyen)$")


def vieneu_voice_data() -> dict[str, Any]:
    path = ROOT / ".venv" / "lib" / f"python{os.sys.version_info.major}.{os.sys.version_info.minor}" / "site-packages" / "vieneu" / "assets" / "voices_v3_turbo.json"
    if not path.exists():
        try:
            import vieneu
            path = Path(vieneu.__file__).resolve().parent / "assets" / "voices_v3_turbo.json"
        except ImportError as exc:
            raise HTTPException(503, detail="VieNeu chưa được cài. Chạy npm start để cài dependency bridge.") from exc
    try:
        data = json.loads(path.read_text("utf-8"))
        if CUSTOM_VOICES_PATH.exists():
            custom = json.loads(CUSTOM_VOICES_PATH.read_text("utf-8"))
            for name, voice in custom.get("presets", {}).items():
                data.setdefault("presets", {})[name] = {**voice, "custom": True}
        return data
    except Exception as exc:
        raise HTTPException(500, detail=f"Không đọc được VieNeu voice presets: {exc}") from exc


def get_vieneu_engine() -> Any:
    global _vieneu_engine
    if _vieneu_engine is not None:
        return _vieneu_engine
    with _vieneu_load_lock:
        if _vieneu_engine is None:
            try:
                from vieneu import Vieneu
                _vieneu_engine = Vieneu(
                    mode="v3turbo",
                    backend="onnx",
                    device="cpu",
                    threads=max(1, int(os.getenv("VIENEU_THREADS", "4"))),
                )
                if CUSTOM_VOICES_PATH.exists():
                    import numpy as np
                    custom = json.loads(CUSTOM_VOICES_PATH.read_text("utf-8"))
                    for name, voice in custom.get("presets", {}).items():
                        embedding = voice.get("speaker_emb")
                        codes = voice.get("codes")
                        if embedding is None:
                            continue
                        _vieneu_engine._preset_voices[name] = {
                            "description": voice.get("description", "Custom local voice"),
                            "gender": voice.get("gender", ""),
                            "style": voice.get("style", "tu_nhien"),
                            "speaker_emb": np.asarray(embedding, dtype=np.float32),
                            "codes": None if codes is None else np.asarray(codes, dtype=np.int64),
                        }
            except Exception as exc:
                logger.exception("Cannot initialize VieNeu TTS")
                raise RuntimeError(f"Không khởi tạo được VieNeu TTS: {exc}") from exc
    return _vieneu_engine


def render_vieneu_wav(request: VieNeuTTSRequest) -> bytes:
    import soundfile as sf

    engine = get_vieneu_engine()
    wav = engine.infer(
        request.text,
        voice=request.voice,
        style=request.style,
        max_chars=min(256, max(80, int(os.getenv("VIENEU_MAX_CHARS", "220")))),
        apply_watermark=True,
    )
    output = BytesIO()
    sf.write(output, wav, engine.sample_rate, format="WAV", subtype="PCM_16")
    return output.getvalue()


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
        try:
            nested = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            nested = None
        if isinstance(nested, (dict, list)):
            return compact_json(deep_replace(nested, replacements))
        for key, replacement in replacements.items():
            value = value.replace("{{" + key + "}}", str(replacement if replacement is not None else ""))
    return value


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _der_length(data: bytes, position: int) -> tuple[int, int]:
    first = data[position]
    position += 1
    if first < 128:
        return first, position
    size = first & 127
    return int.from_bytes(data[position:position + size], "big"), position + size


def _der_value(data: bytes, position: int, tag: int) -> tuple[bytes, int]:
    if data[position] != tag:
        raise ValueError("Invalid CapCut RSA public key")
    length, start = _der_length(data, position + 1)
    return data[start:start + length], start + length


def rsa_encrypt(message: str) -> str:
    encoded_key = "".join(line for line in TTS_SIGN_PUBLIC_KEY.splitlines() if not line.startswith("-----"))
    outer, _ = _der_value(base64.b64decode(encoded_key), 0, 0x30)
    _, position = _der_value(outer, 0, 0x30)
    bit_string, _ = _der_value(outer, position, 0x03)
    sequence, _ = _der_value(bit_string[1:], 0, 0x30)
    modulus_raw, position = _der_value(sequence, 0, 0x02)
    exponent_raw, _ = _der_value(sequence, position, 0x02)
    modulus = int.from_bytes(modulus_raw, "big")
    exponent = int.from_bytes(exponent_raw, "big")
    key_size = (modulus.bit_length() + 7) // 8
    raw = message.encode("utf-8")
    padding = bytearray()
    while len(padding) < key_size - len(raw) - 3:
        padding.extend(byte for byte in secrets.token_bytes(key_size - len(raw) - 3 - len(padding)) if byte)
    block = b"\x00\x02" + bytes(padding) + b"\x00" + raw
    encrypted = pow(int.from_bytes(block, "big"), exponent, modulus).to_bytes(key_size, "big")
    return base64.b64encode(encrypted).decode("ascii")


def signed_headers(url: str, body: str, configured: dict[str, Any] | None = None) -> dict[str, str]:
    query = parse_qs(urlsplit(url).query)
    value = lambda key, default="": query.get(key, [default])[0]
    now = str(int(time.time()))
    app_version = value("version_name", "9.1.0")
    channel = value("channel", "capcutpc_0")
    device_id = value("device_id")
    aid = value("aid", "359289")
    path = urlsplit(url).path
    headers = dict(configured or {})
    headers.update({
        "Content-Type": "application/json",
        "appvr": app_version,
        "ch": channel,
        "device-time": now,
        "lan": "vi-VN",
        "loc": value("region", "VN"),
        "pf": "3",
        "sign-ver": "1",
        "tdid": device_id,
        "x-ss-stub": hashlib.md5(body.encode("utf-8")).hexdigest(),
        "x-ss-dp": aid,
        "x-khronos": now,
        "x-tt-trace-id": f"00-{uuid.uuid4().hex}-{uuid.uuid4().hex[:16]}-01",
        "app-sdk-version": app_version,
        "appid": aid,
        "sign": hashlib.md5(f"9e2c|{path[-7:]}|3|{app_version}|{now}|{device_id}|11ac".encode()).hexdigest(),
    })
    return headers


def prepare_create_call(create: dict[str, Any]) -> tuple[dict[str, str], str]:
    url = create.get("url", "")
    if "PASTE_FULL_CAPCUT_COMMON_TASK_NEW_URL_HERE" in url:
        raise HTTPException(400, detail="CapCut bridge chưa được cấu hình session. Vui lòng cấu hình file capcut.local.json hoặc chọn giọng đọc khác (như Edge TTS hoặc VieNeu).")
    body = create.get("json")
    if not isinstance(body, dict) or not isinstance(body.get("tasks"), list) or not body["tasks"]:
        raise HTTPException(503, detail="create_request.json.tasks is missing in capcut.local.json")
    body = json.loads(json.dumps(body))
    body["bind_id"] = str(uuid.uuid4())
    task = body["tasks"][0]
    task["context"] = str(uuid.uuid4())
    raw_payload = task.get("payload")
    if isinstance(raw_payload, dict):
        payload = raw_payload
    elif isinstance(raw_payload, str):
        if "PASTE_CAPTURED_PAYLOAD_HERE" in raw_payload:
            raise HTTPException(400, detail="CapCut bridge chưa được cấu hình session. Vui lòng cấu hình file capcut.local.json hoặc chọn giọng đọc khác (như Edge TTS hoặc VieNeu).")
        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError as exc:
            raise HTTPException(503, detail=f"create_request task payload contains invalid JSON: {exc}") from exc
    else:
        raise HTTPException(503, detail="create_request task payload must be a JSON string or object")
    query = parse_qs(urlsplit(create["url"]).query)
    device_id = query.get("device_id", [""])[0]
    aid = query.get("aid", ["359289"])[0]
    extra_info = payload.get("extra_info", compact_json({"benefit_info": {}}))
    ssml = payload.get("ssml", "")
    signature_input = f"appid:{aid}&did:{device_id}&creditDisable:false&ssml:{hashlib.md5(ssml.encode()).hexdigest()}&extraInfo:{extra_info}"
    payload["sign"] = rsa_encrypt(signature_input)
    task["payload"] = compact_json(payload)
    body_text = compact_json(body)
    return signed_headers(create["url"], body_text, create.get("headers")), body_text


def prepare_query_call(query_call: dict[str, Any]) -> tuple[dict[str, str], str]:
    body_text = compact_json(query_call.get("json", {}))
    return signed_headers(query_call["url"], body_text, query_call.get("headers")), body_text


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
    return {
        "ok": True,
        "configured": CONFIG_PATH.exists(),
        "config": str(CONFIG_PATH),
        "version": "0.3.0",
        "vieneu_loaded": _vieneu_engine is not None,
    }


@app.get("/api/vieneu/voices")
def vieneu_voices() -> list[dict[str, Any]]:
    data = vieneu_voice_data()
    result = []
    for name, voice in data.get("presets", {}).items():
        result.append({
            "id": name,
            "display_name": name,
            "gender": voice.get("gender", ""),
            "region": voice.get("region", ""),
            "style": voice.get("style", "tu_nhien"),
            "description": voice.get("description", "VieNeu local voice"),
            "custom": bool(voice.get("custom", False)),
        })
    return result


@app.post("/api/vieneu/tts")
async def vieneu_tts(request: VieNeuTTSRequest) -> Response:
    presets = vieneu_voice_data().get("presets", {})
    if request.voice not in presets:
        raise HTTPException(400, detail=f"Không có VieNeu voice '{request.voice}'.")
    try:
        async with _vieneu_infer_lock:
            wav = await asyncio.to_thread(render_vieneu_wav, request)
        return Response(content=wav, media_type="audio/wav", headers={"X-TTS-Voice": request.voice})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, detail=str(exc)) from exc


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
        "text": request.text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"),
        "voice": request.voice,
        "voice_type": request.voice,
        "resource_id": request.resource_id or "",
        "rate": request.rate,
    }
    create = deep_replace(create_template, replacements)
    timeout = httpx.Timeout(60.0, connect=15.0)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        import base64

        async def download_audio_b64(url: str) -> str:
            for download_attempt in range(1, 4):
                try:
                    audio_res = await client.get(url, timeout=30.0)
                    if audio_res.is_error:
                        raise httpx.HTTPStatusError(f"HTTP {audio_res.status_code}", request=audio_res.request, response=audio_res)
                    return base64.b64encode(audio_res.content).decode("utf-8")
                except (httpx.HTTPError, httpx.HTTPStatusError) as exc:
                    if download_attempt < 3:
                        logger.warning("Failed to download audio from CDN: %s; retrying...", exc)
                        await asyncio.sleep(1.0)
                    else:
                        logger.error("Failed to download audio from CDN after all attempts: %s", exc)
                        raise HTTPException(502, detail=f"Failed to download audio from CapCut CDN: {exc}")

        create_attempts = max(1, int(config.get("create_attempts", 3)))
        create_payload: dict[str, Any] = {}
        for attempt in range(1, create_attempts + 1):
            try:
                create_headers, create_body = prepare_create_call(create)
                response = await client.request(
                    create.get("method", "POST"), create["url"], params=create.get("params"),
                    headers=create_headers, content=create_body.encode("utf-8"),
                )
            except httpx.HTTPError as exc:
                if attempt < create_attempts:
                    delay = float(config.get("create_retry_delay_seconds", 1.5)) * attempt
                    logger.warning("CapCut request connection/network error: %s; retrying in %.1fs (%s/%s)", exc, delay, attempt, create_attempts)
                    await asyncio.sleep(delay)
                    continue
                else:
                    logger.error("CapCut request connection/network error after %s attempts: %s", create_attempts, exc)
                    raise HTTPException(502, detail=f"CapCut request connection/network error: {exc}")

            if response.is_error:
                logger.error("CapCut create failed (%s): %s", response.status_code, response.text[:1000])
                raise HTTPException(response.status_code, detail=f"CapCut create failed: {response.text[:1000]}")
            try:
                create_payload = response.json()
            except Exception:
                raise HTTPException(502, detail=f"CapCut create returned non-JSON: {response.text[:500]}")

            ret = str(create_payload.get("ret", "0"))
            if ret in {"0", ""}:
                break
            if ret == "1014" and attempt < create_attempts:
                delay = float(config.get("create_retry_delay_seconds", 1.5)) * attempt
                logger.warning("CapCut is busy (ret=1014); retrying in %.1fs (%s/%s)", delay, attempt, create_attempts)
                await asyncio.sleep(delay)
                continue
            if ret == "-6" or "shark block" in str(create_payload.get("errmsg", "")).lower():
                raise HTTPException(
                    403,
                    detail=(
                        "CapCut security blocked this session/device (ret=-6: shark block only). "
                        "Close CapCut, wait for the temporary risk-control cooldown, sign in again, "
                        "then capture a fresh create/query request into capcut.local.json. "
                        "The bridge cannot bypass CapCut's Shark security layer."
                    ),
                )
            raise HTTPException(
                502,
                detail=f"CapCut rejected task creation (ret={ret}): {create_payload.get('errmsg', 'unknown error')}",
            )

        speech_url = extract_speech_url(create_payload)
        if speech_url:
            audio_b64 = await download_audio_b64(speech_url)
            return {"status": "success", "speech_url": speech_url, "voice": request.voice, "audio_data": audio_b64}

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
            query_headers, query_body = prepare_query_call(query_call)
            try:
                poll = await client.request(
                    query_call.get("method", "POST"), query_call["url"], params=query_call.get("params"),
                    headers=query_headers, content=query_body.encode("utf-8"),
                )
            except httpx.HTTPError as exc:
                logger.warning("CapCut query connection/network error: %s; retrying...", exc)
                await asyncio.sleep(float(config.get("poll_interval_seconds", 1.0)))
                continue

            if poll.is_error:
                logger.error("CapCut query failed (%s): %s", poll.status_code, poll.text[:1000])
                raise HTTPException(poll.status_code, detail=f"CapCut query failed: {poll.text[:1000]}")
            try:
                payload = poll.json()
            except Exception:
                raise HTTPException(502, detail=f"CapCut query returned non-JSON: {poll.text[:500]}")

            polled_task = extract_task(payload)
            status = str((polled_task or {}).get("status", "")).lower()
            speech_url = extract_speech_url(payload)
            if speech_url:
                audio_b64 = await download_audio_b64(speech_url)
                return {"status": "success", "speech_url": speech_url, "voice": request.voice, "task_id": task["id"], "audio_data": audio_b64}
            if status in {"failed", "fail", "error"}:
                raise HTTPException(502, detail=f"CapCut TTS task failed: {polled_task}")
            await asyncio.sleep(float(config.get("poll_interval_seconds", 1.0)))

    raise HTTPException(504, detail="CapCut TTS task timed out")
