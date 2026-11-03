'use client';

import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { useApp } from './Providers';
import { buildPdfBlob, sharePdf, type PdfDoc } from '@/lib/pdf';

/** Builds a PDF statement from `build()` and shares / downloads it. */
export function PdfButton({ build, fileName, className = 'btn btn-ghost' }: { build: () => PdfDoc; fileName: string; className?: string }) {
  const { lang, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const label = lang === 'ar' ? 'تصدير PDF' : 'Export PDF';

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const doc = build();
      const blob = await buildPdfBlob(doc, lang);
      const r = await sharePdf(blob, fileName, doc.title);
      notify(r === 'shared' ? (lang === 'ar' ? 'جاهز للمشاركة' : 'Ready to share') : lang === 'ar' ? 'تم تنزيل الملف' : 'File downloaded');
    } catch {
      notify(lang === 'ar' ? 'تعذّر إنشاء الملف (يلزم اتصال بالإنترنت لأول مرة)' : 'Could not create the PDF (internet needed the first time)', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={busy} className={className}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />} {label}
    </button>
  );
}
