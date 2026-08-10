# Content Factory Desktop — MVP v0.2

Desktop app local cho flow **Topic → Idea → Script → Media → Render**.

## V0.2 có gì

- Electron + React + Vite + TypeScript
- SQLite + Prisma local database
- Project CRUD + local project folders
- Electron Main / Preload / Renderer tách biệt qua typed IPC
- Settings cho Gemini/OpenAI
- API key được mã hóa bằng Electron `safeStorage`, không expose cho renderer
- AI provider abstraction (`AIProvider`)
- Gemini REST adapter
- OpenAI Responses API adapter
- Test AI connection từ UI
- Idea Generator theo project/niche/topic
- JSON parsing + score normalization
- Idea Bank UI
- Chọn 1 idea làm topic chính cho project
- Job + project status cho `GENERATE_IDEAS`
- FFmpeg health check giữ nguyên từ v0.1

## Yêu cầu

- Node.js 20+ (khuyên Node 22)
- npm
- FFmpeg (chưa bắt buộc cho Idea Generator)

macOS:

```bash
brew install ffmpeg
```

## Chạy app

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run dev
```

> Prisma CLI dùng `.env` khi push schema. Runtime Electron vẫn dùng SQLite dưới `app.getPath('userData')/data/content-factory.db`.

## Cấu hình AI

Mở **Settings** trong app:

1. Chọn `Gemini` hoặc `OpenAI`.
2. Nhập model muốn dùng.
3. Nhập API key.
4. Save Settings.
5. Bấm Test provider.

API key chỉ được giải mã trong Electron main process khi thực hiện request AI.

## Flow hiện tại

```text
Create Project
     ↓
Configure AI
     ↓
Generate Ideas
     ↓
Idea Bank
     ↓
Select Idea
     ↓
Project topic updated
```

## Local data

macOS thường nằm tại:

```text
~/Library/Application Support/content-factory-desktop/
```

Trong đó:

```text
content-factory-desktop/
├── settings.json          # API key là encrypted blob
└── data/
    ├── content-factory.db
    └── projects/
        └── <project-id>/
```

## Module v0.3.3 tiếp theo

- Script Generator từ selected idea
- Prompt templates
- Script versioning
- AI reviewer + score
- Rewrite theo feedback
- Script Editor UI
- Approve script
- Reel Generator từ long story

## Kiến trúc AI

```text
React
  ↓ IPC
Electron Main
  ↓
AIService
  ↓
AIProvider
  ├── GeminiProvider
  └── OpenAIProvider
```

Renderer không biết API key và cũng không gọi API AI trực tiếp.

## v0.3 — Story & Reel scripts

Scope của v0.3 dừng ở script layer:

1. Generate Ideas (v0.2)
2. Select Idea
3. Generate LONG_STORY
4. AI Review + score
5. Rewrite thành version mới hoặc sửa tay rồi Save
6. Approve một LONG_STORY
7. Generate 1-10 Reel scripts từ bản đã approve

Chưa bao gồm TTS, image generation, subtitle hay FFmpeg rendering.

### Nâng từ v0.2.1

Source v0.3 thêm các cột metadata cho `Script`, vì vậy sau khi thay source hãy chạy:

```bash
npm install
npm run db:generate
npm run db:push
npm run dev
```

`db:push` sẽ cập nhật SQLite local hiện tại; các Project/Idea/Script cũ được giữ nguyên. Các cột mới đều nullable/default-safe.

### Flow sử dụng

- Vào Idea Bank và chọn `Use this idea`.
- Mở `Scripts`.
- Chọn target words rồi `Generate Story`.
- Có thể `AI Review`, sửa tay + `Save`, hoặc `Rewrite → new version`.
- `Approve` version muốn dùng.
- Chọn số lượng Reel rồi `Generate Reels from Approved Story`.

### Lưu ý

v0.3 vẫn dùng local JSON settings + Electron `safeStorage`; không dùng `electron-store`.


## v0.3.3 - Approve + Generate Reels

Trong màn hình Scripts, chọn LONG_STORY version cần dùng rồi bấm **Approve Version & Generate Reels**. App sẽ chạy tuần tự:

1. Save nội dung editor hiện tại.
2. Approve đúng LONG_STORY version đang mở và bỏ approve các version cũ.
3. Generate số Reel scripts đang chọn (1-10) từ version vừa approve.
4. Reload Story/Reels và cập nhật project thành `REELS_READY`.

Nút **Generate Again** vẫn giữ lại để regenerate reels từ story đã approve mà không cần approve lại.


## Voice gate before approve (v0.3.3)

1. Settings → Voice/TTS: save ElevenLabs API key and model (default `eleven_multilingual_v2`).
2. Scripts → LONG_STORY: `Load voices`.
3. Select a voice, edit the Vietnamese test sentence, click `Test voice` and listen to the generated MP3.
4. Click `Use this voice`. The selected `voiceId` + `voiceName` are stored on the Project.
5. Only then can the story be approved / approved + reels generated.

After upgrading from v0.3.1 run `npm run db:generate && npm run db:push` to add `voiceId` and `voiceName` to the local SQLite schema.


## v0.3.3 Story MP3 + loop video
- Generate full LONG_STORY TTS bằng ElevenLabs; story dài được chia chunk tự động.
- Lưu `audio/story.mp3` trong project local.
- Chọn một background video từ máy; app copy vào `background/` của project.
- FFmpeg loop background vô hạn và dừng đúng khi story MP3 kết thúc.
- Output presets: 16:9, 9:16, 1:1; fit mode crop hoặc pad.
- Output nằm tại `videos/story-*.mp4` và có preview/open-folder trong app.
- Yêu cầu `ffmpeg` và `ffprobe` có trong PATH.
