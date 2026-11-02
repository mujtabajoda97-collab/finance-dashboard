import type { Lang } from './i18n';
import { px, type AnyKey } from './ptext';

// Texts for the app lock and the grouped WhatsApp alerts. Falls back to the shared dictionaries.
const ar = {
  msgTasksGroup: 'ملخص المهام المعلقة', balNow: 'الرصيد الحالي', andMore: 'و مهام أخرى:',
  lockTitle: 'قفل التطبيق (بصمة / رمز الهاتف)', lockNote: 'عند تفعيله يطلب التطبيق بصمتك أو رمز قفل الهاتف (PIN / نمط) عند كل فتح أو عودة من الخلفية، قبل عرض أي بيانات مالية.',
  lockEnable: 'تفعيل قفل التطبيق', lockDisable: 'إيقاف قفل التطبيق (يلزم تأكيد البصمة)', lockOn: 'قفل التطبيق مفعّل', lockEnabledMsg: 'تم تفعيل قفل التطبيق', lockDisabledMsg: 'تم إيقاف قفل التطبيق',
  lockedHeading: 'التطبيق مقفل', lockPrompt: 'أكّد هويتك لفتح التطبيق', lockUnlock: 'فتح القفل', lockFail: 'لم يتم التحقق من الهوية', lockNoScreenLock: 'فعّل بصمة أو رمز قفل في إعدادات الهاتف أولاً',
};
export type P2Key = keyof typeof ar;
const en: Record<P2Key, string> = {
  msgTasksGroup: 'Pending tasks summary', balNow: 'Current balance', andMore: 'and more tasks:',
  lockTitle: 'App lock (fingerprint / phone PIN)', lockNote: 'When on, the app asks for your fingerprint or phone screen lock (PIN / pattern) every time it opens or returns from the background, before showing any financial data.',
  lockEnable: 'Turn on app lock', lockDisable: 'Turn off app lock (fingerprint required)', lockOn: 'App lock is on', lockEnabledMsg: 'App lock enabled', lockDisabledMsg: 'App lock turned off',
  lockedHeading: 'App locked', lockPrompt: 'Confirm it is you to open the app', lockUnlock: 'Unlock', lockFail: 'Identity was not verified', lockNoScreenLock: 'Set up a fingerprint or screen lock in the phone settings first',
};
export type AnyKey2 = P2Key | AnyKey;

export const p2 = (lang: Lang, key: AnyKey2): string =>
  key in ar ? (lang === 'ar' ? ar : en)[key as P2Key] : px(lang, key as AnyKey);
