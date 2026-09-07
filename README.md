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
Chọn Dynamic / Whoosh / Impact / Chime, mức SFX và bật/tắt phụ đề
  ↓
FFmpeg loop background, duck voice, trộn 1 SFX và đốt phụ đề vào video
  ↓
story-*.mp4 + title/description tương ứng
```

SFX chỉ được trộn vào MP4 cuối, không ghi đè file MP3 voice. Preset `Dynamic` luân phiên Whoosh / Impact / Chime và thay đổi thời điểm theo từng tập.

Phụ đề mặc định được bật khi render Story/Short/Reel. App tự chia script thành cụm tối đa 2 dòng, tạo file ASS trong `subtitles/` và đốt chữ trắng viền đen trực tiếp vào MP4; có thể tắt bằng checkbox **Phụ đề** trước khi render.

Khi Output là `9:16`, Story MP3 được chia liên tục thành các file `story-reel-short-XX-of-YY.mp4`. Các phần được cân bằng để không có đoạn cuối quá ngắn và không phần nào dài quá 3 phút. Output `16:9` và `1:1` vẫn tạo một video.

Các bản render `16:9`, `9:16` và `1:1` được giữ độc lập trong cùng folder truyện; tạo một tỷ lệ mới không làm ẩn kết quả của tỷ lệ trước.

Sau khi render, app tự tạo metadata đăng bài bằng AI: video dài `16:9` có một title/description cho toàn truyện; mỗi Short `9:16` và mỗi Reel có title/description riêng theo đúng phần nội dung. Nếu AI lỗi hoặc hết quota, app dùng fallback để video vẫn hoàn tất. UI có nút copy riêng và nút **Generate/Regenerate Titles & Descriptions** cho video cũ. Một file `*.metadata.txt` cũng được lưu cạnh từng MP4.

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
- Tự tạo và đốt phụ đề tiếng Việt từ đúng Story/Reel script; file nguồn `.ass` được lưu trong thư mục `subtitles` của output.
- Tự tạo title/description tương ứng cho video dài và từng video ngắn; có nút copy và sidecar `*.metadata.txt`.
- MP3, thumbnail, phụ đề và video cuối nằm trong `output/<tên-truyện>--<id>/{audio,images,subtitles,videos}`; bấm **Mở output truyện** trên thanh trên cùng để mở trực tiếp.

### Hoạt hình người que theo truyện

Sau khi generate và chọn idea, tạo Full Story rồi làm trong phần media:

1. **Generate Story MP3** từ bản truyện hiện tại.
2. Chọn **Output** (16:9, 9:16 hoặc 1:1), rồi bấm **Tạo hoạt hình người que** ở bước 2. Chọn nguồn chia cảnh: **Codex CLI trên máy** (mặc định) hoặc **AI API trong Settings**. Sharp và FFmpeg dựng hoạt hình trên máy.
3. Xem trước video nền, chọn SFX/phụ đề rồi bấm **Generate Story Video** để xuất MP4 có lời đọc. Output 9:16 tự chia Short nối tiếp đúng vị trí trong hoạt hình.

Bản đầu dùng các bối cảnh và động tác 2D có sẵn (đi, chạy, nói, khóc, vui, giận, ngồi, vẫy tay). Nhân vật được phân biệt bằng tên và màu xuyên suốt các cảnh. Thời điểm chuyển cảnh ước lượng theo số từ và tổng thời lượng MP3, chưa căn từng câu bằng nhận dạng giọng nói. Storyboard JSON được lưu cạnh video hoạt hình trong thư mục `background` của output dự án.

Khi sửa truyện, tạo lại MP3 và hoạt hình; khi đổi Output, tạo lại hoạt hình theo tỉ lệ mới. MP3 tạo từ phiên bản cũ cần generate lại một lần để lưu thông tin đối chiếu nội dung. Hoạt hình Full Story dùng cho **Render Story**, bao gồm Short 9:16; không dùng làm nền cho các Reel scripts đã viết lại riêng.

Kiểm tra tính năng: `node tools/test-stick-animation.cjs`; thêm `--render` để chạy kiểm tra MP4 thực bằng FFmpeg/ffprobe, gồm ghép âm thanh và cắt đúng cảnh.

#### Dùng Codex CLI khi Gemini quá tải

Ở bước 2, chọn **Nguồn chia cảnh → Codex CLI trên máy**, rồi **Tạo hoạt hình người que**. CLI dùng phiên đăng nhập riêng; nếu chưa đăng nhập, chạy `codex login` trong Terminal. CLI vẫn cần kết nối dịch vụ AI. Tùy chọn này áp dụng cho storyboard người que, các bước AI khác vẫn dùng provider trong Settings.

App tìm `codex` trong `~/.local/bin`, Homebrew hoặc PATH; có thể đặt `CODEX_CLI_PATH` thành đường dẫn executable nếu cài ở vị trí khác. Cần bản CLI hỗ trợ `exec --ignore-user-config --ephemeral`. App dùng cấu hình mặc định CLI và phiên đăng nhập hiện có, không nạp cấu hình cá nhân; gửi truyện qua stdin trong thư mục tạm, chạy sandbox read-only và đọc câu trả lời cuối qua file. Mỗi lần gọi giới hạn 5 phút. Tham khảo [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/).

Kiểm tra adapter không gọi AI thật: `node tools/test-codex-cli.cjs` (stdin, dọn file tạm, lỗi CLI, timeout, kết quả rỗng).

Hoạt hình hiện dùng phong cách doodle nền trắng, đầu tròn lớn, nét đen và điểm nhấn màu. Khung hình chuyển động được dựng ở 60 fps; Render Story cũng giữ 60 fps. Bản xem trước tạo mới được ghép sẵn lời đọc và không bật mute mặc định. Video đã tạo trước cập nhật cần bấm **Tạo hoạt hình người que** lại để có hình mới và tiếng; bản xuất cuối cần render lại. Phần chuyển động hiện dùng chu kỳ động tác 2 giây trong từng cảnh.

Storyboard chi tiết: mỗi cảnh có thể chọn tóc (ngắn/dài/búi), độ tuổi, trang phục, biểu cảm độc lập với động tác, vị trí và hướng nhìn. Tóc và độ tuổi của nhân vật cùng tên được giữ nhất quán; trang phục và đạo cụ thay đổi theo đoạn truyện. Các động tác đọc, dùng điện thoại, mang đồ và chỉ tay đã được bổ sung. Đạo cụ cầm tay gồm sách, điện thoại, túi, thư, cốc và hoa; bối cảnh có thể thêm bàn, ghế, giường, cửa, cây và kệ sách. App chia đoạn ngắn hơn (mục tiêu 140 ký tự, điều chỉnh theo độ dài truyện, khoảng tối đa 100 đoạn) để tạo nhiều cảnh hơn. Đây vẫn là bộ dựng theo mẫu; chi tiết ngoài danh sách chưa được vẽ tự do. Tạo lại hoạt hình để áp dụng storyboard mới.

Generate Ideas dùng 10 pillar theo tài liệu Stickman do người dùng cung cấp, gồm cả What if, trường học và developer life. Tạo ít nhất 10 idea để đủ nhóm. Xem [bản tổng hợp và cách áp dụng](docs/stickman-content-engine.md).

Bộ nhân vật cố định trong storyboard mới: MAIN hoodie xanh dương, GIRLFRIEND hoodie hồng, BEST_FRIEND hoodie vàng; đầu trắng, body đen, mắt đơn giản. Vai trò được giữ theo tên qua các cảnh và màu áo được áp dụng ở renderer. Nhân vật phụ vẫn dùng chi tiết tóc/trang phục riêng. Generate lại idea và hoạt hình để áp dụng.
