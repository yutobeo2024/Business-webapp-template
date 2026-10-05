import { describe, expect, it } from "vitest";
import { DIRECTOR_APPROVAL_THRESHOLD_VND, type Permission } from "@app/shared";
import { allowedEvents, decide, type PrSnapshot } from "./state-machine.js";

const DEPT = "dept-kd";
// Actor mang QUYỀN như vai trò mặc định (apps/api/src/auth/default-roles.ts); state machine không biết tên vai trò.
const actor = (id: string, departmentId: string | null, permissions: Permission[]) => ({
  id,
  departmentId,
  permissions,
});
const staff = actor("u-staff", DEPT, ["pr.create"]);
const manager = actor("u-manager", DEPT, ["pr.create", "pr.view.department", "pr.approve.department"]);
const otherManager = actor("u-manager-2", "dept-kt", [
  "pr.create",
  "pr.view.department",
  "pr.approve.department",
]);
const director = actor("u-director", null, ["pr.view.all", "pr.approve.final"]);
const admin = actor("u-admin", null, ["users.manage", "roles.manage", "departments.manage"]);

const pr = (over: Partial<PrSnapshot> = {}): PrSnapshot => ({
  status: "DRAFT",
  totalAmount: 1_000_000,
  requesterId: staff.id,
  departmentId: DEPT,
  ...over,
});

const expectTo = (d: ReturnType<typeof decide>, to: string) => expect(d).toEqual({ ok: true, to });
const expectErr = (d: ReturnType<typeof decide>, code: string) => {
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.error.code).toBe(code);
};

describe("BR-01 gửi duyệt", () => {
  it("người lập gửi phiếu nháp", () => expectTo(decide(pr(), "SUBMIT", staff), "PENDING_MANAGER"));
  it("người khác không được gửi phiếu nháp", () => expectErr(decide(pr(), "SUBMIT", manager), "FORBIDDEN"));
  it("không gửi được phiếu đã gửi", () =>
    expectErr(decide(pr({ status: "PENDING_MANAGER" }), "SUBMIT", staff), "PR_INVALID_TRANSITION"));
});

describe("pr.create: lập, sửa, gửi, hủy phiếu của mình", () => {
  it("người lập bị thu quyền pr.create không gửi được phiếu nháp cũ", () =>
    expectErr(decide(pr(), "SUBMIT", actor(staff.id, DEPT, [])), "FORBIDDEN"));
  it("người lập bị thu quyền pr.create không hủy được", () =>
    expectErr(decide(pr(), "CANCEL", actor(staff.id, DEPT, [])), "FORBIDDEN"));
});

describe("BR-08 phiếu do trưởng phòng lập", () => {
  const own = pr({ requesterId: manager.id });
  it("gửi duyệt đi thẳng lên giám đốc, không kẹt ở bước trưởng phòng", () =>
    expectTo(decide(own, "SUBMIT", manager), "PENDING_DIRECTOR"));
  it("giám đốc duyệt phiếu của trưởng phòng dù dưới ngưỡng", () =>
    expectTo(decide({ ...own, status: "PENDING_DIRECTOR" }, "DIRECTOR_APPROVE", director), "APPROVED"));
  it("trưởng phòng hủy được phiếu của mình khi đang chờ giám đốc", () =>
    expectTo(decide({ ...own, status: "PENDING_DIRECTOR" }, "CANCEL", manager), "CANCELLED"));
  it("nhân viên không hủy được phiếu đang chờ giám đốc (BR-05)", () =>
    expectErr(decide(pr({ status: "PENDING_DIRECTOR" }), "CANCEL", staff), "PR_INVALID_TRANSITION"));
});

describe("BR-02 trưởng phòng duyệt", () => {
  const pending = pr({ status: "PENDING_MANAGER" });
  it("trưởng phòng cùng phòng ban được duyệt", () =>
    expectTo(decide(pending, "MANAGER_APPROVE", manager), "APPROVED"));
  it("trưởng phòng khác phòng ban bị chặn", () =>
    expectErr(decide(pending, "MANAGER_APPROVE", otherManager), "FORBIDDEN"));
  it("trưởng phòng không tự duyệt phiếu của mình", () =>
    expectErr(
      decide(pr({ status: "PENDING_MANAGER", requesterId: manager.id }), "MANAGER_APPROVE", manager),
      "PR_SELF_APPROVAL",
    ));
  it("nhân viên không duyệt được", () => expectErr(decide(pending, "MANAGER_APPROVE", staff), "FORBIDDEN"));
  it("admin không tham gia duyệt (tách biệt nhiệm vụ)", () =>
    expectErr(decide(pending, "MANAGER_APPROVE", admin), "FORBIDDEN"));
});

describe("BR-03 ngưỡng giám đốc", () => {
  it("đúng bằng ngưỡng: trưởng phòng duyệt là xong", () =>
    expectTo(
      decide(
        pr({ status: "PENDING_MANAGER", totalAmount: DIRECTOR_APPROVAL_THRESHOLD_VND }),
        "MANAGER_APPROVE",
        manager,
      ),
      "APPROVED",
    ));
  it("vượt ngưỡng 1 đồng: chuyển giám đốc", () =>
    expectTo(
      decide(
        pr({ status: "PENDING_MANAGER", totalAmount: DIRECTOR_APPROVAL_THRESHOLD_VND + 1 }),
        "MANAGER_APPROVE",
        manager,
      ),
      "PENDING_DIRECTOR",
    ));
  it("giám đốc duyệt phiếu chờ giám đốc", () =>
    expectTo(decide(pr({ status: "PENDING_DIRECTOR" }), "DIRECTOR_APPROVE", director), "APPROVED"));
  it("trưởng phòng không duyệt thay giám đốc", () =>
    expectErr(decide(pr({ status: "PENDING_DIRECTOR" }), "DIRECTOR_APPROVE", manager), "FORBIDDEN"));
});

describe("BR-04 từ chối và sửa lại", () => {
  it("trưởng phòng từ chối phiếu chờ trưởng phòng", () =>
    expectTo(decide(pr({ status: "PENDING_MANAGER" }), "REJECT", manager), "REJECTED"));
  it("giám đốc từ chối phiếu chờ giám đốc", () =>
    expectTo(decide(pr({ status: "PENDING_DIRECTOR" }), "REJECT", director), "REJECTED"));
  it("người lập sửa lại phiếu bị từ chối về nháp", () =>
    expectTo(decide(pr({ status: "REJECTED" }), "REVISE", staff), "DRAFT"));
});

describe("BR-05 hủy phiếu", () => {
  it("người lập hủy phiếu nháp", () => expectTo(decide(pr(), "CANCEL", staff), "CANCELLED"));
  it("người lập hủy phiếu đang chờ trưởng phòng", () =>
    expectTo(decide(pr({ status: "PENDING_MANAGER" }), "CANCEL", staff), "CANCELLED"));
  it("không hủy được phiếu đã duyệt", () =>
    expectErr(decide(pr({ status: "APPROVED" }), "CANCEL", staff), "PR_INVALID_TRANSITION"));
  it("trạng thái kết thúc không có thao tác nào", () => {
    expect(allowedEvents(pr({ status: "APPROVED" }), staff)).toEqual([]);
    expect(allowedEvents(pr({ status: "CANCELLED" }), staff)).toEqual([]);
  });
});

describe("allowedEvents", () => {
  it("trưởng phòng thấy nút duyệt và từ chối", () =>
    expect(allowedEvents(pr({ status: "PENDING_MANAGER" }), manager)).toEqual(["MANAGER_APPROVE", "REJECT"]));
  it("người lập thấy gửi và hủy ở trạng thái nháp", () =>
    expect(allowedEvents(pr(), staff)).toEqual(["SUBMIT", "CANCEL"]));
});
