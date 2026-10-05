import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePurchaseRequestInput,
  FileDto,
  ListPurchaseRequestsQuery,
  Paginated,
  PurchaseRequestDto,
  TransitionPurchaseRequestInput,
} from "@app/shared";
import { api, uploadFile } from "@/lib/api";
import { toQueryString } from "@/lib/query-string";

const key = ["purchase-requests"] as const;

export function usePurchaseRequests(params: ListPurchaseRequestsQuery) {
  return useQuery({
    queryKey: [...key, params],
    queryFn: () => api<Paginated<PurchaseRequestDto>>(`/purchase-requests?${toQueryString(params)}`),
    // Giữ trang cũ trên màn hình trong lúc tải trang mới (bảng không nhảy về "Đang tải..." mỗi lần gõ/lật trang).
    placeholderData: (prev) => prev,
  });
}

export function useCreatePurchaseRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePurchaseRequestInput) =>
      api<PurchaseRequestDto>("/purchase-requests", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: TransitionPurchaseRequestInput & { id: string }) =>
      api<PurchaseRequestDto>(`/purchase-requests/${id}/transitions`, { method: "POST", body }),
    // Luôn tải lại, kể cả khi lỗi 409 (dữ liệu đã đổi) để người dùng thấy trạng thái mới nhất.
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

// ---------- Đính kèm (BR-09) ----------

const attachmentsKey = (prId: string) => [...key, prId, "attachments"] as const;

export function useAttachments(prId: string, enabled: boolean) {
  return useQuery({
    queryKey: attachmentsKey(prId),
    queryFn: () => api<FileDto[]>(`/purchase-requests/${prId}/attachments`),
    enabled,
  });
}

export function useUploadAttachment(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadFile<FileDto>(`/purchase-requests/${prId}/attachments`, file),
    onSettled: () => qc.invalidateQueries({ queryKey: attachmentsKey(prId) }),
  });
}

export function useRemoveAttachment(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) =>
      api<void>(`/purchase-requests/${prId}/attachments/${fileId}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: attachmentsKey(prId) }),
  });
}

/** Liên kết tải về (GET cùng origin, cookie tự gửi; server trả Content-Disposition: attachment). */
export const attachmentDownloadUrl = (prId: string, fileId: string) =>
  `/api/purchase-requests/${prId}/attachments/${fileId}/download`;
