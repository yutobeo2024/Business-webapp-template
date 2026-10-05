# Checklist trước khi go-live

Dùng cho mỗi lần bàn giao. Mục chưa đạt phải vào danh sách hạn chế đã biết và được khách xác nhận bằng văn bản.

## Bảo mật

- [ ] `/security-audit` kết luận ĐƯỢC RELEASE; CI job "Quét bảo mật" xanh
- [ ] Không còn tài khoản demo, tài khoản test; đã xóa `SEED_ADMIN_PASSWORD` khỏi `.env` và đổi mật khẩu admin
- [ ] 2FA hoặc SSO cho vai trò quản trị và duyệt chi (nếu khách yêu cầu)
- [ ] `.env` trên máy chủ quyền 600; secret sinh ngẫu nhiên ≥ 32 ký tự
- [ ] SSH chỉ bằng khóa (kiểm: `sshd -T | grep -i passwordauthentication` ra `no`); firewall chỉ mở 22, 80, 443; fail2ban chạy
- [ ] Branch protection `main`: bắt buộc PR, CI xanh, Code Owners review
- [ ] Settings > Environments: `production` có Required reviewers và "Deployment branches and tags" chỉ cho tag `v*`
      và nhánh `main` (workflow Rollback chạy từ `main`); `staging` chỉ cho nhánh `main`. Chặn deploy từ nhánh lạ
- [ ] Settings > Rules: ruleset cho tag `v*`, chỉ người phát hành được tạo, cấm xóa và cấm cập nhật
- [ ] `git ls-files -s infra/*.sh` đều `100755` (CI cũng kiểm)

## Dữ liệu

- [ ] `BACKUP_REMOTE` đã cấu hình và là remote `crypt` (mã hóa); sao lưu tự động chạy; đã diễn tập khôi phục thành công,
      ghi thời gian thực tế; mật khẩu crypt được giữ ngoài máy chủ
- [ ] Thư mục tệp `FILES_DIR` tồn tại đúng quyền (uid 1000, nhóm deploy); `backup-files.sh` chạy thành công một lần và
      đã thử lấy lại một tệp từ remote; `FILE_MAX_MB` khớp `max_size` trong `infra/Caddyfile`
- [ ] Đã in thử một PDF trên máy chủ (font tiếng Việt đúng) và xuất thử một Excel
- [ ] Dữ liệu cũ của khách (nếu chuyển đổi) đã đối soát số lượng và tổng tiền
- [ ] Audit log có cho mọi thao tác nhạy cảm

## Vận hành

- [ ] Uptime monitor ngoài, `alert-check.sh` gửi được cảnh báo thử
- [ ] Email: tên miền gửi có SPF, DKIM; đã gửi thử tới hộp thư Gmail và Outlook, không vào spam
- [ ] Zalo (nếu dùng): đã đối chiếu tài liệu Zalo hiện hành, mẫu ZNS được duyệt, tên tham số khớp, gửi thử thành công;
      `APP_ENCRYPTION_KEY` lưu ngoài máy chủ
- [ ] Đã thử rollback trên staging
- [ ] Theo dõi lỗi ứng dụng (Sentry/GlitchTip) nếu trong phạm vi hợp đồng
- [ ] Tên miền, máy chủ, tài khoản dịch vụ đứng tên khách hoặc đã thỏa thuận rõ

## Chất lượng

- [ ] Mọi AC của spec đã duyệt có test và xanh trên CI
- [ ] UAT với người dùng thật của từng vai trò; thử tải theo số người dùng đồng thời trong spec
- [ ] Hiển thị đúng trên trình duyệt và thiết bị khách dùng

## Pháp lý và bàn giao

- [ ] Đã liệt kê dữ liệu cá nhân, mục đích, thời gian lưu; rà với tư vấn pháp lý của khách theo quy định bảo vệ dữ liệu cá nhân hiện hành
- [ ] Hợp đồng ghi SLA, bảo hành, quyền sở hữu mã nguồn
- [ ] `/handover` đã sinh tài liệu; khách ký biên bản nghiệm thu
