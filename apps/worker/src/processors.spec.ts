import { describe, expect, it } from "vitest";
import { UnrecoverableError } from "bullmq";
import pino from "pino";
import { createProcessor } from "./processors.js";

describe("createProcessor", () => {
  const process = createProcessor({ db: {} as never, log: pino({ level: "silent" }) });

  it("báo lỗi với job không có processor, không bỏ qua im lặng", async () => {
    await expect(process({ name: "job.la", data: {} } as never)).rejects.toThrow(/Không có processor/);
  });

  it("job sai định dạng bị từ chối và không thử lại", async () => {
    const p = process({ id: "x", name: "notification.create", data: { type: 1 } } as never);
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
