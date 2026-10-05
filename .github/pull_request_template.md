## Thay đổi gì

<!-- Mô tả ngắn. Liên kết spec: docs/specs/NNN-xxx.md -->

## Tiêu chí nghiệm thu đáp ứng

- [ ] AC-

## Database

- [ ] Không đổi schema
- [ ] Có migration an toàn (thêm bảng/cột nullable/index)
- [ ] Có migration expand/contract (ghi rõ kế hoạch bước contract ở release sau)

## Kiểm tra

- [ ] `pnpm verify:quick` xanh
- [ ] Đã chạy subagent `code-reviewer`, sửa hết mục CHẶN MERGE
- [ ] Đụng auth, phân quyền, upload, xuất dữ liệu: đã chạy `/security-audit`

## Cách kiểm tra thủ công

<!-- Các bước cụ thể để reviewer tự kiểm -->
