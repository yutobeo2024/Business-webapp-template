import type { ApiErrorBody } from "@app/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Gọi API cùng origin. Cookie phiên httpOnly được trình duyệt tự gửi. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return parse<T>(
    await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

/** Tải một tệp lên (multipart, trường "file"). Trình duyệt tự đặt Content-Type kèm boundary. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return parse<T>(await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", body: form }));
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      res.status,
      err.code ?? `HTTP_${res.status}`,
      err.message ?? "Có lỗi xảy ra",
      err.details,
    );
  }
  return data as T;
}

/** Câu báo lỗi cho người dùng từ lỗi của mutation/query; null nếu không có lỗi. */
export function apiErrorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof ApiError ? error.message : "Không kết nối được máy chủ";
}
