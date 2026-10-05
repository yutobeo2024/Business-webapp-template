import type { PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import { BusinessError } from "./business-error.js";

/** Validate input ở biên bằng Zod schema dùng chung trong @app/shared. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BusinessError(
        "VALIDATION_FAILED",
        "Dữ liệu không hợp lệ",
        400,
        result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    return result.data;
  }
}
