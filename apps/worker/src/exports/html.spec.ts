import { describe, expect, it } from "vitest";
import { escapeHtml, html } from "@app/server";

describe("html", () => {
  it("escape mọi giá trị chèn vào, kể cả trong thuộc tính", () => {
    const name = `<img src=x onerror="alert(1)">'&`;
    expect(html`<td title="${name}">${name}</td>`.value).toBe(
      `<td title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;</td>`,
    );
  });

  it("lồng html không bị escape hai lần; mảng nối lại; null/undefined/false bỏ qua", () => {
    const rows = ["a<b", "c"].map((x) => html`<li>${x}</li>`);
    expect(
      html`<ul>
        ${rows}${null}${undefined}${false}
      </ul>`.value.replace(/\s+/g, ""),
    ).toBe("<ul><li>a&lt;b</li><li>c</li></ul>");
    expect(html`${0}`.value).toBe("0");
  });

  it("escapeHtml", () => expect(escapeHtml(`"<&>'`)).toBe("&quot;&lt;&amp;&gt;&#39;"));
});
