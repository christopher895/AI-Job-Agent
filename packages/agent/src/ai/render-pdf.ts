import { chromium } from "playwright";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(text: string): string {
  return esc(text).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h1>${esc(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2>${esc(line.slice(3))}</h2>`);
    } else if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${renderInline(line.slice(2))}</li>`);
    } else if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p>${renderInline(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    color: #000;
    padding: 0.65in 0.75in;
    line-height: 1.35;
  }
  h1 {
    font-size: 16pt;
    font-weight: bold;
    text-align: center;
    margin-bottom: 3px;
  }
  h2 {
    font-size: 10.5pt;
    font-weight: bold;
    text-transform: uppercase;
    border-bottom: 1px solid #000;
    margin: 9px 0 3px;
    letter-spacing: 0.06em;
    padding-bottom: 1px;
  }
  p {
    font-size: 10.5pt;
    margin: 2px 0;
  }
  ul {
    margin: 2px 0 2px 18px;
    padding: 0;
  }
  li {
    font-size: 10.5pt;
    margin: 1px 0;
  }
  strong { font-weight: bold; }
`;

export async function renderPdf(markdown: string): Promise<Buffer> {
  const body = markdownToHtml(markdown);
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body>${body}</body></html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "Letter",
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      printBackground: false,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
