/**
 * Tích hợp kênh Zalo ZNS với máy chủ Zalo GIẢ (DB thật): làm mới token đúng một lần, token lưu mã hóa, phân loại lỗi.
 * Không gọi Zalo thật; khi bật cho khách phải thử với OA thật theo runbook notifications.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, integrationTokens, type DbHandle } from "@app/db";
import { PermanentDeliveryError } from "./channel.js";
import { type ZaloConfig, ZaloAuthError, ZaloZnsSender, ZALO_PROVIDER } from "./zalo.js";

let handle: DbHandle;
let server: Server;
let base: string;
const key = randomBytes(32);

interface Call {
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}
let calls: Call[] = [];
let oauthReply: () => object = () => ({});
let znsReplies: object[] = [];
let tokenCounter = 0;

beforeAll(async () => {
  handle = createDb(process.env.DATABASE_URL!, { max: 10, appName: "worker-test" });
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      calls.push({ path: req.url ?? "", headers: req.headers, body });
      // Trả chậm một chút để các job song song thật sự chồng lên nhau.
      setTimeout(() => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(req.url === "/oauth" ? oauthReply() : (znsReplies.shift() ?? { error: 0 })));
      }, 50);
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  await handle.close();
});
beforeEach(async () => {
  await handle.db.delete(integrationTokens);
  calls = [];
  znsReplies = [];
  tokenCounter = 0;
  oauthReply = () => {
    tokenCounter++;
    return {
      access_token: `access-${tokenCounter}`,
      refresh_token: `refresh-${tokenCounter}`,
      expires_in: "90000",
    };
  };
});

const cfg = (): ZaloConfig => ({
  appId: "app-1",
  secretKey: "secret-1",
  templates: { "account.password_reset": "312345" },
  oauthUrl: `${base}/oauth`,
  znsUrl: `${base}/zns`,
  encryptionKey: key,
});
const sender = () => new ZaloZnsSender(handle.db, cfg());
const to = { fullName: "Trưởng phòng", email: "tp@test.vn", phone: "84912345678" };
const msg = {
  type: "account.password_reset" as const,
  title: "t",
  body: "b",
  link: null,
  trackingId: "delivery-1",
  data: { resetByName: "Quản trị" },
};
const oauthCalls = () => calls.filter((c) => c.path === "/oauth");
const znsCalls = () => calls.filter((c) => c.path === "/zns");

describe("Zalo ZNS", () => {
  it("chưa nạp token: lỗi vĩnh viễn, không gọi Zalo", async () => {
    await expect(sender().send(to, msg)).rejects.toBeInstanceOf(ZaloAuthError);
    expect(calls).toHaveLength(0);
  });

  it("làm mới token rồi gửi đúng mẫu, tham số, tracking_id; token mới lưu MÃ HÓA, refresh token được thay", async () => {
    await ZaloZnsSender.storeRefreshToken(handle.db, "refresh-ban-dau", key);
    znsReplies = [{ error: 0, data: { msg_id: "zalo-msg-1" } }];
    expect(await sender().send(to, msg)).toEqual({ providerMessageId: "zalo-msg-1" });

    const [oauth] = oauthCalls();
    expect(oauth!.headers["secret_key"]).toBe("secret-1");
    expect(Object.fromEntries(new URLSearchParams(oauth!.body))).toEqual({
      app_id: "app-1",
      grant_type: "refresh_token",
      refresh_token: "refresh-ban-dau",
    });
    const [zns] = znsCalls();
    expect(zns!.headers["access_token"]).toBe("access-1");
    expect(JSON.parse(zns!.body)).toEqual({
      phone: "84912345678",
      template_id: "312345",
      template_data: { nguoi_dat_lai: "Quản trị" },
      tracking_id: "delivery-1",
    });

    const [row] = await handle.db
      .select()
      .from(integrationTokens)
      .where(eq(integrationTokens.provider, ZALO_PROVIDER));
    expect(JSON.stringify(row)).not.toMatch(/access-1|refresh-1|refresh-ban-dau/);

    // Lần sau dùng lại access token còn hạn, không làm mới.
    await sender().send(to, msg);
    expect(oauthCalls()).toHaveLength(1);
  });

  it("nhiều job song song khi token hết hạn: chỉ làm mới MỘT lần (refresh token dùng một lần)", async () => {
    await ZaloZnsSender.storeRefreshToken(handle.db, "refresh-ban-dau", key);
    await Promise.all(Array.from({ length: 6 }, () => sender().send(to, msg)));
    expect(oauthCalls()).toHaveLength(1);
    expect(znsCalls()).toHaveLength(6);
    expect(new Set(znsCalls().map((c) => c.headers["access_token"]))).toEqual(new Set(["access-1"]));
  });

  it("Zalo từ chối access token (-124): làm mới bắt buộc rồi gửi lại đúng một lần", async () => {
    await ZaloZnsSender.storeRefreshToken(handle.db, "refresh-ban-dau", key);
    await sender().accessToken();
    znsReplies = [
      { error: -124, message: "Access token is invalid" },
      { error: 0, data: { msg_id: "m2" } },
    ];
    expect(await sender().send(to, msg)).toEqual({ providerMessageId: "m2" });
    expect(oauthCalls()).toHaveLength(2);
    expect(znsCalls().map((c) => c.headers["access_token"])).toEqual(["access-1", "access-2"]);
  });

  it("phân loại lỗi: số không dùng được thì vĩnh viễn, vượt hạn mức thì thử lại; thiếu mẫu, thiếu SĐT: vĩnh viễn", async () => {
    await ZaloZnsSender.storeRefreshToken(handle.db, "refresh-ban-dau", key);
    znsReplies = [{ error: -108, message: "Phone number is invalid" }];
    await expect(sender().send(to, msg)).rejects.toBeInstanceOf(PermanentDeliveryError);
    znsReplies = [{ error: -32, message: "Rate limit" }];
    const transient = await sender()
      .send(to, msg)
      .catch((e: unknown) => e);
    expect(transient).toBeInstanceOf(Error);
    expect(transient).not.toBeInstanceOf(PermanentDeliveryError);
    await expect(sender().send(to, { ...msg, type: "import.finished" as never })).rejects.toThrow(
      /Chưa cấu hình mẫu ZNS/,
    );
    await expect(sender().send({ ...to, phone: null }, msg)).rejects.toBeInstanceOf(PermanentDeliveryError);
  });

  it("refresh token bị Zalo từ chối: lỗi xác thực vĩnh viễn, nhắc nạp lại token", async () => {
    await ZaloZnsSender.storeRefreshToken(handle.db, "refresh-het-han", key);
    oauthReply = () => ({ error: -14014, error_name: "Invalid refresh token" });
    await expect(sender().send(to, msg)).rejects.toThrow(/zalo-token/);
    expect(znsCalls()).toHaveLength(0);
  });
});
