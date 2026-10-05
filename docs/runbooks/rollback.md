# Rollback

**Tự động:** `deploy.sh` tự quay image về bản trước nếu container không healthy hoặc health check qua HTTPS hỏng.

**Thủ công** (lỗi nghiệp vụ phát hiện sau khi deploy thành công):

1. GitHub > Actions > Rollback > Run workflow: chọn môi trường, nhập tag đã chạy ổn (xem `deploy-history.log`).
2. Rollback không chạy migration và không đảo migration. Vì migration theo expand/contract nên image cũ vẫn chạy với schema mới.
   CI ép điều này: `scripts/check-migrations.mjs` chặn migration xóa/đổi tên/đổi kiểu cột chưa đánh dấu `-- contract:`.
   Chỉ rollback về bản LIỀN TRƯỚC; lùi xa hơn có thể gặp schema đã qua bước contract.
3. Nếu bản lỗi đã GHI SAI dữ liệu: rollback chưa đủ. Theo [incident.md](incident.md); khôi phục DB là phương án cuối
   vì mất dữ liệu phát sinh sau bản sao lưu (xem [backup-restore.md](backup-restore.md)).
4. Sửa lỗi trên nhánh mới, phát hành bản vá như bình thường. Viết postmortem nếu ảnh hưởng người dùng.
