# Bộ tạo nội dung Stickman

Tổng hợp từ `stickman_youtube_content_generator.txt` do người dùng cung cấp. Ví dụ trong tài liệu được dùng làm taxonomy, không phải kịch bản phải sao chép. Bộ hoodie xanh–hồng–vàng theo yêu cầu trước đó vẫn là nhận diện chính.

## Idea

10 pillar: tình yêu/mối quan hệ; Karma/hậu quả; Expectation vs Reality; POV/đời thường; tính cách/hành vi; tiền bạc/nghèo vs giàu; bạn bè/xã hội; công sở/trường học/developer; twist/cảm xúc/bí ẩn; What if/thế giới giả định.

Phân bổ main pillar theo số lượng yêu cầu; từ 10 idea trở lên có đủ nhóm. Cho phép secondary pillar để kết hợp chủ đề. Prompt cung cấp tối đa 30 tiêu đề gần đây trong dự án để giảm lặp; không phải kiểm tra trùng ngữ nghĩa tuyệt đối.

Mỗi concept có format, premise, subtopic, tone/emotion, world, cast/trait/relationship, goal, need/flaw, trigger, conflict, stakes, visual hook, escalation, twist/payoff, ending, series potential. Idea dài bổ sung mystery, midpoint, low point, climax và character arc. Hài/đối chiếu không bị ép thành trả thù; ending không bắt buộc vui.

## Truyện

Chọn thời lượng từ 0.25 đến 30 phút:

- 0.25–1 phút: hook → setup → problem → escalation → payoff → end.
- Trên 1, dưới 5 phút: thêm goal, reversal và climax.
- Từ 5 phút: inciting incident, nhiều escalation, midpoint, consequences, final plan, climax và arc.

Thời lượng là mục tiêu ước tính theo 145 từ/phút, không cam kết thời lượng TTS chính xác. Thời lượng người dùng chọn ưu tiên hơn format gợi ý của idea. Truyện vẫn được lưu bằng loại nội bộ `LONG_STORY` để dùng chung luồng audio/video. Reel scripts riêng tiếp tục nhắm khoảng 60 giây.

Review/rewrite dùng chung tiêu chí logic, cảm xúc, tính trực quan và tone. Văn bản truyện là lời kể tự nhiên, không đọc metadata hay chỉ dẫn máy quay.

## Nhân vật và hình ảnh

- MAIN: đầu trắng, body đen, hoodie xanh.
- GIRLFRIEND: hoodie hồng.
- BEST_FRIEND: hoodie vàng.
- Supporting: archetype và trait theo nội dung; ví dụ boss dùng suit mặc định, student dùng uniform, teacher/mentor có kính nếu phù hợp với tạo hình mặc định.

Vai trò/archetype và nhận diện theo tên được giữ qua các cảnh. Biểu cảm, hành động và props theo từng phân đoạn. Props thêm laptop, gamepad, gift, money; overlay tùy chọn gồm tin nhắn, suy nghĩ, thời gian, số dư, HP và quy luật What if. Nhãn tối đa 48 ký tự, chỉ lấy dữ kiện trong truyện. Đây là nhãn tĩnh theo cảnh, chưa phải thanh chỉ số mô phỏng hoặc UI tương tác.

Giữ doodle 60 fps, lời đọc và thumbnail tự động. Renderer vẫn dùng thư viện động tác/đạo cụ hữu hạn và chu kỳ chuyển động 2 giây; không thể vẽ tự do mọi tình tiết trong taxonomy. Nội dung cũ không tự thay đổi; generate lại các bước cần áp dụng.

## Vị trí triển khai

- `src/main/services/stickman-knowledge.ts`: taxonomy, cast, logic kể và cấu trúc theo thời lượng.
- `story-prompts.ts`, `ideas.ts`, `scripts.ts`: truyền tiêu chí qua idea, truyện, review/rewrite, Reel.
- `stick-animation.ts`, `stick-details.ts`: storyboard và hình ảnh.
- `tools/test-stick-animation.cjs --render`: kiểm tra taxonomy, format, SVG/overlay, MP4 60 fps, âm thanh và cắt cảnh.
