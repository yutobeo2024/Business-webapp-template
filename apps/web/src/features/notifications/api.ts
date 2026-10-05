import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ListNotificationsQuery,
  NotificationDto,
  NotificationSettingDto,
  Paginated,
  UpdateNotificationSettingsInput,
} from "@app/shared";
import { api } from "@/lib/api";

const key = ["notifications"] as const;

/** Số thông báo chưa đọc cho chuông; tải lại mỗi 60 giây và khi quay lại tab. */
export function useUnreadCount() {
  return useQuery({
    queryKey: [...key, "unread-count"],
    queryFn: () => api<{ count: number }>("/notifications/unread-count"),
    refetchInterval: 60_000,
  });
}

export function useNotifications(params: ListNotificationsQuery) {
  return useQuery({
    queryKey: [...key, "list", params],
    queryFn: () =>
      api<Paginated<NotificationDto>>(
        `/notifications?page=${params.page}&pageSize=${params.pageSize}${params.unread ? "&unread=true" : ""}`,
      ),
    placeholderData: (prev) => prev,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<NotificationDto>(`/notifications/${id}/read`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ updated: number }>("/notifications/read-all", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

const settingsKey = ["account", "notification-settings"] as const;

export function useNotificationSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => api<NotificationSettingDto[]>("/account/notification-settings"),
  });
}

export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateNotificationSettingsInput) =>
      api<NotificationSettingDto[]>("/account/notification-settings", { method: "PUT", body }),
    onSuccess: (data) => qc.setQueryData(settingsKey, data),
  });
}
