import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, sql } from "drizzle-orm";
import { departments, users, type Db } from "@app/db";
import {
  type CreateDepartmentInput,
  type CurrentUser as CurrentUserType,
  type DepartmentDto,
  type ListDepartmentsQuery,
  type Paginated,
  type UpdateDepartmentInput,
} from "@app/shared";
import { writeAudit } from "../../common/audit.js";
import { BusinessError, Errors } from "../../common/business-error.js";
import { isUniqueViolation } from "../../common/db-errors.js";
import { orderBy, pageOffset, paginated, searchCondition } from "@app/server";
import { DB } from "../../db/db.module.js";

const ENTITY = "department";
// Ghi rõ bảng cho từng cột: trong truy vấn con, cột "id" không kèm tên bảng sẽ bị hiểu là users.id.
const userCount = sql<number>`(select count(*)::int from ${users} where ${users}.${sql.identifier("department_id")} = ${departments}.${sql.identifier("id")})`;
const SORTABLE = {
  code: departments.code,
  name: departments.name,
  createdAt: departments.createdAt,
} satisfies Record<ListDepartmentsQuery["sort"], unknown>;

@Injectable()
export class DepartmentsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(q: ListDepartmentsQuery): Promise<Paginated<DepartmentDto>> {
    const where = and(
      searchCondition(q.q, [departments.code, departments.name]),
      q.status ? eq(departments.isActive, q.status === "active") : undefined,
    );
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: departments.id,
          code: departments.code,
          name: departments.name,
          isActive: departments.isActive,
          version: departments.version,
          userCount,
        })
        .from(departments)
        .where(where)
        .orderBy(...orderBy(q.sort, q.order, SORTABLE, departments.id))
        .limit(q.pageSize)
        .offset(pageOffset(q)),
      this.db.select({ total: count() }).from(departments).where(where),
    ]);
    return paginated(rows, totals[0]?.total ?? 0, q);
  }

  async create(
    actor: CurrentUserType,
    input: CreateDepartmentInput,
    ip: string | null,
  ): Promise<DepartmentDto> {
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx.insert(departments).values(input).returning();
        await writeAudit(tx, {
          actorId: actor.id,
          action: "department.create",
          entityType: ENTITY,
          entityId: created!.id,
          after: created,
          ip,
        });
        return { ...pick(created!), userCount: 0 };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BusinessError("DEPARTMENT_CODE_TAKEN", `Mã phòng ban ${input.code} đã tồn tại`, 409);
      }
      throw err;
    }
  }

  async update(
    actor: CurrentUserType,
    id: string,
    input: UpdateDepartmentInput,
    ip: string | null,
  ): Promise<DepartmentDto> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(departments).where(eq(departments.id, id)).for("update");
      if (!current) throw Errors.notFound("DEPARTMENT");
      if (current.version !== input.version) throw Errors.versionConflict();
      const [updated] = await tx
        .update(departments)
        .set({ name: input.name, isActive: input.isActive, version: current.version + 1 })
        .where(eq(departments.id, id))
        .returning();
      await writeAudit(tx, {
        actorId: actor.id,
        action: "department.update",
        entityType: ENTITY,
        entityId: id,
        before: current,
        after: updated,
        ip,
      });
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(users)
        .where(eq(users.departmentId, id));
      return { ...pick(updated!), userCount: n };
    });
  }
}

const pick = (d: typeof departments.$inferSelect) => ({
  id: d.id,
  code: d.code,
  name: d.name,
  isActive: d.isActive,
  version: d.version,
});
