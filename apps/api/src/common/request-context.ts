import { isIP } from "node:net";
import type { Request } from "express";
import type { CurrentUser } from "@app/shared";

export interface AuthedRequest extends Request {
  user?: CurrentUser;
  sessionTokenHash?: string;
}

/** IP client để ghi audit (cột inet). Giá trị không phải IP (X-Forwarded-For giả) trả null thay vì làm lỗi insert. */
export function clientIp(req: Request): string | null {
  return req.ip && isIP(req.ip) ? req.ip : null;
}
