/**
 * Lỗi nghiệp vụ. `code` dạng MODULE_REASON (máy đọc), `message` tiếng Việt (người dùng đọc).
 * Dùng thay cho throw Error chung chung trong service.
 */
export class BusinessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 422,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "BusinessError";
  }
}

export const Errors = {
  notFound: (entity: string) => new BusinessError(`${entity}_NOT_FOUND`, "Không tìm thấy dữ liệu", 404),
  forbidden: (message = "Bạn không có quyền thực hiện thao tác này") =>
    new BusinessError("FORBIDDEN", message, 403),
  versionConflict: () =>
    new BusinessError(
      "VERSION_CONFLICT",
      "Dữ liệu đã được người khác thay đổi. Vui lòng tải lại trang và thử lại.",
      409,
    ),
  unauthenticated: () => new BusinessError("UNAUTHENTICATED", "Phiên đăng nhập đã hết hạn", 401),
};
