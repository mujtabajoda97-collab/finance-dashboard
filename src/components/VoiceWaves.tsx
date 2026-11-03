'use client';

import { useEffect, useState } from 'react';

/** Pulsing bars driven by the microphone level, so the user can see that recording is really active. */
export function VoiceWaves({ level, bars = 24, className = '' }: { level: { current: number }; bars?: number; className?: string }) {
  const [t, setT] = useState(0);
  const [lv, setLv] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { setT((x) => x + 1); setLv(level.current); }, 90);
    return () => clearInterval(id);
  }, [level]);
  return (
    <div className={`flex h-10 items-center justify-center gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const wave = 0.35 + 0.65 * Math.abs(Math.sin(t / 2.2 + i * 0.75));
        const h = 4 + Math.min(1, lv * 1.4) * 34 * wave;
        return <span key={i} className="w-1 rounded-full bg-current transition-[height] duration-100" style={{ height: `${h}px` }} />;
      })}
    </div>
  );
}
