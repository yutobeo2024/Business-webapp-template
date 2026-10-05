import { useMutation, useQuery } from "@tanstack/react-query";
import type { ImportJobDto, ImportType } from "@app/shared";
import { api, uploadFile } from "@/lib/api";

const RUNNING = new Set(["VALIDATING", "COMMITTING"]);

/** Một lần nhập; tự tải lại mỗi giây khi worker đang kiểm hoặc đang ghi. */
export function useImportJob(id: string | null) {
  return useQuery({
    queryKey: ["imports", id],
    queryFn: () => api<ImportJobDto>(`/imports/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && RUNNING.has(q.state.data.status) ? 1000 : false),
  });
}

export function useUploadImport(type: ImportType) {
  return useMutation({
    mutationFn: (file: File) => uploadFile<ImportJobDto>(`/imports/types/${type}`, file),
  });
}

export function useCommitImport() {
  return useMutation({
    mutationFn: (id: string) => api<ImportJobDto>(`/imports/${id}/commit`, { method: "POST" }),
  });
}

export const importTemplateUrl = (type: ImportType) => `/api/imports/types/${type}/template`;
