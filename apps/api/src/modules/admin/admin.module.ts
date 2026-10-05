import { Module } from "@nestjs/common";
import { DepartmentsController } from "./departments.controller.js";
import { DepartmentsService } from "./departments.service.js";
import { RolesController } from "./roles.controller.js";
import { RolesService } from "./roles.service.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

/**
 * Lõi quản trị: người dùng, vai trò (tập quyền), phòng ban. Giữ trong mọi dự án (không phải module mẫu).
 * Spec: docs/specs/000-quan-tri-nguoi-dung.md. Chốt chặn: safeguards.ts.
 */
@Module({
  controllers: [UsersController, RolesController, DepartmentsController],
  providers: [UsersService, RolesService, DepartmentsService],
})
export class AdminModule {}
