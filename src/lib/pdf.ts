'use client';

import type { Lang } from './i18n';

/** A statement: title + tables. Rendered as HTML (so Arabic shapes correctly), captured and written to a PDF. */
export interface PdfSection { heading: string; head?: string[]; rows: string[][]; note?: string }
export interface PdfDoc { title: string; subtitle?: string; sections: PdfSection[]; footer?: string }

type Win = Window & {
  html2canvas?: (el: HTMLElement, o: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  jspdf?: { jsPDF: new (o: Record<string, unknown>) => JsPdf };
  Capacitor?: { Plugins?: Record<string, any>; registerPlugin?: (n: string) => any };
};
interface JsPdf {
  addImage(d: string, f: string, x: number, y: number, w: number, h: number): void;
  addPage(): void;
  output(t: 'blob'): Blob;
}

const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-lib="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.lib = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('pdf-lib'));
    document.head.appendChild(s);
  });
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function toHtml(doc: PdfDoc, lang: Lang): string {
  const rtl = lang === 'ar';
  const tables = doc.sections
    .map((s) => {
      const head = s.head ? `<tr>${s.head.map((h) => `<th style="background:#0f766e;color:#fff;padding:6px 8px;text-align:start;font-size:12px">${esc(h)}</th>`).join('')}</tr>` : '';
      const body = s.rows.length
        ? s.rows.map((r, i) => `<tr style="background:${i % 2 ? '#f1f5f9' : '#fff'}">${r.map((c) => `<td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #e2e8f0">${esc(c)}</td>`).join('')}</tr>`).join('')
        : `<tr><td style="padding:8px;font-size:12px;color:#64748b">—</td></tr>`;
      return `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a">${esc(s.heading)}</h3><table style="width:100%;border-collapse:collapse">${head}${body}</table>${s.note ? `<p style="font-size:11px;color:#64748b;margin:4px 0 0">${esc(s.note)}</p>` : ''}`;
    })
    .join('');
  return `<div style="font-family:system-ui,'Segoe UI',Tahoma,Arial,sans-serif;color:#0f172a;direction:${rtl ? 'rtl' : 'ltr'}">
    <div style="border-bottom:3px solid #0f766e;padding-bottom:8px"><h1 style="margin:0;font-size:22px">${esc(doc.title)}</h1>${doc.subtitle ? `<p style="margin:4px 0 0;font-size:12px;color:#475569">${esc(doc.subtitle)}</p>` : ''}</div>
    ${tables}<p style="margin-top:22px;font-size:10px;color:#94a3b8">${esc(doc.footer ?? '')}</p></div>`;
}

export async function buildPdfBlob(doc: PdfDoc, lang: Lang): Promise<Blob> {
  for (const src of LIBS) await loadScript(src);
  const w = window as Win;
  if (!w.html2canvas || !w.jspdf) throw new Error('pdf-lib');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff;padding:24px;box-sizing:border-box';
  host.innerHTML = toHtml(doc, lang);
  document.body.appendChild(host);
  try {
    const canvas = await w.html2canvas(host, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const pdf = new w.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = 595.28, pageH = 841.89;
    const imgH = (canvas.height * pageW) / canvas.width;
    // Slice the tall capture page by page.
    const pxPerPage = Math.floor((canvas.width * pageH) / pageW);
    for (let y = 0, page = 0; y < canvas.height; y += pxPerPage, page++) {
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = Math.min(pxPerPage, canvas.height - y);
      part.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
      if (page > 0) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, (part.height * pageW) / canvas.width);
    }
    void imgH;
    return pdf.output('blob');
  } finally {
    host.remove();
  }
}

const toBase64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

export type ShareResult = 'shared' | 'downloaded';

/** Opens the share sheet (WhatsApp etc.) on the phone; falls back to a normal download. */
export async function sharePdf(blob: Blob, fileName: string, title: string): Promise<ShareResult> {
  const w = window as Win;
  const plug = (n: string) => w.Capacitor?.Plugins?.[n];
  const fs = plug('Filesystem');
  const share = plug('Share');
  if (fs && share) {
    try {
      const saved = await fs.writeFile({ path: fileName, data: await toBase64(blob), directory: 'CACHE' });
      await share.share({ title, url: saved.uri, dialogTitle: title });
      return 'shared';
    } catch {
      /* fall through */
    }
  }
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
