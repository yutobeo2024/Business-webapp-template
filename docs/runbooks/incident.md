# Xử lý sự cố

| Mức  | Ví dụ                                            | Phản hồi                                           |
| ---- | ------------------------------------------------ | -------------------------------------------------- |
| SEV1 | Hệ thống ngừng, mất hoặc sai dữ liệu, lộ dữ liệu | Ngay lập tức, báo đầu mối khách hàng trong 30 phút |
| SEV2 | Một quy trình chính không dùng được              | Trong 2 giờ làm việc                               |
| SEV3 | Lỗi có cách né, giao diện                        | Theo kế hoạch phát hành                            |

1. **Giảm thiểu trước, điều tra sau.** Vừa deploy: rollback ([rollback.md](rollback.md)). Hết đĩa: dọn log/image (`docker image prune`).
   Container chết: `infra/dc.sh ps` và `infra/dc.sh logs --since 30m <service>` (chạy từ `/opt/app`).
   Không còn ai quản trị được (quản trị viên nghỉ việc, bị khóa): kích hoạt lại một tài khoản và gán vai trò Quản trị hệ
   thống (có ghi audit) bằng lệnh:

   ```bash
   infra/dc.sh --profile tools run --rm migrate node dist/cli/grant-admin.js <email>
   ```

2. **Kiểm nhanh:** `curl -fsS https://<domain>/api/health` (database/redis "fail" cho biết hỏng ở đâu), `df -h`, `free -m`.
3. **Điều tra:** mở Claude Code tại repo, chạy `/incident <mô tả + log>`. Không dán secret vào phiên AI.
4. **Lộ dữ liệu cá nhân:** cô lập (tắt endpoint, thu hồi phiên: `DELETE FROM sessions`), lưu bằng chứng, báo người phụ trách
   pháp lý của khách để thực hiện nghĩa vụ thông báo theo quy định bảo vệ dữ liệu cá nhân hiện hành.
5. **Kết thúc:** postmortem trong `postmortems/` trong 3 ngày làm việc, có việc phòng ngừa cụ thể.
