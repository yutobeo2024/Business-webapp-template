import { Checkbox } from "./form-controls";

/**
 * Nhóm ô chọn nhiều giá trị (vai trò của người dùng, quyền của vai trò). Dùng với Controller của React Hook Form:
 * giá trị luôn là mảng (input checkbox thường trả boolean khi chỉ có một ô).
 */
export function CheckboxGroup<V extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: V; label: string; disabled?: boolean; hint?: string }[];
  value: readonly V[];
  onChange: (next: V[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {options.map((o) => (
        <div key={o.value}>
          <Checkbox
            label={o.label}
            checked={value.includes(o.value)}
            disabled={disabled || o.disabled}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))
            }
          />
          {o.hint ? <p className="ml-6 text-xs text-neutral-500">{o.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
