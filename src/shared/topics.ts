export interface CompiledTopic {
  id: string;
  title: string;
  niche: string;
  icon: string;
  badge: string;
  description: string;
  subtopics: string[];
  prompt: string;
}

export const COMPILED_TOPICS: CompiledTopic[] = [
  {
    id: 'family_inheritance',
    title: 'Mẹ chia tài sản & Drama Gia đình',
    niche: 'family',
    icon: '🏠',
    badge: 'Hot Viral',
    description: 'Chuyện thừa kế, thử lòng con cái, mâu thuẫn anh chị em, con nuôi vs con ruột, lòng hiếu thảo.',
    subtopics: ['Mẹ chia tài sản cho 3 con', 'Thử lòng con cái', 'Anh cả cướp đất', 'Con nuôi gánh nợ', 'Di chúc bí mật'],
    prompt: 'Mẹ chia tài sản cho các con, thử lòng con cái, mâu thuẫn anh chị em, con nuôi vs con ruột, di chúc bí mật và bài học lòng hiếu thảo',
  },
  {
    id: 'love_relationships',
    title: 'Tình yêu & Mối quan hệ',
    niche: 'love',
    icon: '❤️',
    badge: 'Cảm xúc',
    description: 'Crush, hẹn hò, yêu xa, ghen tuông, hiểu lầm, chia tay, người cũ, phản bội, friendzone, cơ hội thứ hai.',
    subtopics: ['Crush học đường', 'Yêu xa 3 năm', 'Ghen tuông vô lý', 'Phản bội & Lật kèo', 'Người cũ quay lại'],
    prompt: 'Tình yêu và các mối quan hệ: crush, hẹn hò, yêu xa, ghen tuông, hiểu lầm, chia tay, người cũ, phản bội, friendzone, lật kèo cảm xúc',
  },
  {
    id: 'karma_retribution',
    title: 'Karma & Hậu quả',
    niche: 'karma',
    icon: '⚡',
    badge: 'Trả thù / Đáo hạn',
    description: 'Bắt nạt, kiêu ngạo, nói dối, tham lam, giả tử tế, cướp công, lừa đảo → hậu quả nhãn tiền & đảo chiều.',
    subtopics: ['Báo ứng kẻ bắt nạt', 'Giả tử tế bị bóc phốt', 'Cướp công đồng nghiệp', 'Bán đứng bạn thân', 'Tha thứ hay trả thù'],
    prompt: 'Karma và hậu quả: bắt nạt, kiêu ngạo, nói dối, tham lam, giả tử tế, cướp công, lừa đảo, thất hứa; lợi thế tạm thời và cái kết đảo chiều',
  },
  {
    id: 'expectation_reality',
    title: 'Expectation vs Reality',
    niche: 'life',
    icon: '🎭',
    badge: 'Hài hước',
    description: 'Kỳ vọng vs Thực tế khi hẹn hò, sống một mình, đi làm, đi du lịch, gym, ăn kiêng, game, mua sắm.',
    subtopics: ['Lần đầu sống riêng', 'Đi gym ngày 1 vs ngày 30', 'Hẹn hò qua mạng', 'Phỏng vấn xin việc', 'Mua hàng online'],
    prompt: 'Expectation vs Reality: kỳ vọng mơ mộng vs thực tế phũ phàng, rắc rối leo thang và punchline bất ngờ trong cuộc sống hàng ngày',
  },
  {
    id: 'pov_daily',
    title: 'POV & Đời thường',
    niche: 'life',
    icon: '📱',
    badge: 'Đồng cảm',
    description: 'Báo thức, thức khuya, trì hoãn, hết pin, mất Wi-Fi, ván game cuối, lỡ xe, chờ lương, nghĩ quá nhiều.',
    subtopics: ['Thức khuya overthinking', 'Báo thức 5 phút/lần', 'Hết tiền cuối tháng', 'Lỡ chuyến xe bus', 'Wifi chập chờn'],
    prompt: 'POV đời thường: những rắc rối nhỏ nhặt phóng đại phản ứng, thức khuya overthink, chờ lương, hết pin, tạo sự đồng cảm sâu sắc',
  },
  {
    id: 'money_wealth',
    title: 'Tiền bạc & Giàu vs Nghèo',
    niche: 'money',
    icon: '💰',
    badge: 'Tâm lý',
    description: 'Ngày nhận lương, cháy túi, tiết kiệm, vay nợ, trúng số, giả giàu, coi thường người nghèo, tiền & tình bạn.',
    subtopics: ['Ngày lương vs 3 ngày sau', 'Trúng số độc đắc', 'Vay nợ bạn thân', 'Đeo đồng hồ giả', 'Coi thường chủ tịch'],
    prompt: 'Tiền bạc và Giàu vs Nghèo: ngày nhận lương, cháy túi, vay nợ, trúng số, giả giàu thử lòng người khác, tiền bạc vs tình người',
  },
  {
    id: 'work_dev_school',
    title: 'Công sở, Trường học & Dev',
    niche: 'work',
    icon: '💻',
    badge: 'Thực tế',
    description: 'Sếp drama, deadline, họp vô tận, phỏng vấn; thi cử, làm bài nhóm; bug mã nguồn, deploy thứ 6, AI coding.',
    subtopics: ['Gánh team bài tập', 'Deadline 12h đêm', 'Deploy thứ 6 bị sập', 'Junior vs Senior', 'Sếp thích giao việc gấp'],
    prompt: 'Công sở, trường học và IT Dev: deadline dí, gánh team bài nhóm, họp vô tận, bug bùng nổ, sếp toxic, deploy thứ Sáu sập server',
  },
  {
    id: 'friends_social',
    title: 'Bạn bè & Đời sống xã hội',
    niche: 'social',
    icon: '👥',
    badge: 'Tình bạn',
    description: 'Bạn thân, bạn giả tạo, bạn mới, trung thành, ghen tị, cạnh tranh ngầm, mượn tiền không trả, bị cô lập.',
    subtopics: ['Bạn thân nói xấu sau lưng', 'Ghen tị thành công bạn', 'Cho mượn tiền mất bạn', 'Nhóm chat vắng 1 người', 'Đoàn tụ bạn cũ'],
    prompt: 'Bạn bè và đời sống xã hội: bạn thân, bạn giả tạo, ghen tị ngầm, mượn tiền không trả, bị cô lập trong nhóm, sự trung thành',
  },
  {
    id: 'twist_emotion_mystery',
    title: 'Twist, Cảm xúc & Bí ẩn',
    niche: 'mystery',
    icon: '🔍',
    badge: 'Bất ngờ',
    description: 'Thân phận ẩn, hy sinh bí mật, đoàn tụ, lòng tốt âm thầm, lời hứa cũ, món quà kỉ niệm, người hùng thầm lặng.',
    subtopics: ['Chủ tịch giả làm bảo vệ', 'Hy sinh bí mật của cha', 'Kẻ thù cứu mạng', 'Kỷ vật 10 năm trước', 'Phản diện giả'],
    prompt: 'Twist cảm xúc và bí ẩn: thân phận ẩn giấu, sự hy sinh thầm lặng, lời hứa cũ, kỷ vật quá khứ, chi tiết nhỏ mang ý nghĩa lớn',
  },
  {
    id: 'what_if_sci_fi',
    title: 'What If & Thế giới giả định',
    niche: 'scifi',
    icon: '🔮',
    badge: 'Viễn tưởng',
    description: 'Số dư hiện lên đầu, đọc suy nghĩ người khác, đồng hồ đếm ngược cuộc đời, CTRL+Z đời thực, thấy tỉ lệ nói dối.',
    subtopics: ['Nhìn thấy số dư người khác', 'Nút bấm CTRL+Z đời thực', 'Đọc được suy nghĩ crush', 'Tỉ lệ nói dối hiện %', 'Đồng hồ đếm ngược'],
    prompt: 'What If thế giới giả định: quy luật siêu nhiên kỳ lạ (thấy số dư, đọc suy nghĩ, CTRL+Z), khai thác quy luật, hậu quả vỡ lỡ và cái kết',
  },
  {
    id: 'personality_behavior',
    title: 'Tính cách & Hành vi',
    niche: 'life',
    icon: '🧠',
    badge: 'Tâm lý',
    description: 'Introvert vs Extrovert, overthinker, lười vs chăm, nhút nhát vs tự tin, people pleaser trong các tình huống.',
    subtopics: ['Hướng nội đi quẩy', 'People pleaser không biết từ chối', 'Kế hoạch hoàn hảo vs Thích làm bừa', 'Kỹ tính đến ám ảnh'],
    prompt: 'Tính cách và hành vi: Introvert vs Extrovert, overthinker, people pleaser không biết từ chối, sự đối lập phản ứng trong cùng 1 tình huống',
  },
];
