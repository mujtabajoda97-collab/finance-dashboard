import type { Lang } from './i18n';
import { px, type AnyKey } from './ptext';

// Texts for the app lock and the grouped WhatsApp alerts. Falls back to the shared dictionaries.
const ar = {
  msgTasksGroup: 'ملخص المهام المعلقة', balNow: 'الرصيد الحالي', andMore: 'و مهام أخرى:',
  lockTitle: 'قفل التطبيق (بصمة / رمز الهاتف)', lockNote: 'عند تفعيله يطلب التطبيق بصمتك أو رمز قفل الهاتف (PIN / نمط) عند كل فتح أو عودة من الخلفية، قبل عرض أي بيانات مالية.',
  lockEnable: 'تفعيل قفل التطبيق', lockDisable: 'إيقاف قفل التطبيق (يلزم تأكيد البصمة)', lockOn: 'قفل التطبيق مفعّل', lockEnabledMsg: 'تم تفعيل قفل التطبيق', lockDisabledMsg: 'تم إيقاف قفل التطبيق',
  recipSend: 'إرسال إلى رقم آخر', recipName: 'اسم المستلم', recipPhone: 'رقم واتساب المستلم (مع رمز الدولة)', recipText: 'نص الرسالة (يمكنك تعديله أو مسحه وكتابة ما تريد)',
  recipReset: 'استعادة النص المقترح', recipNote: 'يُرسل النص كما هو عبر واتساب عند حلول وقت التنبيه، ويتطلب تفعيل «الإرسال التلقائي» في الإعدادات وفتح التطبيق.',
  recipPhoneBad: 'رقم واتساب المستلم غير صحيح', recipTextEmpty: 'نص الرسالة فارغ', tplNameFallback: 'أخي', taskNotes: 'التفاصيل / الملاحظات', taskNotesPh: 'اختياري: أي تفاصيل أو ملاحظات عن المهمة',
  tplDebt: 'السلام عليكم يا {name}، كيف حالك؟ حبيت أذكرك يا غالي بموضوع الـ {amount}، ربنا ييسر أمرك وأمورنا.',
  tplTask: 'السلام عليكم يا {name}، تذكير بخصوص موضوع: {title}',
  lockedHeading: 'التطبيق مقفل', lockPrompt: 'أكّد هويتك لفتح التطبيق', lockUnlock: 'فتح القفل', lockFail: 'لم يتم التحقق من الهوية', lockNoScreenLock: 'فعّل بصمة أو رمز قفل في إعدادات الهاتف أولاً',
};
export type P2Key = keyof typeof ar;
const en: Record<P2Key, string> = {
  msgTasksGroup: 'Pending tasks summary', balNow: 'Current balance', andMore: 'and more tasks:',
  lockTitle: 'App lock (fingerprint / phone PIN)', lockNote: 'When on, the app asks for your fingerprint or phone screen lock (PIN / pattern) every time it opens or returns from the background, before showing any financial data.',
  lockEnable: 'Turn on app lock', lockDisable: 'Turn off app lock (fingerprint required)', lockOn: 'App lock is on', lockEnabledMsg: 'App lock enabled', lockDisabledMsg: 'App lock turned off',
  recipSend: 'Send to another number', recipName: 'Recipient name', recipPhone: 'Recipient WhatsApp number (with country code)', recipText: 'Message text (edit it, or clear it and write your own)',
  recipReset: 'Restore suggested text', recipNote: 'The text is sent exactly as written over WhatsApp when the alert time arrives. Needs “Automatic sending” turned on in Settings and the app open.',
  recipPhoneBad: 'The recipient WhatsApp number is not valid', recipTextEmpty: 'The message text is empty', tplNameFallback: 'friend', taskNotes: 'Details / notes', taskNotesPh: 'Optional: any details or notes about the task',
  tplDebt: 'Hi {name}, how are you? Just a friendly reminder about the {amount}. Hope things are easy for you.',
  tplTask: 'Hi {name}, a reminder about: {title}',
  lockedHeading: 'App locked', lockPrompt: 'Confirm it is you to open the app', lockUnlock: 'Unlock', lockFail: 'Identity was not verified', lockNoScreenLock: 'Set up a fingerprint or screen lock in the phone settings first',
};
export type AnyKey2 = P2Key | AnyKey;

export const p2 = (lang: Lang, key: AnyKey2): string =>
  key in ar ? (lang === 'ar' ? ar : en)[key as P2Key] : px(lang, key as AnyKey);
