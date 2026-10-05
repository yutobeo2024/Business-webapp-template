import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiErrorBody } from "@app/shared";
import { BusinessError } from "./business-error.js";

const GENERIC_MESSAGES: Record<number, string> = {
  400: "Yêu cầu không hợp lệ",
  401: "Vui lòng đăng nhập",
  403: "Bạn không có quyền thực hiện thao tác này",
  404: "Không tìm thấy",
  409: "Xung đột dữ liệu",
  413: "Dữ liệu gửi lên quá lớn",
  429: "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút",
};

/** Lỗi 4xx từ middleware Express (body quá lớn, sai charset...): thư viện http-errors, có status và expose=true. */
function isClientHttpError(e: unknown): e is { status: number } {
  if (typeof e !== "object" || e === null) return false;
  const { status, expose } = e as { status?: unknown; expose?: unknown };
  return expose === true && typeof status === "number" && status >= 400 && status < 500;
}

/** Mọi lỗi trả về cùng một định dạng. Không bao giờ lộ stack trace hay SQL ra client. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: unknown }>();

    let status = 500;
    let body: ApiErrorBody = { code: "INTERNAL_ERROR", message: "Hệ thống gặp sự cố, vui lòng thử lại sau" };

    if (exception instanceof BusinessError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        code: `HTTP_${status}`,
        message: GENERIC_MESSAGES[status] ?? "Yêu cầu không thực hiện được",
      };
    } else if (isClientHttpError(exception)) {
      status = exception.status;
      body = {
        code: `HTTP_${status}`,
        message: GENERIC_MESSAGES[status] ?? "Yêu cầu không thực hiện được",
      };
    }

    if (status >= 500) {
      this.logger.error({ err: exception, reqId: req.id, path: req.url }, "Unhandled error");
    }
    res.status(status).json(body);
  }
}
