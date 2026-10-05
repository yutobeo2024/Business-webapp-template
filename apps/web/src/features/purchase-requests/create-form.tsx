import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import {
  calcTotal,
  type CreatePurchaseRequestInput,
  createPurchaseRequestSchema,
  formatVnd,
} from "@app/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { useCreatePurchaseRequest } from "./api";

const empty: CreatePurchaseRequestInput = {
  title: "",
  items: [{ name: "", quantity: 1, unitPrice: 0 }],
  note: "",
};

export function CreatePurchaseRequestForm({ onDone }: { onDone: () => void }) {
  const form = useForm<CreatePurchaseRequestInput>({
    resolver: zodResolver(createPurchaseRequestSchema),
    defaultValues: empty,
  });
  const items = useFieldArray({ control: form.control, name: "items" });
  const create = useCreatePurchaseRequest();
  const watchedItems = useWatch({ control: form.control, name: "items" });
  const total = calcTotal(
    (watchedItems ?? []).map((i) => ({
      ...i,
      quantity: Number(i.quantity) || 0,
      unitPrice: Number(i.unitPrice) || 0,
    })),
  );
  const errors = form.formState.errors;

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">Lập phiếu đề nghị mua hàng</h2>
      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit((v) =>
          create.mutate(v, { onSuccess: () => (form.reset(empty), onDone()) }),
        )}
      >
        <Field label="Tiêu đề" error={errors.title?.message}>
          <Input {...form.register("title")} aria-invalid={Boolean(errors.title)} />
        </Field>
        <div className="space-y-2">
          <span className="text-sm font-medium">Danh sách hàng</span>
          {items.fields.map((f, i) => {
            const rowErrors = errors.items?.[i];
            // Lỗi của cả ba ô hiện ngay dưới dòng: bấm Lưu mà không thấy gì xảy ra là lỗi UX nặng nhất của form.
            const rowMessage =
              rowErrors?.name?.message ?? rowErrors?.quantity?.message ?? rowErrors?.unitPrice?.message;
            return (
              <div key={f.id} className="space-y-1">
                <div className="grid grid-cols-[1fr_100px_160px_auto] gap-2">
                  <Input
                    placeholder="Tên hàng"
                    {...form.register(`items.${i}.name`)}
                    aria-invalid={Boolean(rowErrors?.name)}
                  />
                  <Input
                    type="number"
                    min={1}
                    aria-label="Số lượng"
                    {...form.register(`items.${i}.quantity`, { valueAsNumber: true })}
                    aria-invalid={Boolean(rowErrors?.quantity)}
                  />
                  <Input
                    type="number"
                    min={0}
                    step={1000}
                    aria-label="Đơn giá"
                    {...form.register(`items.${i}.unitPrice`, { valueAsNumber: true })}
                    aria-invalid={Boolean(rowErrors?.unitPrice)}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => items.remove(i)}
                    disabled={items.fields.length === 1}
                    aria-label="Xóa dòng"
                  >
                    ✕
                  </Button>
                </div>
                {rowMessage ? (
                  <p role="alert" className="text-sm text-red-600">
                    {rowMessage}
                  </p>
                ) : null}
              </div>
            );
          })}
          {/* Lỗi cấp danh sách (tổng tiền vượt giới hạn, thiếu dòng): react-hook-form đặt ở items.root. */}
          {(errors.items?.root?.message ?? errors.items?.message) ? (
            <p role="alert" className="text-sm text-red-600">
              {errors.items?.root?.message ?? errors.items?.message}
            </p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => items.append({ name: "", quantity: 1, unitPrice: 0 })}
          >
            Thêm dòng
          </Button>
        </div>
        <p className="text-sm">
          Tổng tiền: <strong>{formatVnd(total)}</strong>
        </p>
        {create.error ? (
          <p role="alert" className="text-sm text-red-600">
            {create.error instanceof ApiError ? create.error.message : "Không kết nối được máy chủ"}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Đang lưu..." : "Lưu nháp"}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Đóng
          </Button>
        </div>
      </form>
    </Card>
  );
}
