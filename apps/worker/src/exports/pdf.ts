/**
 * HTML -> PDF bằng Chromium (ADR-0005). Một trình duyệt dùng chung cho mọi job, mở khi cần, đóng khi worker dừng.
 * Chromium trong container chạy không sandbox (Playwright mặc định), nên bù bằng: HTML do mã sinh và escape mọi dữ liệu
 * (`html`), tắt JavaScript, chặn mọi request mạng của trang.
 */
import { type Browser, chromium } from "playwright-core";
import type { SafeHtml } from "@app/server";

const FOOTER = `<div style="width:100%;font-size:8px;color:#555;text-align:center;font-family:'Noto Sans',Arial,sans-serif">
Trang <span class="pageNumber"></span>/<span class="totalPages"></span></div>`;

export class PdfRenderer {
  private browser: Promise<Browser> | null = null;

  /** executablePath: CHROMIUM_PATH (image production); bỏ trống khi dev = trình duyệt Playwright đã cài. */
  constructor(private readonly executablePath?: string) {}

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const launching = chromium
        .launch({ executablePath: this.executablePath, args: ["--disable-dev-shm-usage"] })
        .then((b) => {
          b.on("disconnected", () => {
            if (this.browser === launching) this.browser = null;
          });
          return b;
        });
      launching.catch(() => {
        if (this.browser === launching) this.browser = null;
      });
      this.browser = launching;
    }
    return this.browser;
  }

  async render(doc: SafeHtml): Promise<Buffer> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    try {
      await context.route("**/*", (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(doc.value, { waitUntil: "load", timeout: 30_000 });
      return await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "15mm", bottom: "18mm", left: "15mm", right: "15mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: FOOTER,
      });
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    const pending = this.browser;
    this.browser = null;
    const browser = await pending?.catch(() => null);
    await browser?.close();
  }
}
