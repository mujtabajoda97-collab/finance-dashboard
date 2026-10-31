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
  targetDate: 'تاريخ المناسبة / الهدف', spentLabel: 'المصروف فعلياً', remainingCost: 'التكلفة المتبقية', pendingIn: 'مستحق التحصيل',
  coverOk: 'التدفقات المتوقعة تغطي التكاليف المتبقية', coverShort: 'التدفقات المتوقعة لا تغطي التكاليف المتبقية', beforeDate: 'متوقع قبل الموعد', afterDate: 'يصل بعد الموعد (لا يُحتسب)',
  leftOver: 'يفيض', shortBy: 'ينقص', daysLeft: 'يوم متبقٍ', datePassed: 'انتهى الموعد', noTargetNote: 'حدّد تاريخ المناسبة لحساب التغطية بدقة', overdue: 'متأخر',
  payOut: 'تسجيل صرف', payIn: 'تسجيل استلام', payAmountOut: 'المبلغ المصروف', payAmountIn: 'المبلغ المستلم', paidWord: 'مدفوع', restWord: 'متبقٍ', undo: 'تراجع',
  payHintIn: 'يُضاف المبلغ المستلم فوراً إلى المخصص، ويبقى الباقي معلّقاً في التدفقات القادمة.', payHintOut: 'يُخصم من التكلفة المتبقية ويُثبَّت كمصروف منفّذ.',
  payTooMuch: 'المبلغ أكبر من المتبقي', sqlV2Missing: 'الدفعات الجزئية تحتاج تشغيل ملف SQL 0007 في Supabase أولاً.', sourcePlaceholder: 'راتب، دين مسترد، مساهمة…', coverageTitle: 'هل تكفي المتوقعات قبل الموعد؟', fundsNow: 'المخصص حالياً',
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
  targetDate: 'Event / target date', spentLabel: 'Actually spent', remainingCost: 'Remaining cost', pendingIn: 'Still to collect',
  coverOk: 'Expected inflows cover the remaining costs', coverShort: 'Expected inflows do not cover the remaining costs', beforeDate: 'Expected before the date', afterDate: 'Arrives after the date (not counted)',
  leftOver: 'Left over', shortBy: 'Short by', daysLeft: 'days left', datePassed: 'Date has passed', noTargetNote: 'Set the event date to compute coverage accurately', overdue: 'Overdue',
  payOut: 'Record spending', payIn: 'Record receipt', payAmountOut: 'Amount spent', payAmountIn: 'Amount received', paidWord: 'Paid', restWord: 'Left', undo: 'Undo',
  payHintIn: 'The received amount is added to the set-aside amount now; the rest stays pending.', payHintOut: 'It reduces the remaining cost and is recorded as executed spending.',
  payTooMuch: 'Amount is more than what is left', sqlV2Missing: 'Partial payments need SQL 0007 to be run in Supabase first.', sourcePlaceholder: 'Salary, repaid debt, contribution…', coverageTitle: 'Will expected inflows suffice by the date?', fundsNow: 'Set aside now',
  projectsTotal: 'Active projects', noRateNote: 'Some amounts were not converted (missing rate)', nextDue: 'Next due', open: 'Open',
};
const dicts: Record<Lang, Record<PKey, string>> = { ar, en };

/** Text lookup for the projects feature: its own keys first, then the shared dictionary. */
export const px = (lang: Lang, key: PKey | TKey): string =>
  key in ar ? dicts[lang][key as PKey] : tx(lang, key as TKey);
export type AnyKey = PKey | TKey;
