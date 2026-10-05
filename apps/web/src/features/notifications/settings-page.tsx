import { Link } from "@tanstack/react-router";
import {
  NOTIFICATION_CHANNEL_LABELS,
  type NotificationChannel,
  type UpdateNotificationSettingsInput,
} from "@app/shared";
import { Checkbox } from "@/components/ui/form-controls";
import { apiErrorMessage } from "@/lib/api";
import { useNotificationSettings, useUpdateNotificationSettings } from "./api";

/** Người dùng bật/tắt từng kênh ngoài (spec 003). Thông báo trong app luôn bật. */
export function NotificationSettingsPage() {
  const q = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  const error = apiErrorMessage(q.error) ?? apiErrorMessage(update.error);

  const toggle = (channel: NotificationChannel, enabled: boolean) => {
    if (!q.data) return;
    const next = Object.fromEntries(
      q.data.map((s) => [s.channel, s.enabled]),
    ) as UpdateNotificationSettingsInput;
    update.mutate({ ...next, [channel]: enabled });
  };

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Cài đặt thông báo</h1>
        <p className="text-sm text-neutral-600">
          Thông báo luôn hiện ở{" "}
          <Link to="/notifications" className="underline">
            chuông trên thanh menu
          </Link>
          . Chọn thêm kênh muốn nhận:
        </p>
      </div>
      {q.isPending ? <p className="text-sm text-neutral-500">Đang tải...</p> : null}
      <div className="space-y-3 rounded border bg-white p-4">
        {q.data?.map((s) => (
          <div key={s.channel}>
            <Checkbox
              label={NOTIFICATION_CHANNEL_LABELS[s.channel]}
              checked={s.enabled && s.available}
              disabled={!s.available || update.isPending}
              onChange={(e) => toggle(s.channel, e.target.checked)}
            />
            {s.unavailableReason ? (
              <p className="ml-6 text-xs text-neutral-500">{s.unavailableReason}</p>
            ) : null}
          </div>
        ))}
      </div>
      {update.isSuccess ? (
        <p role="status" className="text-sm text-green-700">
          Đã lưu.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
