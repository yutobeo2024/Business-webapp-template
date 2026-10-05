import { Link } from "@tanstack/react-router";
import type { CreateExportInput } from "@app/shared";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api";
import { useRequestExport } from "./api";

/**
 * Nút yêu cầu xuất file (chạy nền). Xong thì báo và dẫn tới trang "Tệp đã xuất". Ẩn/hiện theo quyền là việc của nơi dùng;
 * quyền thật do backend kiểm. Mẫu: nút "Xuất Excel" ở trang quản trị người dùng (`features/admin/users-page.tsx`).
 */
export function ExportButton({
  input,
  label,
  variant = "outline",
}: {
  input: CreateExportInput;
  label: string;
  variant?: "default" | "outline";
}) {
  const request = useRequestExport();
  const error = apiErrorMessage(request.error);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant={variant} disabled={request.isPending} onClick={() => request.mutate(input)}>
        {request.isPending ? "Đang gửi..." : label}
      </Button>
      {request.isSuccess ? (
        <span role="status" className="text-sm text-neutral-600">
          Đang tạo tệp.{" "}
          <Link to="/exports" className="text-blue-700 underline">
            Xem ở Tệp đã xuất
          </Link>
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-sm text-red-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}
