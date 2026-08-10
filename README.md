# Content Factory Desktop — MVP v0.3.3

Desktop app local cho flow **Topic → Idea → Script → Voice → MP3 → Loop Video → Render**.

## Chạy app

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run dev
```

Yêu cầu Node.js 20+ và FFmpeg/ffprobe trong PATH.

## AI

Settings hỗ trợ Gemini/OpenAI. API key được giữ ở Electron main process và mã hóa bằng `safeStorage`.

## Flow hiện tại

```text
Create Project
  ↓
Generate Ideas
  ↓
Select Idea
  ↓
Generate LONG_STORY
  ↓
AI Review / Rewrite / Versioning
  ↓
Test + Select Voice
  ↓
Approve + Generate Reels
  ↓
Generate Story MP3
  ↓
Select background video
  ↓
FFmpeg loop video tới hết MP3
  ↓
story-*.mp4
```

## Local data

macOS thường nằm tại:

```text
~/Library/Application Support/content-factory-desktop/
```

Project media nằm trong `data/projects/<project-id>/`.

## TTS providers

### ElevenLabs

Mặc định:

```env
TTS_PROVIDER="elevenlabs"
```

Cấu hình API key/model trong Settings → Voice/TTS.

### CapCut (Experimental)

CapCut không có public TTS API ổn định dành cho integration kiểu này. Bản thử không nhúng cookie/token CapCut vào Electron; thay vào đó app gọi một bridge local do bạn tự chạy bằng session CapCut của chính mình.

```env
TTS_PROVIDER="capcut"
CAPCUT_TTS_BRIDGE_URL="http://127.0.0.1:8000"
CAPCUT_TTS_RATE="1"
```

Bridge cần expose đúng contract:

```http
GET /api/voices
```

Response:

```json
[
  {
    "voice_type": "<capcut voice type>",
    "resource_id": "<optional resource id>",
    "lang": "vi",
    "display_name": "Vietnamese Voice",
    "gender": "female"
  }
]
```

Và:

```http
POST /api/tts
Content-Type: application/json
```

Request:

```json
{
  "text": "Xin chào",
  "voice": "<voice_type>",
  "resource_id": "<resource_id>",
  "rate": 1
}
```

Response:

```json
{
  "status": "success",
  "speech_url": "https://.../audio.mp3"
}
```

Khi bật CapCut provider, UI hiện tại vẫn dùng cùng flow `Load voices → Test voice → Use this voice → Generate Story MP3`. `voice_type` và `resource_id` được encode vào `Project.voiceId`, vì vậy full-story TTS vẫn giữ đúng voice đã chọn qua từng chunk.

> Experimental: endpoint/session CapCut có thể thay đổi. Chỉ dùng session/account của chính bạn và không commit cookie, token hoặc request headers nhạy cảm vào repo.

## Story MP3 + loop video

- Story dài được chia chunk tự động.
- Từng chunk gọi TTS provider đã chọn rồi nối thành `audio/story.mp3`.
- Chọn một background video từ máy.
- FFmpeg loop background vô hạn và dừng đúng khi story MP3 kết thúc.
- Output presets: 16:9, 9:16, 1:1; fit mode crop hoặc pad.
- Output nằm tại `videos/story-*.mp4`.
