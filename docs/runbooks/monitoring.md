# Giám sát và cảnh báo

| Lớp                 | Công cụ                                                    | Phát hiện                                                                                                                          |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Uptime từ bên ngoài | Uptime Kuma trên VPS khác (`infra/compose.monitoring.yml`) | Website/API không truy cập được, chứng chỉ sắp hết hạn                                                                             |
| Sức khỏe máy chủ    | `infra/alert-check.sh` (cron 10 phút)                      | Đĩa ≥ 85%, container chết/unhealthy, sao lưu DB/tệp quá hạn, chưa diễn tập, nhiều thông báo gửi lỗi, token Zalo không làm mới được |
| Deploy              | `infra/deploy.sh`                                          | Deploy hỏng, tự rollback                                                                                                           |
| Lỗi ứng dụng        | Sentry (cloud) hoặc GlitchTip tự host                      | Exception kèm ngữ cảnh                                                                                                             |
| Lỗ hổng             | `.github/workflows/maintenance.yml` (hằng tuần)            | Lỗ hổng mới trong dependency và image đang chạy                                                                                    |

Mọi cảnh báo của máy chủ gửi về `ALERT_WEBHOOK_URL` (nhận JSON `{"text": "..."}`): Slack, Google Chat, Discord dùng trực tiếp;
Telegram/Zalo cần một relay nhỏ. Kiểm thử: `source infra/lib.sh && load_env && alert "thử cảnh báo"`.

Uptime Kuma: monitor HTTP(s) `https://<domain>/api/health`, chu kỳ 60 giây, "keyword" = `"status":"ok"`, bật cảnh báo chứng chỉ.

Log: `infra/dc.sh logs -f api` (JSON pino). Access log Caddy: volume `caddy_data`, `/data/logs/access.log`.
Sentry: thêm `@sentry/nestjs` và `@sentry/react` khi khách có tài khoản, DSN qua env (cần duyệt thêm thư viện).
