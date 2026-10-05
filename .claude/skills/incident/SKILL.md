---
name: incident
description: Điều tra và xử lý sự cố hoặc lỗi production có hệ thống - tái hiện, tìm nguyên nhân gốc, sửa kèm test, viết postmortem. Dùng khi người dùng báo lỗi từ khách hàng, cảnh báo giám sát, hoặc dán log/stack trace production.
argument-hint: "<mô tả sự cố | log | mã lỗi>"
---

# Xử lý sự cố

Sự cố: $ARGUMENTS

1. **Đánh giá mức độ** (theo `docs/runbooks/incident.md`): SEV1 hệ thống ngừng hoặc mất/sai dữ liệu; SEV2 một quy trình chính hỏng;
   SEV3 lỗi có cách né. SEV1/SEV2: nhắc người dùng làm bước giảm thiểu trước (rollback qua Actions > Rollback), điều tra sau.
2. **Thu thập.** Hỏi người dùng thứ bạn không tự lấy được: thời điểm, tài khoản/vai trò, mã phiếu, ảnh chụp, log
   (`infra/dc.sh logs --since 1h api` do NGƯỜI DÙNG chạy trên máy chủ). Không đọc `.env`.
3. **Khoanh vùng** bằng mã nguồn: từ mã lỗi `MODULE_REASON` hoặc endpoint tìm controller, service, state machine liên quan;
   xem `git log` các thay đổi gần thời điểm sự cố.
4. **Tái hiện bằng test** (unit hoặc tích hợp) ĐỎ trước khi sửa. Không tái hiện được thì nói rõ, không sửa phỏng đoán.
5. **Sửa nguyên nhân gốc**, test chuyển xanh, `pnpm verify:quick` xanh. Dữ liệu đã sai thì đề xuất script sửa dữ liệu riêng
   (idempotent, có dry-run, ghi audit), KHÔNG tự chạy trên production.
6. **Postmortem** `docs/runbooks/postmortems/<YYYY-MM-DD>-<ten>.md`: dòng thời gian, ảnh hưởng, nguyên nhân gốc, cách phát hiện,
   cách sửa, việc phòng ngừa (test, cảnh báo, hook mới). Viết không đổ lỗi cá nhân.
