---
paths:
  - "apps/web/**/*.{ts,tsx}"
---

# Frontend

- Gọi API qua hàm `api()` trong `src/lib/api.ts` và TanStack Query; mỗi feature có file `api.ts` riêng chứa hook.
- Form: React Hook Form + `zodResolver(schemaTừShared)`. Theo dõi giá trị bằng `useWatch`, không dùng `form.watch()`.
  Hiện lỗi của MỌI ô, kể cả ô trong mảng (`errors.items?.[i]?.x`) và lỗi cấp mảng (`errors.items?.root`): bấm Lưu mà
  không thấy gì xảy ra là lỗi. Thông báo lỗi viết trong schema ở `packages/shared`, tiếng Việt (ô số: `z.number("Nhập ...")`).
- Hết phiên (401) đã xử lý chung trong `src/lib/query-client.ts`; không tự bắt 401 ở từng trang.
- Hiển thị nút theo `allowedEvents` backend trả về, menu/nút khác theo `can(me, "...")`. Quyền thật do backend quyết định.
- Danh sách: tham số trên URL (route `validateSearch: searchValidator(schemaTừShared)`, đổi bằng `nextSearch`), bảng dùng
  `DataTable` + `SortTh` + `Pagination`, ô tìm `SearchInput`. Mẫu: `features/admin/users-page.tsx`.
- Xác nhận dùng `ConfirmDialog` / form trong `Dialog` (`components/ui/dialog.tsx`), không dùng `window.confirm/prompt`.
- Mọi danh sách có trạng thái đang tải, rỗng, lỗi (kèm nút thử lại). Mọi thao tác ghi khóa nút khi đang gửi.
- Thao tác không hoàn tác được phải xác nhận, nêu rõ hậu quả. Sau lỗi 409 tải lại dữ liệu.
- Tiền `formatVnd`, thời gian `formatDateTime`/`formatDate`, dung lượng `formatBytes` (từ `@app/shared`, dùng chung với
  tệp xuất). Văn bản giao diện tiếng Việt có dấu.
- Tải tệp lên: `uploadFile` (`src/lib/api.ts`); tải về: thẻ `<a href download>` tới endpoint tải. Xuất Excel/PDF:
  `ExportButton` (`features/exports`), kết quả ở trang "Tệp đã xuất". Mẫu: `attachments-dialog.tsx`, nút ở `list-page.tsx`.
- Nhập Excel: `ImportButton` (`features/imports`) với loại nhập và khóa query cần tải lại; mẫu ở trang Phòng ban.
  Thông báo trong app có sẵn (chuông, trang Thông báo, Cài đặt thông báo): module mới không tự làm chuông riêng.
- Component cơ bản trong `src/components/ui`. Thêm component shadcn: `pnpm dlx shadcn@latest add <ten>` (hỏi trước khi thêm thư viện).
