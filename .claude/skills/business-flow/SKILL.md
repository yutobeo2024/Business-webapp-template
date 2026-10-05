---
name: business-flow
description: Chuyển yêu cầu nghiệp vụ thô (mô tả, biên bản họp, file quy trình của khách) thành spec quy trình chuẩn tiếng Việt trong docs/specs/. Dùng khi có tính năng hoặc quy trình mới chưa có spec, hoặc khi khách đổi nghiệp vụ.
argument-hint: "<mô tả yêu cầu | đường dẫn file>"
---

# Tạo spec quy trình nghiệp vụ

Đầu vào: $ARGUMENTS

1. **Thu thập.** Đọc đầu vào (đường dẫn thì đọc file). Đọc `docs/specs/` để dùng lại tên vai trò, thực thể, trạng thái đã có;
   không đặt tên mới cho cùng một khái niệm.
2. **Định phạm vi.** Quy trình gồm nhiều loại chứng từ độc lập (ví dụ tạm ứng, thanh toán, quyết toán) thì đề xuất tách
   thành nhiều spec hoặc giai đoạn, mỗi spec một luồng trạng thái, mục tiêu dưới khoảng 250 dòng. Spec lớn làm mỗi lượt
   code phải đọc lại nhiều, tốn và dễ sót. Hỏi người dùng chọn phần làm trước.
3. **Hỏi trước khi viết.** TỐI ĐA 7 câu, mỗi câu MỘT ý (không gom thành nhóm câu con), xếp theo mức ảnh hưởng thiết kế:
   ai duyệt, hạn mức, ngoại lệ, dữ liệu cũ, tích hợp, báo cáo, dữ liệu cá nhân. Điểm nào có lựa chọn hợp lý mặc định thì
   KHÔNG hỏi riêng: gom vào một danh sách "Giả định (đồng ý cả danh sách hoặc chỉ ra điểm cần đổi)". Người dùng bảo "cứ
   giả định" thì ghi giả định vào mục 11.
4. **Viết spec** đúng khung [spec-template.md](spec-template.md), giữ thứ tự mục, lưu `docs/specs/<NNN>-<ten-quy-trinh>.md`
   (NNN là số kế tiếp). Tham khảo spec đã có trong `docs/specs/` (lõi: 000, 002, 003).
   - Mỗi trạng thái không kết thúc có ít nhất một đường ra; mỗi chuyển trạng thái ghi vai trò được phép và điều kiện.
   - Mỗi quy tắc có mã BR-xx viết được thành test. Tiêu chí nghiệm thu dạng Cho/Khi/Thì, có cả trường hợp bị từ chối quyền.
   - Dùng lại lõi thay vì đặc tả lại: tệp và xuất file (002), thông báo và nhập Excel (003), mã chứng từ theo năm, phân
     quyền theo quyền (vai trò do quản trị viên cấu hình).
5. **Tự kiểm.** Trạng thái mồ côi? Vai trò làm được việc vượt quyền? Ai tự duyệt được việc của mình? Quy tắc mâu thuẫn?
   Đã nêu dữ liệu cá nhân, thời gian lưu (chứng từ kế toán: không xóa tệp), audit chưa? Spec dài quá ~250 dòng thì tách.
6. **Kết thúc.** Trả đường dẫn spec, danh sách giả định và câu hỏi mở. KHÔNG viết code. Dừng chờ người dùng duyệt (đổi
   "Trạng thái spec" thành Đã duyệt).
