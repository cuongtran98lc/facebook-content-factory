# Content Factory Desktop — MVP v0.3.3

Desktop app local cho flow **Topic/Crawl → Script → Voice → MP3 → Background → Dynamic SFX → Render**.

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
Select background video / image
  ↓
Chọn Dynamic / Whoosh / Impact / Chime và mức SFX
  ↓
FFmpeg loop background, duck voice và trộn 1 SFX cho mỗi video
  ↓
story-*.mp4
```

SFX chỉ được trộn vào MP4 cuối, không ghi đè file MP3 voice. Preset `Dynamic` luân phiên Whoosh / Impact / Chime và thay đổi thời điểm theo từng tập.

Khi Output là `9:16`, Story MP3 được chia liên tục thành các file `story-reel-short-XX-of-YY.mp4`. Các phần được cân bằng để không có đoạn cuối quá ngắn và không phần nào dài quá 3 phút. Output `16:9` và `1:1` vẫn tạo một video.

## Local data

macOS thường nằm tại:

```text
~/Library/Application Support/content-factory-desktop/
```

Project media nằm trong `data/projects/<project-id>/`.

MP3, thumbnail và video thành phẩm được xuất vào một thư mục cố định theo từng truyện ngay trong source:

```text
output/<tên-truyện>--<id>/
```

Tên truyện giúp nhận biết nhanh, còn ID giữ cho đường dẫn không trùng giữa các project. Nút **Mở output truyện** luôn xuất hiện trên thanh trên cùng sau khi chọn project, kể cả trước lần render đầu tiên.

Có thể đổi thư mục output gốc trong `.env` bằng đường dẫn tuyệt đối:

```env
CONTENT_FACTORY_OUTPUT_DIR="/duong/dan/output"
```

Nếu để trống khi chạy từ source, app dùng thư mục `output/` tại root của repository. Storage trong Electron user data vẫn được dùng cho database, audio trung gian, ảnh và dữ liệu phục vụ resume.

## TTS providers

Khởi động app và CapCut bridge cùng lúc:

```bash
npm start
```

Thiết lập toàn bộ dependencies, Python bridge và database lần đầu:

```bash
npm run setup
```

Các lệnh tiện ích: `npm run bridge`, `npm run bridge:reload`, `npm run bridge:health`, `npm run bridge:check-config`, `npm run verify`.

`npm start` tự chạy toàn bộ preflight và kiểm tra tuổi capture. Mặc định capture được xem là cần làm mới sau 24 giờ, tính theo `captured_at` trong config hoặc thời gian sửa file `capcut.local.json`. Capture thiếu/hết hạn chỉ hiện cảnh báo để app vẫn mở; đặt `CAPCUT_CAPTURE_REQUIRED=true` nếu muốn chặn start. Có thể đổi thời hạn bằng `CAPCUT_CAPTURE_MAX_AGE_HOURS`; đặt `0` để tắt kiểm tra thời gian.

Lệnh này dùng Python trong `tools/capcut_bridge/.venv`, chạy bridge tại `127.0.0.1:8000`, sau đó khởi động Electron. Nhấn `Ctrl+C` để dừng cả hai.

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
- MP3, thumbnail và video cuối nằm trong `output/<tên-truyện>--<id>/{audio,images,videos}`; bấm **Mở output truyện** trên thanh trên cùng để mở trực tiếp.
