import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app is a thin native shell that loads the live site on Vercel,
 * so the API routes (/api/whatsapp) and Supabase auth keep working unchanged.
 * `webDir` only needs to exist; the real UI comes from server.url.
 */
const config: CapacitorConfig = {
  appId: 'com.restocloud.lifeos',
  appName: 'My Life OS',
  webDir: 'www',
  server: {
    url: 'https://finance-dashboard-chi-sage.vercel.app',
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
