// Nguồn dùng chung (main + renderer) cho 5 content pillar của tab Mindset —
// xem plans/20260916-1400-kenh-mindset-clone-wisejoe/plan.md mục 1-2. Tách
// riêng khỏi mindset-prompts.ts (main-only) để renderer có thể render dropdown
// chọn pillar mà không phải copy tay danh sách.
export const MINDSET_PILLARS: Array<[name: string, detail: string]> = [
  ['Luật sống / quy tắc', 'Danh sách N quy tắc cụ thể, hành động được, dẫn tới một kết quả sống mong muốn (dễ dàng hơn, nhẹ đầu hơn, kỷ luật hơn...).'],
  ['Thử thách N ngày', 'Nhật ký cá nhân kiểu thử nghiệm: bỏ/thêm một thói quen trong N ngày, kể lại quá trình và kết quả thay đổi rõ ràng ở cuối.'],
  ['Giải mã hiệu ứng tâm lý học', 'Mượn một hiệu ứng/tên gọi tâm lý học có thật (ví dụ Dunning-Kruger, Zeigarnik, Barnum, IKEA effect, Boiling frog, Marshmallow test...) để giải thích một hành vi quen thuộc, tăng uy tín và tính giáo dục.'],
  ['Chuyển hóa bản dạng', 'Giọng "tough love", đánh thẳng vào ý chí/ego người nghe — mô tả phiên bản mạnh mẽ hơn của chính họ và điều gì thay đổi khi trở thành người đó.'],
  ['Chữa lành & nhìn lại', 'Nội dung cảm xúc sâu: hối tiếc, quá khứ, phiên bản khác của bản thân, các bài học rút ra khi nhìn lại — ưu tiên tăng tỉ lệ lưu/chia sẻ.']
]
