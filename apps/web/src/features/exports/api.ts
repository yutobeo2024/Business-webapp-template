import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateExportInput, ExportJobDto } from "@app/shared";
import { api } from "@/lib/api";

const key = ["exports"] as const;

/** Danh sách lần xuất của tôi; tự tải lại mỗi 2 giây khi còn lần đang chờ/đang tạo. */
export function useMyExports() {
  return useQuery({
    queryKey: key,
    queryFn: () => api<ExportJobDto[]>("/exports"),
    refetchInterval: (q) =>
      q.state.data?.some((e) => e.status === "QUEUED" || e.status === "RUNNING") ? 2000 : false,
  });
}

export function useRequestExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExportInput) => api<ExportJobDto>("/exports", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export const exportDownloadUrl = (id: string) => `/api/exports/${id}/download`;
