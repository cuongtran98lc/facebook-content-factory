// Synthesized from the user's stickman_youtube_content_generator.txt.
// Examples are a taxonomy for original combinations, not scripts to reproduce.
export const CONTENT_PILLARS = [
  ['Tình yêu & các mối quan hệ', 'crush, hẹn hò, yêu xa, ghen, hiểu lầm, chia tay, người cũ, phản bội, friendzone, cầu hôn, hy sinh, cơ hội thứ hai; conflict: tin tưởng, bí mật, lựa chọn, khoảng cách'],
  ['Karma / Hậu quả', 'bắt nạt, kiêu ngạo, nói dối, tham lam, giả tử tế, cướp công, lừa đảo, thất hứa, tha thứ; hành động → lợi thế tạm → hậu quả → đảo chiều'],
  ['Expectation vs Reality', 'hẹn hò, sống một mình, trưởng thành, việc đầu tiên, du lịch, gym, ăn kiêng, game, mua sắm, thú cưng, học kỹ năng; kỳ vọng → thực tế → rắc rối tăng → punchline'],
  ['POV / Đời thường', 'báo thức, thức khuya, trì hoãn, hết pin, mất Wi-Fi, thêm một ván game, lỡ chuyến xe, chờ lương, đặt đồ ăn, gia đình, bạn cùng phòng, nghĩ quá nhiều; vấn đề nhỏ → phản ứng phóng đại → đồng cảm'],
  ['Tính cách / Hành vi', 'introvert/extrovert, overthinker, lười/chăm, lạc quan/bi quan, nhút nhát/tự tin, kiên nhẫn/nóng vội, cầu toàn, people pleaser, beginner/pro/expert; cùng tình huống, phản ứng khác nhau'],
  ['Tiền bạc / Nghèo vs giàu', 'ngày lương, cháy túi, tiết kiệm, nợ, trúng số, mất tất cả, rẻ/đắt, giả giàu, thừa kế, rộng lượng, tiền và tình yêu/bạn bè; lợi ích ngắn hạn vs hậu quả dài hạn'],
  ['Bạn bè / Đời sống xã hội', 'bạn thân, bạn giả, bạn mới, trung thành, ghen tị, cạnh tranh, mượn tiền, bí mật, bị loại khỏi nhóm, đoàn tụ, bạn online; lòng tin vs lựa chọn'],
  ['Công sở / Trường học / Developer', 'sếp, họp, deadline, lương, phỏng vấn, làm từ xa; giáo viên, thi, bài nhóm, tốt nghiệp; production bug, deploy thứ Sáu, legacy code, Git conflict, QA vs dev, junior vs senior, AI coding, works on my machine'],
  ['Twist / Cảm xúc / Bí ẩn', 'thân phận ẩn, hy sinh bí mật, đoàn tụ, mất mát, lòng tốt, lời hứa cũ, ảnh cũ, món quà, phản diện giả, người hùng bất ngờ; chi tiết cũ mang ý nghĩa mới'],
  ['What if / Thế giới giả định', 'HP/level, số dư công khai, thấy lời nói dối, đọc suy nghĩ, đồng hồ cuộc đời, CTRL+Z, save/load, respawn, dừng thời gian, dịch chuyển, chỉ số may mắn/tình yêu, nhiệm vụ ngày, NPC thức tỉnh; luật mới → lợi ích → khai thác → hậu quả → leo thang → khám phá cuối']
] as const

export const CAST_GUIDE = 'Bộ nhận diện cố định theo phong cách truyện stickman điện ảnh: đầu tròn trắng viền đen đậm, thân đen hẹp, tay chân đen dài với khớp rõ, bàn tay/chân nhỏ, lông mày và miệng biểu cảm dễ đọc. MAIN mặc suit đen với cà vạt đỏ, đầu không tóc; GIRLFRIEND mặc váy đen, tóc đen đuôi ngựa; BEST_FRIEND mặc áo đen đơn giản, tóc ngắn. Không ép hoodie nhiều màu. Tên, tóc, tỷ lệ cơ thể và dấu hiệu nhận diện giữ nguyên qua các cảnh; chỉ đổi trang phục khi cốt truyện yêu cầu. Chuyển động có chuẩn bị → hành động → phản ứng → nghỉ; đạo cụ bám bàn tay, chân trụ chạm đất, hướng mắt theo đối tượng, không rung/lắc vô cớ. ' + 'QUY TẮC ĐẶT TÊN NHÂN VẬT: MỌI nhân vật PHẢI được đặt tên riêng cụ thể phù hợp ngôn ngữ và thị trường mục tiêu. TUYỆT ĐỐI KHÔNG dùng tên chung chung dạng ví dụ hay mã vai trò như MAIN, GIRLFRIEND, BEST_FRIEND, Actor_1, Actor_2, Nhân vật 1, Người con 1, Anh A, Chủ tịch X. Giữ tên riêng, vai trò, ngoại hình xuyên suốt, không bắt cả ba xuất hiện. Nhân vật phụ tùy truyện: crush, ex, stranger, rival, bully, boss, coworker, teacher, student, parent, sibling, neighbor, mentor, villain, false villain, hidden hero. Mỗi người có mục tiêu và 1–2 nét tính cách; ít nhân vật, vai trò không đồng nghĩa tốt/xấu.'

export const NARRATIVE_GUIDE = [
  'Kết hợp MAIN PILLAR + secondary pillar tùy chọn + subtopic + nhân vật/quan hệ + tình huống + 1–3 cảm xúc + goal + conflict + stakes + escalation + twist/payoff + ending.',
  'Cảm xúc đa dạng: funny, curiosity, surprise, shock, anger, sadness, fear, awkward, relatable, satisfying, wholesome, hope, love, tension, mystery, excitement, nostalgia. Không ép mọi truyện thành trả thù hoặc kết vui.',
  'Conflict có thể là nhân vật vs người khác, bản thân, xã hội, tiền, thời gian, công nghệ, luật, thiên nhiên, may mắn, bí mật, quan hệ, quyền lực hoặc điều chưa biết.',
  'Escalation phải thay đổi tình hình: giải pháp gây vấn đề mới, mất tài nguyên, hết thời gian, bí mật khó giấu, stakes cá nhân, thông tin mới, lựa chọn khó. Video dài có nhiều đợt tăng tiến, không filler.',
  'Twist hợp logic và được gieo trước: hiểu lầm, thân phận, động cơ, đổi vai, đồng minh bất ngờ, chiến thắng giả, hy sinh, vật có ý nghĩa ẩn, kẽ hở quy luật. Không twist chỉ để gây sốc.',
  'Ending phù hợp: happy, sad, bittersweet, karma, wholesome, punchline, reveal, full-circle, growth, sacrifice, reconciliation hoặc open ending. Giải quyết câu hỏi chính; sequel hook không phá payoff.',
  'Visual storytelling: pose rõ, tương phản dễ đọc, hành động và đạo cụ có ý nghĩa, địa điểm dễ nhận ra, ít thoại, tránh đứng nói quá lâu; người xem tắt tiếng vẫn hiểu phần lớn tình huống.',
  'Với What if: nêu rõ quy luật, giới hạn và hậu quả, không tự đổi luật để cứu nhân vật. Dùng biểu tượng/thanh chỉ số/thông báo khi có ý nghĩa trong truyện.',
  'Tự kiểm tra premise 1–2 câu, goal/conflict rõ, curiosity, escalation, payoff, tính trực quan, originality, logic, series potential. Nếu yếu thì đổi combination; không chỉ đổi tên ví dụ.',
  'Series có luật cốt lõi dễ hiểu, cast/world tái sử dụng, mỗi tập có conflict riêng; biến đổi subtopic, quan hệ, tone, cảm xúc và twist giữa các idea.'
].join('\n')

export const SHORT_RULES = [
  'SHORT 15–60 giây: HOOK → SETUP → PROBLEM → ESCALATION → TWIST/PAYOFF → END.',
  'Một concept, một goal, một conflict, ít nhân vật; hook ngay lập tức, giảm thoại, đổi hình thường xuyên, không subplot không cần thiết.',
  'Payoff có thể là joke, karma, twist hoặc emotional ending; không bắt buộc phản diện hay lật kèo. Không lộ ending trong title/hook.'
]
export const MEDIUM_RULES = [
  'MEDIUM 1–5 phút: HOOK → SETUP → GOAL → CONFLICT → ESCALATION → REVERSAL → CLIMAX → ENDING.',
  'Nhiều tình huống nối tiếp, mục tiêu rõ, complication/mini-twist và climax. Mỗi tình huống phải đổi trạng thái, không kéo dài một gag.'
]
export const LONG_RULES = [
  'LONG 5–20+ phút: COLD OPEN → WORLD/CHARACTER → GOAL → INCITING INCIDENT → FIRST CONFLICT → ESCALATION → COMPLICATION → MIDPOINT → CONSEQUENCES → BIGGER CONFLICT → LOW POINT (nếu phù hợp) → FINAL PLAN → CLIMAX → PAYOFF → ENDING.',
  'Main có WANT, NEED/flaw nếu phù hợp và character arc. Có câu hỏi chưa giải đáp, nhiều turning point, midpoint đổi hướng và climax giải quyết conflict chính.',
  'Subplot phải liên quan main story. Không filler. Sequel hook chỉ mở câu hỏi nhỏ sau khi trả payoff chính.'
]
export function rulesForDuration(minutes: number): readonly string[] {
  return minutes <= 1 ? SHORT_RULES : minutes < 5 ? MEDIUM_RULES : LONG_RULES
}

export const GOOGLE_FLOW_STYLE_GUIDE = `STYLE DIRECTIVES — CINEMATIC 2D CARTOON STICKMAN (HENRY STICKMIN / STORYBOARD ART STYLE):
- Aesthetic: High-end 2D digital cartoon animation still frame, stylized comic story art style, clean bold black line art outlines, rich cel-shaded coloring.
- Characters: Stylized stickman character with a large smooth circular white head, bold black outline, and very expressive cartoon face with arched black eyebrows, distressed/expressive black eyes, and emotive mouth showing clear dramatic emotion. Wearing a sharp black business suit jacket with a crisp white collared shirt and red necktie. Thin black stickman arms and legs.
- Environment & Lighting: Detailed 2D cartoon room or environment with atmospheric lighting, storytelling props, environmental clues, floor reflections, and moody directional lighting casting distinct soft character shadows.
- Composition: High visual storytelling tension, clean 2D vector cartoon aesthetic.
- STRICT NEGATIVE CONSTRAINTS: Strictly 2D cartoon illustration only. Absolutely NO realistic human faces, NO photorealism, NO 3D rendering, NO CGI, NO blurry watercolor, NO messy sketches.`

export function buildGoogleFlowThumbnailPrompt(options: {
  title: string
  concept: import('../../shared/thumbnail-concepts').ThumbnailConcept
  topic?: string
  context: string
  customPrompt?: string
  audience?: string
}): string {
  const { title, concept, topic, context, customPrompt } = options

  const conceptGuidelines: Record<import('../../shared/thumbnail-concepts').ThumbnailConcept, string> = {
    PROBLEM_STATE: [
      'CONCEPT: PROBLEM STATE (High Tension Emergency)',
      '- Stylized 2D cartoon stickman (round white head, black suit with red tie, thin black limbs) in an overwhelming crisis.',
      '- Key visual clues: sitting in flooded room with water reflections, looking down in panic at a smartphone with glowing low-battery 5% red warning, 25°C digital wall thermostat.',
      '- Dramatic atmospheric lighting, cast shadows on blue wall.'
    ].join('\n'),

    SPLIT_SCREEN: [
      'CONCEPT: SPLIT-SCREEN COMPARISON (Polar Opposites)',
      '- Vertical split-screen with red "VS" circle badge in the center.',
      '- Left side: Stickman in black suit & red tie celebrating and tossing cash in a bright luxury office.',
      '- Right side: Same stickman kneeling in despair in a rainy dark alley, holding overdue termination debt contract.',
      '- High contrast visual storytelling, clean 2D comic art.'
    ].join('\n'),

    HIGH_STAKES: [
      'CONCEPT: HIGH-STAKES DILEMMA (Two Difficult Choices)',
      '- Stylized stickman in black suit & red tie under dramatic spotlight, sweating nervously between two pedestals.',
      '- Left Choice: Glowing RED BUTTON labeled "SIGN DEAL" with burning contract.',
      '- Right Choice: Glowing BLUE BUTTON labeled "REFUSE" with court lawsuit documents.',
      '- Neon sign overhead reading "CHOOSE NOW". Red and blue colored rim lighting.'
    ].join('\n')
  }

  return [
    'FORMAT: 16:9 Landscape YouTube Thumbnail.',
    GOOGLE_FLOW_STYLE_GUIDE,
    conceptGuidelines[concept] || conceptGuidelines.PROBLEM_STATE,
    `Story Scene: ${title}. ${topic ? `Topic: ${topic}.` : ''} ${context ? context.slice(0, 350) : ''}`,
    customPrompt?.trim() ? `Extra details: ${customPrompt.trim()}` : ''
  ].filter(Boolean).join('\n\n')
}

