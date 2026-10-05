import { SafeHtml } from "@app/server";

/**
 * CSS chung cho mẫu in A4. Font: Noto Sans (image worker cài fonts-noto-core, đủ dấu tiếng Việt); không tải font từ mạng
 * (trang PDF bị chặn mọi request).
 */
export const BASE_CSS = new SafeHtml(`
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans", "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #111; margin: 0; }
  h1 { font-size: 16pt; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .muted { color: #555; }
  .small { font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  table.info th { text-align: left; width: 18%; font-weight: 600; padding: 4px 6px; vertical-align: top; }
  table.info td { padding: 4px 6px; vertical-align: top; }
  table.grid th, table.grid td { border: 1px solid #999; padding: 5px 6px; }
  table.grid thead th { background: #f0f0f0; }
  table.grid tr { page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  table.signatures { margin-top: 28px; text-align: center; page-break-inside: avoid; }
  table.signatures td { width: 33%; font-weight: 600; }
  table.signatures tr.hint td { font-weight: normal; font-style: italic; font-size: 9pt; color: #555; }
  table.signatures tr.names td { padding-top: 64px; }
`);
