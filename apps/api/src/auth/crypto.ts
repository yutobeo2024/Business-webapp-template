import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// argon2id với tham số mặc định của @node-rs/argon2 (m=19456 KiB, t=2, p=1) theo khuyến nghị OWASP.
export const hashPassword = (password: string): Promise<string> => hash(password);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Hash thật của một mật khẩu ngẫu nhiên, dùng khi email không tồn tại để thời gian phản hồi đồng đều (chống dò email). */
export const getDummyHash = (): Promise<string> => (dummyHash ??= hash(randomBytes(16).toString("hex")));

export const newSessionToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
