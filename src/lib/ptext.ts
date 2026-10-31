import type { Lang } from './i18n';
import { tx, type TKey } from './text';

const ar = {
  tabAccounts: 'الحسابات والمحافظ', tabProjects: 'مشاريع وتدفقات قادمة', myProjects: 'مشاريعي وأهدافي', addProject: 'إضافة مشروع / هدف',
  projectName: 'اسم المشروع أو الهدف', budget: 'الميزانية المستهدفة', allocated: 'المبلغ المخصص حالياً', noProjects: 'لا توجد مشاريع بعد',
  editProject: 'تعديل المشروع', deleteProject: 'حذف المشروع', archiveProject: 'أرشفة', confirmDelete: 'تأكيد الحذف؟',
  outflows: 'مصروفات قادمة', inflows: 'دفعات متوقعة', addOutflow: 'إضافة مصروف', addInflow: 'إضافة دفعة متوقعة', itemTitle: 'البند', amount: 'المبلغ',
  linkDebt: 'ربط بدين مستحق', noLink: 'بدون ربط', netPosition: 'الصافي المتوقع', surplus: 'فائض متوقع', deficit: 'عجز متوقع', stillNeeded: 'المتبقي المطلوب',
  progressOf: 'من', markDone: 'تم', projectsSqlMissing: 'جداول المشاريع غير مفعّلة بعد. شغّل ملف SQL في Supabase ثم أعد التحميل.',
  otpTitle: 'تسجيل الدخول برمز التحقق', otpSend: 'إرسال رمز التحقق', otpResend: 'إعادة الإرسال', otpSent: 'أرسلنا رمز التحقق إلى بريدك', otpCode: 'رمز التحقق',
  otpVerify: 'تأكيد والدخول', otpChange: 'تغيير البريد', otpWait: 'يمكنك الإعادة بعد', otpInvalid: 'الرمز غير صحيح أو انتهت صلاحيته', otpHint: 'الدخول والتسجيل بالرمز فقط، سيُنشأ حسابك تلقائياً إن كنت جديداً.',
  gaTitle: 'ربط واتساب (Green API) الخاص بك', gaId: 'IdInstance', gaToken: 'ApiTokenInstance', gaSave: 'حفظ إعدادات واتساب', gaTest: 'اختبار الإرسال',
  gaNote: 'تُحفظ المفاتيح في حسابك فقط ولا يراها غيرك. الرقم يُنظَّف تلقائياً ويُرسل إلى رقمك المسجل.', gaMissing: 'أدخل IdInstance و ApiToken ورقم واتساب واحفظها أولاً', gaSqlMissing: 'يلزم تشغيل ملف SQL في Supabase أولاً لحفظ هذه الحقول',
  dzTitle: 'إدارة ومسح البيانات', dzNote: 'عمليات لا يمكن التراجع عنها. يلزم تأكيد برمز يُرسل إلى بريدك.', dzOps: 'تصفير العمليات والمعاملات فقط', dzOpsDesc: 'يحذف المعاملات والمصروفات والديون، ويُبقي المحافظ بأرصدة صفرية.',
  dzFull: 'إعادة ضبط كاملة للحساب', dzFullDesc: 'يحذف المحافظ والديون والمهام والمشاريع للبدء من الصفر.', dzRequest: 'طلب مسح', dzConfirmTitle: 'تأكيد المسح', dzEnterCode: 'أدخل الرمز المرسل إلى بريدك لتأكيد هويتك',
  dzConfirmBtn: 'تأكيد المسح نهائياً', dzDone: 'تم المسح بنجاح', dzSqlMissing: 'دالة المسح غير مفعّلة بعد. شغّل ملف SQL في Supabase أولاً.', dzSent: 'أُرسل رمز التأكيد إلى بريدك',
  projectsTotal: 'مشاريع نشطة', noRateNote: 'بعض المبالغ لم تُحوَّل لغياب السعر', nextDue: 'أقرب استحقاق', open: 'فتح',
};
export type PKey = keyof typeof ar;
const en: Record<PKey, string> = {
  tabAccounts: 'Accounts & wallets', tabProjects: 'Projects & upcoming flows', myProjects: 'My projects & goals', addProject: 'Add project / goal',
  projectName: 'Project or goal name', budget: 'Target budget', allocated: 'Amount set aside', noProjects: 'No projects yet',
  editProject: 'Edit project', deleteProject: 'Delete project', archiveProject: 'Archive', confirmDelete: 'Confirm delete?',
  outflows: 'Upcoming expenses', inflows: 'Expected payments', addOutflow: 'Add expense', addInflow: 'Add expected payment', itemTitle: 'Item', amount: 'Amount',
  linkDebt: 'Link a due debt', noLink: 'No link', netPosition: 'Expected net', surplus: 'Expected surplus', deficit: 'Expected deficit', stillNeeded: 'Still needed',
  progressOf: 'of', markDone: 'Done', projectsSqlMissing: 'Project tables are not enabled yet. Run the SQL file in Supabase, then reload.',
  otpTitle: 'Sign in with a code', otpSend: 'Send verification code', otpResend: 'Resend', otpSent: 'We sent a verification code to your email', otpCode: 'Verification code',
  otpVerify: 'Verify & sign in', otpChange: 'Change email', otpWait: 'You can resend in', otpInvalid: 'The code is wrong or expired', otpHint: 'Sign in and sign up use a code only; a new account is created automatically.',
  gaTitle: 'Connect your own WhatsApp (Green API)', gaId: 'IdInstance', gaToken: 'ApiTokenInstance', gaSave: 'Save WhatsApp settings', gaTest: 'Test sending',
  gaNote: 'Keys are stored in your account only and nobody else can read them. The number is cleaned automatically and messages go to your saved number.', gaMissing: 'Enter IdInstance, ApiToken and a WhatsApp number, and save first', gaSqlMissing: 'Run the SQL file in Supabase first to save these fields',
  dzTitle: 'Data management & reset', dzNote: 'These actions cannot be undone. A code sent to your email is required.', dzOps: 'Reset transactions only', dzOpsDesc: 'Deletes transactions, expenses and debts; wallets stay with zero balances.',
  dzFull: 'Full account reset', dzFullDesc: 'Deletes wallets, debts, tasks and projects to start from scratch.', dzRequest: 'Request reset', dzConfirmTitle: 'Confirm reset', dzEnterCode: 'Enter the code sent to your email to confirm it is you',
  dzConfirmBtn: 'Confirm permanent reset', dzDone: 'Reset completed', dzSqlMissing: 'The reset function is not enabled yet. Run the SQL file in Supabase first.', dzSent: 'A confirmation code was sent to your email',
  projectsTotal: 'Active projects', noRateNote: 'Some amounts were not converted (missing rate)', nextDue: 'Next due', open: 'Open',
};
const dicts: Record<Lang, Record<PKey, string>> = { ar, en };

/** Text lookup for the projects feature: its own keys first, then the shared dictionary. */
export const px = (lang: Lang, key: PKey | TKey): string =>
  key in ar ? dicts[lang][key as PKey] : tx(lang, key as TKey);
export type AnyKey = PKey | TKey;
