import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

// Self-hosted at build time by next/font: the browser never contacts Google, and the
// font files are served from our own origin (and cached by the service worker).
const plexArabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-plex-arabic' });
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-plex-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500', '600'], display: 'swap', variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'نظام إدارة حياتي — My Life OS',
  description: 'Personal finance and task management — in one place.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Life OS' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#07130f',
};

// Applies saved theme + language before first paint (no flash, correct direction).
const bootScript = `(function(){try{
var d=document.documentElement,t=localStorage.getItem('theme');
var dark=t?t==='dark':true;
if(dark){d.classList.add('dark');d.style.colorScheme='dark';}
var l=localStorage.getItem('lang')||'ar';d.lang=l;d.dir=l==='ar'?'rtl':'ltr';
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className={`${plexArabic.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
