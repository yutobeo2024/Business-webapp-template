# ADR-0003: Triển khai trên một VPS bằng Docker Compose

- Ngày: 2026-10-02
- Trạng thái: Chấp nhận

## Quyết định

Một VPS (khuyến nghị 4 vCPU, 8 GB RAM, SSD) chạy Caddy (HTTPS tự động), web, api, worker, PostgreSQL, Redis.
CI build image lên GHCR; deploy qua SSH chạy `infra/deploy.sh` (sao lưu, migrate, chờ healthy, tự rollback image).
Staging là VPS thứ hai cấu hình giống hệt. Sao lưu đẩy ra ngoài máy chủ bằng rclone; giám sát uptime từ máy khác.

## Lý do

Đủ cho vài trăm người dùng nội bộ, chi phí thấp, dễ bàn giao, đội nhỏ vận hành được. Có thể đặt tại trung tâm dữ liệu trong nước.

## Khi nào phải đổi

Cần SLA > 99,9% hoặc tải vượt một máy: tách PostgreSQL sang dịch vụ managed hoặc máy riêng có replica, chạy nhiều bản api sau
load balancer, cân nhắc Kubernetes. Ghi ADR mới trước khi đổi.
