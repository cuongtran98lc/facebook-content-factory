# Kế hoạch 30 ngày: Kênh "Chuyện tình yêu đêm khuya" (YouTube + Facebook + TikTok)

**Tạo:** 2026-08-20 | **Loại:** Content/Growth plan (không phải software plan) | **Công cụ sản xuất:** content-factory-desktop (Idea → Script → Voice → Render)

## Quyết định đã chốt (Step 0)

| # | Quyết định | Lựa chọn |
|---|---|---|
| 1 | Chủ đề/niche | **Chuyện tình yêu / tâm sự đêm khuya** |
| 2 | Mục tiêu TikTok | Bỏ mục tiêu kiếm tiền TikTok tháng này — dùng làm kênh phễu kéo traffic/sub chéo về YouTube (CRP chưa mở ở VN) |
| 3 | Phạm vi kỹ thuật | Giữ nguyên app hiện tại — YouTube auto-đăng qua Scheduler có sẵn; Facebook/TikTok đăng tay |

## 0. Kiểm tra thực tế — đừng tự lừa mình (Proxy Skepticism)

**Không có cách nào để một kênh mới từ 0 subscriber đạt kiếm tiền ĐẦY ĐỦ trên cả 3 nền tảng trong 30 ngày** theo đúng luật chơi hiện tại. Đây là số liệu thật (nguồn ở cuối file), không phải ước lượng:

| Nền tảng | Ngưỡng ĐẦY ĐỦ | Ngưỡng THẤP NHẤT có thể chạm trong 30 ngày |
|---|---|---|
| **YouTube** | 1,000 sub + 4,000 giờ xem/12 tháng, HOẶC 10M view Shorts/90 ngày | **Early Access:** 500 sub + 3 video công khai + 3,000 giờ xem HOẶC 3M view Shorts/90 ngày (mở Super Thanks/Membership/Shopping sớm, chưa full ads) |
| **Facebook** | 10,000 follower + 600,000 phút xem/60 ngày | **Reels bonus tier thấp:** 5,000 follower + (60,000 phút/60 ngày HOẶC **5 reels active/30 ngày**) |
| **TikTok** | 10,000 follower + 100,000 view/30 ngày, 18+ — **CRP chưa có ở Việt Nam** (chỉ 12 nước, Đông Nam Á dự kiến cuối 2026/2027) | Không có mốc tiền thật ở VN tháng này → mục tiêu thay thế: 1,000 follower (đủ bật LIVE Gifts) |

→ **Mục tiêu thực của tháng 1 là chạm ngưỡng THẤP NHẤT có thể chạm** (cột phải), không phải ngưỡng đầy đủ. Coi tháng 1 là giai đoạn build hệ thống sản xuất + tìm pillar thắng, tháng 2-3 mới thực sự đạt full monetization nếu tháng 1 chạy đúng.

## 1. Định vị kênh

- **Niche:** Chuyện tình yêu, tâm sự đêm khuya — kể chuyện bằng giọng đọc AI nữ ấm, tông chậm rãi, nghe trước khi ngủ.
- **Đối tượng:** Nữ 20-35 tuổi, VN, nghe podcast/kể chuyện buổi tối.
- **Giọng đọc thương hiệu:** Chọn **1 giọng cố định** trong Voice Library của app cho toàn bộ kênh — giọng là thứ khán giả nhận diện, không đổi giọng giữa chừng.
- **Content pillar (xoay vòng 5 chủ đề con để tránh nhàm):**
  1. Tình đầu dang dở / chưa nói lời yêu
  2. Ngoại tình / người thứ ba
  3. Yêu xa — cách trở địa lý
  4. Yêu lại sau đổ vỡ (tuổi 30+)
  5. Thầm thương trộm nhớ / tình yêu một phía

## 2. Format & nhịp sản xuất

- **1 video dài/ngày** (16:9, 15-25 phút, LONG_STORY) → đăng YouTube (video chính, driver watch-time)
- **3-5 Shorts/Reels/ngày** (9:16, 30-60s, cắt từ video dài, có cliffhanger) → đăng YouTube Shorts + TikTok + Facebook Reels
- Mỗi Short/Reel kết ở đoạn cao trào, caption "Xem trọn bộ tại kênh YouTube [tên]" → kéo view chéo về YouTube (nơi duy nhất có ads thật).

## 3. Quy trình đăng bài (theo quyết định giữ nguyên scope kỹ thuật)

```
App: Idea → Script → Voice → Render (long 16:9 + auto split reel 9:16)
        │
        ├─→ YouTube: Scheduler có sẵn (YouTubeService) tự upload theo lịch
        │
        └─→ Facebook + TikTok: xuất file .mp4 + đọc title/description
             từ file .metadata.txt cạnh video → đăng tay (~2-3 phút/video)
             checklist: caption ngắn gọn + 3-5 hashtag niche + link YouTube trong bio
```

*Cân nhắc sau tháng 1 (KHÔNG nằm trong scope tháng này):* nếu khối lượng đăng tay trở thành nút thắt, xây thêm Facebook Graph API + TikTok Content Posting API trong app — cả hai đều cần thời gian chờ nền tảng duyệt app, nên KHÔNG phù hợp để bắt đầu ngay trong 30 ngày đầu.

## 4. Chiến thuật tăng like/sub/view

- **Hook 3 giây đầu:** câu hỏi hoặc tình huống gây tò mò ngay khung hình đầu, không mở đầu vòng vo.
- **Cliffhanger:** mọi Short/Reel dừng ở điểm cao trào — không giải quyết trong đoạn ngắn.
- **Series nhiều tập:** pillar thắng ở tuần 1-2 chuyển thành series có tập tiếp theo → tăng session time và tỉ lệ sub (người xem quay lại).
- **Câu hỏi cuối video:** luôn kết bằng 1 câu hỏi cho khán giả trả lời trong comment (đẩy engagement velocity, thuật toán ưu tiên).
- **Giờ đăng:** 12h trưa (giờ nghỉ) và 21h-22h đêm (giờ tâm sự) — điều chỉnh lại theo Audience tab thực tế từ tuần 3.
- **Playlist YouTube theo pillar:** giữ watch-time liên tục giữa các tập.
- **Trả lời comment trong giờ đầu** sau khi đăng — engagement sớm quyết định phân phối ban đầu của thuật toán.

## 5. Lộ trình 30 ngày

### Tuần 1 (Ngày 1-7) — Dựng hệ thống sản xuất
- Setup kênh: tên, mô tả, avatar, banner, link chéo 3 nền tảng trong bio.
- YouTube: bật 2FA, **link AdSense ngay từ đầu** (không chờ đủ điều kiện mới làm, tránh mất thời gian sau), tạo channel trailer giới thiệu pillar.
- Trong app: tạo 7 ý tưởng theo 5 pillar, generate script, chốt giọng đọc thương hiệu.
- Đăng 3-4 video đầu để có nội dung nền — **không kỳ vọng viral tuần này**, đây là tuần build nền.
- Bắt đầu track daily: sub, view, giờ xem, follower FB/TikTok.

### Tuần 2 (Ngày 8-14) — Tăng tốc + Test
- Đạt đủ nhịp: 1 video dài + 4 Shorts/Reels/ngày trên cả 3 nền tảng.
- A/B test 2 phong cách tiêu đề/thumbnail khác nhau — xem phong cách nào giữ chân tốt hơn.
- Xem Retention graph trong YouTube Studio, cắt bỏ đoạn rớt view cao trong lần dựng tiếp theo.
- Đẩy mạnh Shorts/Reels — đây là kênh khám phá nhanh nhất với kênh mới 0 subscriber.

### Tuần 3 (Ngày 15-21) — Nhân đôi pillar thắng
- Xác định pillar có retention/watch-time cao nhất từ dữ liệu tuần 1-2 → tăng tỉ trọng sản xuất pillar đó.
- Bắt đầu series nhiều tập cho pillar thắng.
- Điều chỉnh giờ đăng theo Audience tab thực tế (không theo giả định ban đầu ở mục 4).
- Checkpoint: đang ở đâu so với mốc Early Access YPP (500 sub / 3 video / 3,000 giờ hoặc 3M view Shorts/90 ngày)?

### Tuần 4 (Ngày 22-30) — Dồn lực chạm ngưỡng
- Dồn 100% sản xuất vào format đã chứng minh hiệu quả nhất.
- Nếu đạt 500 sub + 3,000 giờ (hoặc 3M view Shorts) → **nộp đơn Early Access YPP ngay lập tức**.
- Facebook: kiểm tra đã đạt "5 reels active/30 ngày" (ngưỡng thấp nhất) chưa — đây là mốc khả thi nhất trong kế hoạch này vì chỉ cần đăng đều, không phụ thuộc viral.
- TikTok: chốt số liệu follower/view thực tế — mục tiêu tối thiểu 1,000 follower để bật LIVE Gifts; ghi nhận vị trí hiện tại để sẵn sàng khi CRP mở ở Đông Nam Á.
- Retro cuối tháng: giữ lại pillar nào, bỏ pillar nào, điều chỉnh gì cho tháng 2.

## 6. Rủi ro & chính sách cần lưu ý

- **Nội dung nhạy cảm:** chủ đề ngoại tình/tâm sự người lớn — tránh mô tả tình dục lộ liễu để không bị giới hạn độ tuổi hoặc demonetize.
- **Nội dung tổng hợp AI:** một số nền tảng yêu cầu gắn nhãn nội dung có giọng đọc/hình ảnh AI tạo sinh mang tính "hiện thực" (realistic). Kiểm tra mục công bố nội dung tổng hợp trong YouTube Studio khi đăng, dù kể chuyện bằng giọng đọc trên nền ảnh/video nền thường không thuộc diện bắt buộc.
- **Bản quyền:** chuyện tự sáng tác/AI viết an toàn hơn hẳn dạng tóm tắt phim/truyện có sẵn — giữ nguyên hướng tự sáng tác để tránh Content ID.
- **Kỷ luật đăng bài:** rủi ro lớn nhất của kế hoạch là đứt gãy lịch đăng (dễ xảy ra ở tuần 2-3 khi khối lượng tăng) — checklist đăng tay FB/TikTok cần làm cố định 1 khung giờ/ngày để không bị trôi.

## 7. Chỉ số theo dõi hàng ngày

Subscriber mới | Tổng giờ xem (rolling 7 ngày) | Avg view duration % | View Shorts | Follower FB + phút xem | Follower TikTok + view 30 ngày | Pillar nào đang thắng

## 8. Định nghĩa hoàn thành tháng 1

- [ ] Hệ thống sản xuất chạy ổn định 1 video dài + 4 Shorts/Reels/ngày, liên tục 30 ngày không đứt gãy.
- [ ] YouTube đạt tối thiểu Early Access tier, hoặc rõ ràng đang trên đà đạt trong 60-90 ngày tới.
- [ ] Facebook đạt tối thiểu ngưỡng "5 reels active/30 ngày".
- [ ] TikTok đạt tối thiểu 1,000 follower, xác định rõ content nào viral nhất để feed ngược vào YouTube.
- [ ] Xác định được 1-2 pillar chủ lực để nhân rộng ở tháng 2.

## Nguồn số liệu monetization (kiểm chứng 20/08/2026)

- YouTube Partner Program requirements 2026 — nexlev.io, tubebuddy.com, studiobinder.com
- TikTok Creator Rewards Program eligibility 2026 — postlinkapp.com, timetopost.co
- TikTok Vietnam alternative monetization (LIVE Gifts, Shop) — coingate.com, miraflow.ai
- Facebook Content Monetization / Reels bonus requirements 2026 — fluxnote.io, artha.link
