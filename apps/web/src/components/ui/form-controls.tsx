import { type InputHTMLAttributes, type SelectHTMLAttributes, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Input } from "./input";

/** Ô chọn (thẻ select gốc: bàn phím, trình đọc màn hình, điện thoại đều dùng được, không cần thư viện). */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 aria-[invalid=true]:border-red-500",
        className,
      )}
      {...props}
    />
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return (
    <label className={cn("flex items-start gap-2 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 size-4 accent-neutral-900" {...props} />
      <span>{label}</span>
    </label>
  );
}

/**
 * Ô tìm kiếm: chỉ báo giá trị mới sau khi người dùng ngừng gõ (mặc định 300 ms), tránh gọi API theo từng phím.
 * Giá trị ngoài (từ URL) đổi thì ô cập nhật theo.
 */
export function SearchInput({
  value,
  onChange,
  delayMs = 300,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  delayMs?: number;
}) {
  const [text, setText] = useState(value);
  // Giá trị ngoài đổi (bấm Back, mở link): cập nhật ô ngay trong lúc render, không qua effect.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Input
      type="search"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange(next), delayMs);
      }}
      {...props}
    />
  );
}

const BADGE_TONES = {
  neutral: "bg-neutral-100 text-neutral-700",
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  orange: "bg-orange-100 text-orange-800",
  red: "bg-red-100 text-red-800",
  muted: "bg-neutral-200 text-neutral-500",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE_TONES; children: string }) {
  return (
    <span className={cn("rounded px-2 py-0.5 text-xs whitespace-nowrap", BADGE_TONES[tone])}>{children}</span>
  );
}
