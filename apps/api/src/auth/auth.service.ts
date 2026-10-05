import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { sessions, users, type Db } from "@app/db";
import {
  type ChangePasswordInput,
  type CurrentUser,
  type LoginInput,
  passwordContainsEmail,
} from "@app/shared";
import { writeAudit } from "../common/audit.js";
import { BusinessError } from "../common/business-error.js";
import { ENV, type Env } from "../config/env.js";
import { DB } from "../db/db.module.js";
import { loadAccess } from "./access.js";
import { getDummyHash, hashPassword, hashToken, newSessionToken, verifyPassword } from "./crypto.js";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const FAILED_LOGIN_MIN_MS = 200;
/** Gia hạn phiên trượt: chỉ ghi DB khi lần hoạt động trước cách quá mốc này, tránh ghi DB mỗi request. */
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: CurrentUser;
}

export interface ValidatedSession {
  user: CurrentUser;
  tokenHash: string;
  /** Có giá trị khi phiên vừa được gia hạn: guard đặt lại cookie với hạn mới. */
  renewedExpiresAt?: Date;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Hạn của phiên tạo lúc `createdAt`: trượt SESSION_TTL_HOURS kể từ lần hoạt động cuối, nhưng không bao giờ quá
   * SESSION_MAX_DAYS kể từ lúc đăng nhập (token bị đánh cắp không dùng được mãi bằng cách gọi API đều đặn).
   */
  private expiryFor(createdAt: Date, now: Date): Date {
    const sliding = now.getTime() + this.env.SESSION_TTL_HOURS * 3600_000;
    const absolute = createdAt.getTime() + this.env.SESSION_MAX_DAYS * 86_400_000;
    return new Date(Math.min(sliding, absolute));
  }

  /**
   * Đăng nhập. Mọi lần THẤT BẠI mất tối thiểu FAILED_LOGIN_MIN_MS: các nhánh thất bại làm lượng việc khác nhau
   * (email không tồn tại và tài khoản đang khóa không ghi DB, sai mật khẩu thì có), chênh vài mili giây đủ để dò
   * email nào tồn tại. Kéo tất cả về cùng một mốc thì không còn phân biệt được.
   */
  async login(
    input: LoginInput,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResult> {
    const started = Date.now();
    try {
      return await this.attemptLogin(input, meta);
    } catch (err) {
      const remaining = FAILED_LOGIN_MIN_MS - (Date.now() - started);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      throw err;
    }
  }

  private async attemptLogin(
    input: LoginInput,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResult> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1);

    // MỘT thông báo cho mọi trường hợp thất bại (sai email, sai mật khẩu, đang bị khóa): không lộ email nào tồn tại.
    const invalid = new BusinessError(
      "AUTH_INVALID_CREDENTIALS",
      `Email hoặc mật khẩu không đúng. Sai ${MAX_FAILED_LOGINS} lần liên tiếp, tài khoản tạm khóa ${LOCK_MINUTES} phút.`,
      401,
    );
    const isLocked = (lockedUntil: Date | null | undefined) => !!lockedUntil && lockedUntil > new Date();

    if (!user || isLocked(user.lockedUntil)) {
      // Vẫn chấm một mật khẩu giả để thời gian phản hồi giống trường hợp sai mật khẩu.
      await verifyPassword(await getDummyHash(), input.password);
      throw invalid;
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok || !user.isActive) {
      await this.recordFailedLogin(user.id, meta.ip);
      throw invalid;
    }

    const token = newSessionToken();
    const now = new Date();
    const expiresAt = this.expiryFor(now, now);
    await this.db.transaction(async (tx) => {
      // Kiểm lại khóa sau khi khóa dòng: một request sai song song có thể vừa khóa tài khoản trong lúc
      // request này đang chấm mật khẩu. Không kiểm lại thì lần đoán đúng vẫn vào được và còn xóa khóa.
      const [current] = await tx
        .select({ lockedUntil: users.lockedUntil })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (isLocked(current?.lockedUntil)) throw invalid;
      await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
      await tx.insert(sessions).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
        createdAt: now,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      });
      await writeAudit(tx, {
        actorId: user.id,
        action: "auth.login",
        entityType: "user",
        entityId: user.id,
        ip: meta.ip,
      });
    });

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        departmentId: user.departmentId,
        mustChangePassword: user.mustChangePassword,
        ...(await loadAccess(this.db, user.id)),
      },
    };
  }

  /**
   * Đếm lần đăng nhập sai trong transaction có khóa dòng: các request sai song song xếp hàng,
   * không thể cùng đọc một giá trị cũ rồi ghi đè nhau (lách giới hạn 5 lần).
   */
  private async recordFailedLogin(userId: string, ip: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ failed: users.failedLoginCount, lockedUntil: users.lockedUntil })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      // Request song song khác vừa khóa tài khoản: giữ nguyên khóa, không đếm lại từ đầu.
      if (!current || (current.lockedUntil && current.lockedUntil > new Date())) return;
      const failed = current.failed + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await tx
        .update(users)
        .set({
          failedLoginCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        })
        .where(eq(users.id, userId));
      await writeAudit(tx, {
        actorId: userId,
        action: lock ? "auth.locked" : "auth.login_failed",
        entityType: "user",
        entityId: userId,
        ip,
      });
    });
  }

  /** Trả về phiên nếu token hợp lệ, null nếu không. Tự gia hạn phiên trượt trong giới hạn tuyệt đối. */
  async validate(token: string): Promise<ValidatedSession | null> {
    const tokenHash = hashToken(token);
    const now = new Date();
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        lastSeenAt: sessions.lastSeenAt,
        createdAt: sessions.createdAt,
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        departmentId: users.departmentId,
        mustChangePassword: users.mustChangePassword,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now), eq(users.isActive, true)))
      .limit(1);
    if (!row) return null;
    const { sessionId, lastSeenAt, createdAt, ...profile } = row;
    if (this.expiryFor(createdAt, now) <= now) return null; // quá hạn tuyệt đối

    let renewedExpiresAt: Date | undefined;
    if (now.getTime() - lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      renewedExpiresAt = this.expiryFor(createdAt, now);
      await this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: renewedExpiresAt })
        .where(eq(sessions.id, sessionId));
    }
    return { user: { ...profile, ...(await loadAccess(this.db, profile.id)) }, tokenHash, renewedExpiresAt };
  }

  /**
   * Tự đổi mật khẩu (kể cả lần đầu với mật khẩu tạm). Thu hồi mọi phiên KHÁC của người dùng: ai đang giữ phiên cũ
   * (máy bị đánh cắp, mật khẩu cũ bị lộ) bị đăng xuất ngay.
   */
  async changePassword(
    actor: CurrentUser,
    currentTokenHash: string,
    input: ChangePasswordInput,
    ip: string | null,
  ): Promise<void> {
    if (passwordContainsEmail(input.newPassword, actor.email)) {
      throw new BusinessError(
        "AUTH_WEAK_PASSWORD",
        "Mật khẩu không được chứa tên đăng nhập (phần trước @ của email)",
        400,
      );
    }
    const newHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, actor.id))
        .for("update");
      if (!current || !(await verifyPassword(current.passwordHash, input.currentPassword))) {
        throw new BusinessError("AUTH_WRONG_PASSWORD", "Mật khẩu hiện tại không đúng", 400);
      }
      await tx
        .update(users)
        .set({
          passwordHash: newHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          version: sql`${users.version} + 1`,
        })
        .where(eq(users.id, actor.id));
      await tx
        .delete(sessions)
        .where(and(eq(sessions.userId, actor.id), ne(sessions.tokenHash, currentTokenHash)));
      await writeAudit(tx, {
        actorId: actor.id,
        action: "auth.password_changed",
        entityType: "user",
        entityId: actor.id,
        ip,
      });
    });
  }

  async logout(tokenHash: string, actorId: string, ip: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
      await writeAudit(tx, { actorId, action: "auth.logout", entityType: "user", entityId: actorId, ip });
    });
  }
}
