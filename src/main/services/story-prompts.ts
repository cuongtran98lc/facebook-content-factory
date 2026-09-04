type IdeaPromptInput = {
  count: number
  niche: string
  topic: string
}

const STORY_ENGINE_RULES = [
  'Hành trình cảm xúc cốt lõi: BỰC TỨC → ỨC CHẾ → XUỐNG ĐÁY → TIA HY VỌNG → LẬT KÈO → HẢ HÊ → THỎA MÃN.',
  'Ưu tiên truyện đời sống, tình yêu, hôn nhân, gia đình, công sở, bạn bè, phản bội, bị coi thường, bị vu oan, cướp công hoặc người yếu thế chịu bất công.',
  'Xung đột phải hiểu được trong vài giây. Nhân vật chính không được thắng quá sớm hoặc quá dễ.',
  'Phản diện phải có động cơ cụ thể như tiền, địa vị, lòng tham, ghen tị, quyền lực, tình cảm hoặc danh tiếng.',
  'Plot twist phải được gieo trước bằng một chi tiết có thể nhận ra khi nhìn lại; không dùng may mắn hay cứu tinh ngẫu nhiên.',
  'Hậu quả của phản diện phải hợp lý và xuất phát từ chính hành động của họ; không trả thù cực đoan.',
  'Kết đẹp không chỉ là kẻ xấu thua: nhân vật chính phải chủ động góp phần chiến thắng và thật sự tiến lên.',
  'Luôn duy trì câu hỏi “chuyện gì xảy ra tiếp theo?”, ưu tiên show-don’t-tell và logic nội bộ.'
].join('\n- ')

export const STORY_ENGINE_SYSTEM_PROMPT = [
  'Bạn là chiến lược gia nội dung và biên kịch storytelling tiếng Việt cho Facebook Reels lẫn video dài.',
  'Bạn tạo nội dung nguyên bản, dễ hiểu, giàu nhịp kể, giữ chân cao và không giật tít sai sự thật.',
  `Quy tắc bắt buộc:\n- ${STORY_ENGINE_RULES}`
].join('\n')

export function buildIdeasPrompt({ count, niche, topic }: IdeaPromptInput): string {
  return [
    `Tạo đúng ${count} ý tưởng truyện bằng tiếng Việt.`,
    `Ngách: ${niche}`,
    `Chủ đề gốc: ${topic}`,
    '',
    'Mỗi ý tưởng phải dùng được cho CẢ HAI định dạng:',
    '- REEL: bản kể dọc 9:16 khoảng 60 giây, xung đột xuất hiện ngay, có open loop và payoff hoặc cliffhanger hợp lý.',
    '- LONG VIDEO: có đủ chiều sâu để phát triển thành truyện dài nhiều nhịp, không phải kéo loãng một tình huống ngắn.',
    '',
    'Trước khi trả kết quả, tự phát triển và kiểm tra đủ 9 thành phần cho từng idea:',
    '1) nhân vật chính; 2) hoàn cảnh ban đầu; 3) điều bất công; 4) nhân vật đối đầu và động cơ; 5) biến cố làm tình hình tệ hơn; 6) twist seed/bí mật; 7) hành động giúp nhân vật chính lật ngược tình thế; 8) hậu quả của kẻ gây bất công; 9) kết quả tốt đẹp mới của nhân vật chính.',
    '',
    'Tự chấm 1–10 theo 5 tiêu chí: gây bực tức, tò mò, plot twist, payoff thỏa mãn, khả năng phát triển thành series.',
    'score là điểm tổng hợp trung bình của 5 tiêu chí. Chỉ giữ các idea có logic tốt và score từ 8 trở lên; tự sửa idea yếu trước khi xuất.',
    'Các idea phải khác nhau rõ ràng về bối cảnh, kiểu bất công và cách lật kèo.',
    '',
    'Trả về JSON thuần, không markdown, không giải thích ngoài JSON:',
    'Trong description, bắt buộc viết các mục dưới đây và ngăn cách từng mục bằng ký hiệu ||:',
    '- TÓM TẮT: 2–4 câu chứa đủ nhân vật/hoàn cảnh, bất công, đối thủ/động cơ, tình hình tệ hơn, cách lật kèo, hậu quả và kết đẹp.',
    '- HÀNH TRÌNH CẢM XÚC: Bực → Ức chế → Xuống đáy → Hy vọng → Lật kèo → Hả hê → Thỏa mãn (ghi diễn biến cụ thể, thật ngắn cho từng nhịp).',
    '- TWIST SEED: chi tiết được gieo trước và cách nó quay lại tạo cú lật.',
    '- GỢI Ý REEL 60S: mốc Hook 0–3s; Setup 3–10s; Bất công 10–30s; Đáy 30–40s; Seed 40–48s; Reveal 48–55s; Payoff/Cliffhanger 55–60s.',
    '- GỢI Ý LONG VIDEO: 5–8 nhịp phát triển chính và các lớp xung đột có thể mở rộng.',
    '- GỢI Ý ĐĂNG: frame đầu 4–8 từ; một CTA dạng câu hỏi; 3–5 hashtag liên quan.',
    '- ĐIỂM: Bực X/10 · Tò mò X/10 · Twist X/10 · Payoff X/10 · Series X/10.',
    '',
    'Trả về JSON theo đúng mẫu (ký hiệu || phải nằm bên trong chuỗi description):',
    '{"ideas":[{"title":"Tiêu đề ngắn, tò mò, không lộ ending","hook":"Hook tối đa 15 từ, có xung đột/curiosity gap","description":"TÓM TẮT: ... || HÀNH TRÌNH CẢM XÚC: ... || TWIST SEED: ... || GỢI Ý REEL 60S: ... || GỢI Ý LONG VIDEO: ... || GỢI Ý ĐĂNG: ... || ĐIỂM: ...","score":8.8}]}',
    '',
    'Không tự chọn thay người dùng; thứ tự danh sách phải từ mạnh nhất xuống thấp hơn.'
  ].join('\n')
}

export const LONG_STORY_RULES = [
  'Triển khai đúng hành trình Bực tức → Ức chế → Xuống đáy → Tia hy vọng → Lật kèo → Hả hê → Thỏa mãn.',
  'Mở bằng hook trong 2 câu đầu; đưa xung đột vào sớm, rồi tăng mức bất công theo từng nhịp.',
  'Cho nhân vật chính mất một thứ quan trọng trước khi xuất hiện tia hy vọng.',
  'Gieo twist seed kín đáo từ trước; nhân vật chính phải chủ động sử dụng nó để lật tình thế.',
  'Mỗi đoạn phải tăng xung đột, tò mò, cảm xúc, thông tin hoặc payoff; bỏ giới thiệu, câu lặp và nhân vật phụ không cần thiết.',
  'Dùng câu và đoạn ngắn, ngôn ngữ đời thường, phù hợp đọc TTS; kể bằng hành động thay vì giải thích cảm xúc.',
  'Kết thúc bằng hậu quả hợp lý cho phản diện và một bước tiến cụ thể của nhân vật chính.'
]

export const REEL_SCRIPT_RULES = [
  'Mỗi Reel phải tự đứng độc lập, kể một lát cắt có mở–thắt–lật–kết rõ ràng; chỉ dùng cliffhanger khi nó thật sự dẫn sang phần tiếp.',
  '0–3 giây: hook có xung đột, điều bất thường hoặc câu hỏi chưa được giải đáp.',
  '3–10 giây: thiết lập ai là ai và chuyện gì xảy ra, không kể tiểu sử.',
  '10–30 giây: bất công xảy ra rồi tệ hơn; phản diện tạm thắng.',
  '30–40 giây: đáy câu chuyện, khán giả tin nhân vật chính đã thua.',
  '40–48 giây: twist seed/open loop “nhưng hắn không biết…”.',
  '48–55 giây: reveal hợp lý từ chi tiết đã gieo.',
  '55–60 giây: payoff thỏa mãn hoặc cliffhanger có chủ đích.',
  'Câu ngắn, đời thường, có nhịp; mỗi 5–10 giây có thông tin mới; không lặp, không nhồi tên.',
  'Không dùng CTA ép tương tác và không tiết lộ ending trong title/hook.'
]
