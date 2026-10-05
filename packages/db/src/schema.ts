import { sql } from "drizzle-orm";
import {
  bigint, // sample
  bigserial,
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DELIVERY_STATUSES,
  EXPORT_STATUSES,
  IMPORT_STATUSES,
  type ImportRowError,
  NOTIFICATION_CHANNELS,
  PR_STATUSES, // sample
  type PrItem, // sample
} from "@app/shared";

// Quy ước: bảng snake_case số nhiều; mọi bảng nghiệp vụ có created_at, updated_at; xóa mềm bằng deleted_at.
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const prStatusEnum = pgEnum("pr_status", PR_STATUSES); // sample
export const exportStatusEnum = pgEnum("export_status", EXPORT_STATUSES);
export const notificationChannelEnum = pgEnum("notification_channel", NOTIFICATION_CHANNELS);
export const deliveryStatusEnum = pgEnum("delivery_status", DELIVERY_STATUSES);
export const importStatusEnum = pgEnum("import_status", IMPORT_STATUSES);

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  /** Ngừng dùng thay vì xóa: người dùng và chứng từ cũ vẫn trỏ tới. Không gán người mới vào phòng ban ngừng dùng. */
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Đang dùng mật khẩu tạm do quản trị viên đặt: phải đổi trước khi làm việc khác. */
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    departmentId: uuid("department_id").references(() => departments.id),
    /** Số di động dạng 84xxxxxxxxx (vnPhoneSchema). Dữ liệu cá nhân: chỉ để gửi thông báo Zalo (spec 003). */
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    index("users_department_idx").on(t.departmentId),
  ],
);

/**
 * Vai trò = tập quyền do quản trị viên cấu hình (ADR-0004). Quyền là chuỗi khóa trong danh mục PERMISSIONS
 * (packages/shared/src/permissions.ts); quyền không còn trong danh mục bị bỏ qua khi nạp.
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Vai trò "Quản trị hệ thống": không xóa, không đổi tên, luôn giữ quyền quản trị người dùng và vai trò. */
    isSystem: boolean("is_system").notNull().default(false),
    /** Khóa trong DEFAULT_ROLES nếu vai trò do seed tạo (nhận diện khi đồng bộ, không theo tên vì quản trị đổi được). */
    defaultKey: text("default_key"),
    /**
     * Quyền mặc định đã từng cấp qua seed/đồng bộ. `--sync-default-roles` chỉ thêm quyền mặc định CHƯA có trong danh
     * sách này, nên quyền quản trị viên đã gỡ không bị cấp lại.
     */
    syncedDefaultPermissions: jsonb("synced_default_permissions").$type<string[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("roles_name_lower_uq").on(sql`lower(${t.name})`),
    uniqueIndex("roles_default_key_uq").on(t.defaultKey),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** restrict: không xóa vai trò còn người dùng (service báo lỗi rõ trước khi tới đây). */
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index("user_roles_role_idx").on(t.roleId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 của token. Token gốc chỉ nằm trong cookie của người dùng, không lưu DB. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

/** Bộ đếm mã chứng từ theo (tiền tố, năm): nextDocumentCode trong packages/server/src/document-codes.ts. */
export const documentCounters = pgTable(
  "document_counters",
  {
    prefix: text("prefix").notNull(),
    year: integer("year").notNull(),
    last: integer("last").notNull(),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.year] })],
);

// sample:begin (bảng của module mẫu; `pnpm sample:remove` xóa khối này và sinh migration drop)
export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    status: prStatusEnum("status").notNull().default("DRAFT"),
    /** VND, số nguyên. mode "number" an toàn tới 2^53; giới hạn MAX_VND và isValidVnd ở biên (@app/shared/money). */
    totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
    items: jsonb("items").$type<PrItem[]>().notNull(),
    note: text("note"),
    rejectReason: text("reject_reason"),
    /** Optimistic lock (BR-06). Tăng 1 mỗi lần ghi. */
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("purchase_requests_department_idx").on(t.departmentId),
    index("purchase_requests_requester_idx").on(t.requesterId),
    index("purchase_requests_status_idx").on(t.status),
    index("purchase_requests_created_idx").on(t.createdAt),
  ],
);
// sample:end

/**
 * Tệp đính kèm và tệp xuất (spec 002). Nội dung nằm trong storage theo `storage_key` (do hệ thống sinh, không chứa tên gốc).
 * Gắn với bản ghi nghiệp vụ qua (entity_type, entity_id); quyền xem tệp = quyền xem bản ghi đó, do module kiểm.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageKey: text("storage_key").notNull().unique(),
    /** Tên hiển thị đã làm sạch; chỉ dùng khi tải về, không bao giờ làm đường dẫn. */
    originalName: text("original_name").notNull(),
    /** Loại xác định theo NỘI DUNG tệp lúc tải lên. */
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Xóa mềm; job dọn dẹp xóa tệp vật lý sau 7 ngày. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("files_entity_idx").on(t.entityType, t.entityId), index("files_deleted_idx").on(t.deletedAt)],
);

/** Yêu cầu xuất file chạy nền (spec 002). Chỉ người yêu cầu xem/tải được; tệp hết hạn sau EXPORT_TTL_HOURS. */
export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Khóa trong EXPORT_TYPES (packages/shared/src/exports.ts). */
    type: text("type").notNull(),
    /** Tham số đã validate bằng createExportSchema lúc yêu cầu; worker validate lại trước khi chạy. */
    params: jsonb("params").notNull(),
    status: exportStatusEnum("status").notNull().default("QUEUED"),
    rowCount: integer("row_count"),
    /** Câu báo lỗi cho người dùng (không chứa chi tiết nội bộ; chi tiết nằm trong log worker). */
    error: text("error"),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    index("export_jobs_requester_idx").on(t.requestedBy, t.createdAt),
    index("export_jobs_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Thông báo trong app (spec 003). `dedupe_key` + người nhận là duy nhất: job tạo thông báo chạy lại không tạo bản thứ hai.
 * Chỉ người nhận đọc được thông báo của mình.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Khóa trong NOTIFICATION_TYPES (packages/shared/src/notifications.ts). */
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    /** Dữ liệu gốc đã validate theo NOTIFICATION_DATA_SCHEMAS: kênh ngoài (mẫu Zalo) dựng nội dung từ đây. */
    data: jsonb("data").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notifications_user_dedupe_uq").on(t.userId, t.dedupeKey),
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

/**
 * Giao một thông báo qua một kênh ngoài (email, Zalo). (notification_id, channel) duy nhất: không bao giờ gửi hai lần
 * vì tạo trùng; job gửi "giành" hàng bằng cách đổi PENDING -> SENDING trước khi gửi.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    status: deliveryStatusEnum("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    /** Lý do bỏ qua hoặc lỗi cuối (không chứa nội dung thông báo, không chứa token). */
    error: text("error"),
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notification_deliveries_uq").on(t.notificationId, t.channel),
    index("notification_deliveries_status_idx").on(t.status, t.updatedAt),
  ],
);

/** Người dùng tắt/bật từng kênh ngoài. Không có hàng = bật. */
export const userNotificationSettings = pgTable(
  "user_notification_settings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    enabled: boolean("enabled").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channel] })],
);

/**
 * Token của dịch vụ ngoài (Zalo OA...), MÃ HÓA bằng APP_ENCRYPTION_KEY (packages/server/src/secrets.ts). Làm mới token
 * trong transaction khóa dòng: refresh token Zalo chỉ dùng được một lần, hai tiến trình làm mới cùng lúc sẽ mất token.
 */
export const integrationTokens = pgTable("integration_tokens", {
  provider: text("provider").primaryKey(),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Một lần nhập Excel (spec 003). Chỉ người tải lên xem và xác nhận được. */
export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Khóa trong IMPORT_TYPES (packages/shared/src/imports.ts). */
    type: text("type").notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    status: importStatusEnum("status").notNull().default("VALIDATING"),
    totalRows: integer("total_rows"),
    importedCount: integer("imported_count"),
    errorCount: integer("error_count").notNull().default(0),
    /** ImportRowError[], tối đa IMPORT_MAX_ERRORS mục. */
    errors: jsonb("errors").$type<ImportRowError[]>().notNull().default([]),
    preview: jsonb("preview").$type<Record<string, string>[]>().notNull().default([]),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("import_jobs_requester_idx").on(t.requestedBy, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);
