import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { meQueryKey } from "@/features/auth/use-me";
import { ApiError } from "./api";

/**
 * QueryClient của app. Bất kỳ lời gọi API nào nhận 401 (phiên hết hạn giữa chừng) đều xóa người dùng hiện tại,
 * AppShell thấy `me = null` và hiện trang đăng nhập. Thiếu chỗ này người dùng kẹt ở màn hình "Không tải được".
 */
export function createQueryClient(): QueryClient {
  const onError = (err: unknown) => {
    if (!(err instanceof ApiError) || err.status !== 401) return;
    client.setQueryData(meQueryKey, null);
    // Dữ liệu đã tải thuộc về người vừa hết phiên: xóa để người đăng nhập sau trên cùng máy không thấy.
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        // Không retry lỗi 4xx (sai quyền, không tồn tại); chỉ retry lỗi mạng/5xx.
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}
