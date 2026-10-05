import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fileTypeLabels, IMPORT_STATUS_LABELS, IMPORT_TYPES, type ImportType } from "@app/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/api";
import { importTemplateUrl, useCommitImport, useImportJob, useUploadImport } from "./api";

/**
 * Nút + hộp thoại nhập Excel (spec 003): tải mẫu -> chọn tệp -> hệ thống kiểm -> xem lỗi hoặc xem trước -> xác nhận.
 * Có dòng lỗi thì không nhập dòng nào. `invalidate`: danh sách cần tải lại sau khi nhập xong.
 * Mẫu dùng: trang Phòng ban.
 */
export function ImportButton({ type, invalidate }: { type: ImportType; invalidate: QueryKey }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Nhập từ Excel
      </Button>
      <Dialog
        open={open}
        title={`Nhập ${IMPORT_TYPES[type].label.toLowerCase()} từ Excel`}
        onClose={() => setOpen(false)}
      >
        <ImportBody type={type} invalidate={invalidate} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function ImportBody({
  type,
  invalidate,
  onClose,
}: {
  type: ImportType;
  invalidate: QueryKey;
  onClose: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const upload = useUploadImport(type);
  const commit = useCommitImport();
  const job = useImportJob(jobId);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const data = job.data;
  const busy =
    upload.isPending || commit.isPending || data?.status === "VALIDATING" || data?.status === "COMMITTING";
  const error = apiErrorMessage(upload.error) ?? apiErrorMessage(commit.error) ?? apiErrorMessage(job.error);

  const done = data?.status === "DONE";
  // Khóa dạng chuỗi: mảng `invalidate` tạo mới mỗi lần render, dùng trực tiếp thì effect chạy lặp mãi.
  const invalidateKey = JSON.stringify(invalidate);
  useEffect(() => {
    if (done) void qc.invalidateQueries({ queryKey: JSON.parse(invalidateKey) as QueryKey });
  }, [done, qc, invalidateKey]);

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>
          Tải{" "}
          <a className="text-blue-700 underline" href={importTemplateUrl(type)} download>
            tệp mẫu
          </a>
          , điền dữ liệu từ dòng 2, giữ nguyên dòng tiêu đề.
        </li>
        <li>
          Chọn tệp ({fileTypeLabels(["xlsx"])}). Hệ thống kiểm toàn bộ trước; có lỗi thì không nhập dòng nào.
        </li>
      </ol>

      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label="Chọn tệp Excel để nhập"
        accept=".xlsx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file, { onSuccess: (j) => setJobId(j.id) });
        }}
      />
      {!done ? (
        <Button
          size="sm"
          variant={data?.status === "READY" ? "outline" : "default"}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? "Đang tải lên..." : data ? "Chọn tệp khác" : "Chọn tệp"}
        </Button>
      ) : null}

      {data ? (
        <div className="space-y-2 rounded border p-3 text-sm">
          <p>
            <strong>{data.fileName}</strong>: {IMPORT_STATUS_LABELS[data.status]}
            {data.totalRows !== null ? ` · ${data.totalRows} dòng` : ""}
          </p>
          {data.status === "INVALID" || data.status === "FAILED" ? (
            <>
              <p className="text-red-700">
                {data.errorCount} lỗi
                {data.errorCount > data.errors.length ? ` (hiện ${data.errors.length} lỗi đầu)` : ""}. Sửa tệp
                rồi chọn lại.
              </p>
              <div className="max-h-60 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="p-1">Dòng</th>
                      <th className="p-1">Cột</th>
                      <th className="p-1">Lỗi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.errors.map((e, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-1 tabular-nums">{e.row ?? ""}</td>
                        <td className="p-1">{e.column ?? ""}</td>
                        <td className="p-1">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {data.status === "READY" ? (
            <>
              <p>Xem trước {data.preview.length} dòng đầu:</p>
              <div className="max-h-60 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b">
                      {IMPORT_TYPES[type].columns.map((c) => (
                        <th key={c.key} className="p-1">
                          {c.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.preview.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {IMPORT_TYPES[type].columns.map((c) => (
                          <td key={c.key} className="p-1">
                            {row[c.header]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                disabled={busy}
                onClick={() => commit.mutate(data.id, { onSuccess: () => void job.refetch() })}
              >
                {commit.isPending ? "Đang gửi..." : `Xác nhận nhập ${data.totalRows} dòng`}
              </Button>
            </>
          ) : null}
          {done ? (
            <p role="status" className="text-green-700">
              Đã nhập {data.importedCount} dòng.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
      </div>
    </div>
  );
}
