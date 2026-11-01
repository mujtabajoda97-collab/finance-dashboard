'use client';

/** Last-resort screen for an unexpected error: shows what happened instead of a blank page. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>حدث خطأ غير متوقع — Something went wrong</h1>
      <p dir="ltr" style={{ maxWidth: 480, fontSize: 12, opacity: 0.75, wordBreak: 'break-word' }}>{String(error?.message ?? error)}</p>
      <button type="button" onClick={() => reset()} style={{ padding: '10px 20px', borderRadius: 12, background: '#34c79a', color: '#07130f', fontWeight: 700, border: 0 }}>
        إعادة المحاولة / Retry
      </button>
      <button type="button" onClick={() => { window.location.href = '/'; }} style={{ padding: '8px 16px', borderRadius: 12, background: 'transparent', border: '1px solid currentColor' }}>
        الصفحة الرئيسية / Home
      </button>
    </main>
  );
}
