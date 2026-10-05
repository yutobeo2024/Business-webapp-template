---
name: handover
description: Soạn bộ tài liệu bàn giao cho doanh nghiệp khách hàng (hướng dẫn theo vai trò, tài liệu vận hành, danh mục bàn giao, biên bản nghiệm thu). Dùng khi nghiệm thu hoặc bàn giao một giai đoạn.
disable-model-invocation: true
---

# Bộ tài liệu bàn giao

Đầu ra trong `docs/handover/`, tiếng Việt, viết cho người không phải lập trình viên. Chỉ mô tả tính năng THỰC SỰ có trong mã và spec đã duyệt.

1. `huong-dan/<vai-tro>.md`: mỗi vai trò một file, theo tác vụ thực tế ("Lập phiếu đề nghị", "Duyệt phiếu"): các bước, lưu ý,
   lỗi thường gặp (lấy từ thông báo lỗi trong mã) và cách xử lý.
2. `van-hanh.md`: sơ đồ kiến trúc (mermaid), máy chủ và tên miền (không ghi secret), sao lưu/khôi phục, giám sát, xử lý sự cố,
   đầu mối hỗ trợ và SLA. Dẫn chiếu `docs/runbooks/`.
3. `danh-muc-ban-giao.md`: repo và tag, nơi lưu tài khoản quản trị (không ghi mật khẩu), tên miền, đăng ký dịch vụ đứng tên ai,
   bản sao lưu gần nhất, kết quả diễn tập khôi phục gần nhất, hạn chế đã biết.
4. `bien-ban-nghiem-thu.md`: bảng mọi AC của các spec "Đã duyệt" với cột Kết quả, Ngày kiểm, Người kiểm (để trống cho khách ký).
5. Đối chiếu `docs/PRODUCTION-CHECKLIST.md` và liệt kê mục chưa đạt.
