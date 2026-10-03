// All user-facing text (Persian). Add other languages as sibling files with the same shape.
import { toFa } from "@/lib/time";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const DAY_NAMES: Record<number, string> = {
  0: "یکشنبه", 1: "دوشنبه", 2: "سه‌شنبه", 3: "چهارشنبه", 4: "پنجشنبه", 5: "جمعه", 6: "شنبه",
};
export const DAY_SHORT: Record<number, string> = {
  0: "ی", 1: "د", 2: "س", 3: "چ", 4: "پ", 5: "ج", 6: "ش",
};
/** Persian week order: Saturday first. */
export const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

export const STATUS_LABEL: Record<string, string> = {
  pending_link: "⏳ در انتظار اتصال",
  connected: "🔗 متصل (یادآوری خاموش)",
  active: "🟢 فعال",
  paused: "⏸ متوقف",
  blocked: "🚫 ربات را بلاک کرده",
};

export const fa = {
  disclaimer:
    "ℹ️ این ربات فقط یک یادآور است و جای پزشک را نمی‌گیرد. دوز و زمان مصرف را دقیقاً طبق نسخهٔ پزشک تنظیم کنید.",

  // ───── patient ─────
  needInvite: "برای استفاده از ربات به لینک دعوت نیاز دارید. لطفاً از فردی که شما را اضافه کرده بخواهید لینک بفرستد.",
  inviteInvalid: "این لینک دعوت معتبر نیست یا منقضی شده است. لطفاً لینک جدید بخواهید.",
  inviteUsed: "این لینک قبلاً استفاده شده است. اگر هنوز متصل نشده‌اید، لینک جدید بخواهید.",
  chatAlreadyLinked: "این حساب تلگرام قبلاً به فرد دیگری متصل شده است. لطفاً با ادمین تماس بگیرید.",
  welcomeBack: (name: string) => `سلام ${esc(name)} 👋\nشما قبلاً متصل شده‌اید. برای دیدن داروهایتان /mymeds را بزنید.`,
  welcomeConsent: (name: string) =>
    `سلام ${esc(name)} 👋\nاین ربات زمان مصرف داروهایتان را یادآوری می‌کند.`,
  consentText:
    "📋 <b>چه اطلاعاتی ذخیره می‌شود؟</b>\n" +
    "فقط: نام شما، شناسهٔ چت تلگرام، منطقهٔ زمانی، نام و دوز داروها، برنامهٔ مصرف و ثبت مصرف (خوردم / رد کردم / از دست رفت).\n\n" +
    "این‌ها اطلاعات سلامت محسوب می‌شوند. اطلاعات فقط برای ارسال یادآوری و نمایش وضعیت مصرف به ادمینی که شما را اضافه کرده استفاده می‌شود. " +
    "هر زمان با /delete_my_data همهٔ اطلاعات را برای همیشه پاک کنید.\n\n" +
    "آیا موافقید؟",
  agree: "✅ موافقم",
  decline: "❌ نه",
  declined: "باشه، هیچ اطلاعاتی ذخیره نشد. اگر نظرتان عوض شد، دوباره روی لینک بزنید.",
  connectedOk: "✅ اتصال انجام شد.",
  medsHeader: "💊 داروهای ثبت‌شده برای شما:",
  medsConfirmQ: "این فهرست درست است؟ اگر اشتباهی هست به ادمین بگویید.",
  noMeds: "هنوز دارویی برای شما ثبت نشده است.",
  remindersWillStart: "همه چیز آماده است. یادآوری‌ها بعد از اینکه ادمین شروعشان کند شروع می‌شود.",
  remindersStarted: "▶️ یادآوری داروهای شما شروع شد.",
  remindersStopped: "⏸ یادآوری داروهای شما متوقف شد.",
  helpPatient:
    "دستورها:\n/mymeds — داروهای من\n/settings — توقف موقت یادآوری\n/privacy — حریم خصوصی\n/delete_my_data — پاک کردن همهٔ اطلاعات\n/help — راهنما",
  privacy:
    "🔒 <b>حریم خصوصی</b>\n\n" +
    "ذخیره می‌شود: نام، شناسهٔ چت تلگرام، منطقهٔ زمانی، نام و دوز داروها، برنامهٔ مصرف، ثبت مصرف.\n" +
    "ذخیره نمی‌شود: تشخیص بیماری، سوابق پزشکی، هر چیز دیگر.\n\n" +
    "اطلاعات در سرورهای اروپا نگه‌داری می‌شود و فقط برای یادآوری و نمایش وضعیت مصرف به ادمین شما استفاده می‌شود.\n" +
    "حق دسترسی: با /mymeds داروهایتان را ببینید.\n" +
    "حق پاک‌سازی: با /delete_my_data همه چیز برای همیشه حذف می‌شود.",
  deleteAsk: "⚠️ با ادامه، همهٔ اطلاعات شما (داروها و سابقهٔ مصرف) برای همیشه پاک می‌شود و قابل بازگشت نیست. مطمئنید؟",
  deleteYes: "🗑 بله، پاک کن",
  deleteNo: "نه، منصرف شدم",
  deleteStep2: "آخرین تأیید: واقعاً همه چیز پاک شود؟",
  deleteFinal: "بله، قطعاً",
  deleteDone: "🗑 همهٔ اطلاعات شما پاک شد. اگر خواستید دوباره استفاده کنید، لینک دعوت جدید بخواهید.",
  deleteCancelled: "پاک‌سازی لغو شد.",
  notLinked: "شما هنوز متصل نشده‌اید.",
  settingsTitle: "⚙️ تنظیمات",
  pauseBtn: "⏸ توقف موقت یادآوری",
  resumeBtn: "▶️ ادامهٔ یادآوری",
  paused: "⏸ یادآوری‌ها موقتاً متوقف شد. هر وقت خواستید ادامه دهید.",
  resumed: "▶️ یادآوری‌ها ادامه پیدا کرد.",
  settingsNeedAdmin: "یادآوری هنوز توسط ادمین شروع نشده است.",
  welcomeBackUnblocked: "خوش برگشتید! یادآوری‌ها دوباره فعال شد 💊",

  // ───── reminder ─────
  remindTitle: "⏰ وقت دارو!",
  remindLine: (name: string, dose: string) => `💊 ${esc(name)} — ${esc(dose)}`,
  noteLine: (n: string) => `📝 ${esc(n)}`,
  btnTaken: "✓ خوردم",
  btnSnooze: (m: number) => `⏰ ${toFa(m)} دقیقه بعد`,
  btnSkip: "✗ رد کردم",
  btnTakenAll: "✓ همه را خوردم",
  btnSnoozeAll: (m: number) => `⏰ همه ${toFa(m)} دقیقه بعد`,
  btnSkipAll: "✗ همه را رد کردم",
  btnTakenOne: (name: string) => `✓ ${name}`,
  stTaken: (t: string) => `✅ خورده شد (${t})`,
  stSkipped: "✗ رد شد",
  stSnoozed: (t: string) => `⏰ یادآوری مجدد ساعت ${t}`,
  stMissed: "⌛ بدون پاسخ",
  stCancelled: "— لغو شد",
  alreadyRecorded: "قبلاً ثبت شده ✅",
  snoozeLimit: "بیشتر از این نمی‌شود عقب انداخت.",
  recorded: "ثبت شد ✅",
  nudge: ["یادآوری آرام: داروی بالا را خوردید؟ 🌿", "هنوز منتظر پاسختان هستیم 💊 اگر خوردید دکمه را بزنید."],
  snoozeAgain: "⏰ دوباره وقت دارو شد!",

  // ───── admin ─────
  denied: "⛔ دسترسی ندارید.",
  adminMenu: "🛠 <b>منوی مدیریت</b>",
  btnNewPerson: "➕ فرد جدید",
  btnPeople: "👥 افراد",
  btnStatus: "ℹ️ وضعیت سیستم",
  btnBack: "◀️ بازگشت",
  btnMenu: "🏠 منو",
  noPeople: "هنوز کسی اضافه نشده است.",
  peopleTitle: "👥 <b>افراد</b>",
  askName: "نام فرد را بنویسید:",
  nameInvalid: "نام نمی‌تواند خالی یا بیش از ۵۰ حرف باشد. دوباره بنویسید:",
  askTz: (def: string) => `منطقهٔ زمانی را انتخاب کنید (پیش‌فرض: ${def}) یا نام آن را بنویسید، مثلاً Europe/Rome:`,
  tzInvalid: "منطقهٔ زمانی معتبر نیست (مثل Asia/Tehran یا Europe/Rome). دوباره بنویسید:",
  confirmPerson: (name: string, tz: string) => `ثبت شود؟\n👤 ${esc(name)}\n🌍 ${esc(tz)}`,
  btnConfirm: "✅ تأیید",
  btnCancel: "✖️ لغو",
  personCreated: "✅ فرد ساخته شد. حالا دارو اضافه کنید و لینک دعوت بسازید.",
  flowCancelled: "لغو شد.",
  nothingToCancel: "چیزی برای لغو نیست.",
  flowExpired: "این مرحله منقضی شده. از /admin دوباره شروع کنید.",
  personCard: (name: string, tz: string, status: string, meds: string) =>
    `👤 <b>${esc(name)}</b>\n🌍 ${esc(tz)}\nوضعیت: ${status}\n\n${meds}`,
  noMedsAdmin: "هنوز دارویی ثبت نشده.",
  btnStart: "▶️ شروع یادآوری",
  btnStop: "⏸ توقف یادآوری",
  btnAddMed: "➕ دارو",
  btnInvite: "🔗 لینک دعوت",
  btnEditPerson: "✏️ ویرایش",
  btnDeletePerson: "🗑 حذف",
  btnReport: "📊 گزارش",
  btnEditName: "✏️ نام",
  btnEditTz: "🌍 منطقهٔ زمانی",
  startNotConnected: "⛔ این فرد هنوز از طریق لینک متصل نشده است.",
  startNoMeds: "⛔ حداقل یک داروی فعال لازم است.",
  startBlocked: "⛔ این فرد ربات را بلاک کرده است.",
  startedAdmin: "▶️ یادآوری شروع شد (فقط از همین لحظه به بعد).",
  stoppedAdmin: "⏸ یادآوری متوقف شد و دوزهای در انتظار لغو شدند.",
  askMedName: "نام دارو:",
  askDose: "دوز (متن آزاد، مثلاً «۱ قرص» یا «۵ میلی‌لیتر»):",
  askTimes: "ساعت‌های مصرف را بنویسید (۲۴ ساعته، با فاصله یا کاما). مثال: <code>8 14:30 2000</code>",
  timesInvalid: "ساعت نامعتبر. مثال درست: 8 ، 8:30 ، 0830 (چند ساعت با فاصله جدا شود).",
  fieldInvalid: "مقدار خالی یا خیلی طولانی است. دوباره بنویسید:",
  askDays: "روزهای مصرف را انتخاب کنید (پیش‌فرض: هر روز):",
  btnDaysDone: "ادامه ▶️",
  askStart: "تاریخ شروع (میلادی، مثل 2026-10-20) یا دکمهٔ «امروز»:",
  btnToday: "امروز",
  askEnd: "تاریخ پایان (اختیاری):",
  btnNoEnd: "بدون پایان",
  dateInvalid: "تاریخ نامعتبر. فرمت: 2026-10-20",
  endBeforeStart: "تاریخ پایان نمی‌تواند قبل از شروع باشد.",
  askNote: "یادداشت کوتاه (اختیاری، مثلاً «بعد از غذا»):",
  btnNoNote: "بدون یادداشت",
  medSummary: (m: { name: string; dose: string; times: string[]; days: number[]; start: string; end: string | null; note: string | null }) =>
    `💊 <b>${esc(m.name)}</b> — ${esc(m.dose)}\n🕐 ${m.times.map((t) => toFa(t)).join("، ")}\n📅 ${daysLabel(m.days)}\n▶️ ${m.start}${m.end ? `  ⏹ ${m.end}` : "  (بدون پایان)"}` +
    (m.note ? `\n📝 ${esc(m.note)}` : ""),
  confirmMedQ: "درست است؟ ثبت شود؟",
  medSaved: "✅ دارو ثبت شد.",
  medListLine: (m: { name: string; dose: string; times: string[]; days: number[]; is_active: boolean; end_date: string | null }) =>
    `${m.is_active ? "💊" : "⏸"} ${esc(m.name)} — ${esc(m.dose)} | ${m.times.map((t) => toFa(t)).join("، ")} | ${daysLabel(m.days)}${m.end_date ? ` | تا ${m.end_date}` : ""}`,
  medMenu: "داروی انتخاب‌شده:",
  btnPauseMed: "⏸ توقف دارو",
  btnResumeMed: "▶️ ادامهٔ دارو",
  btnDeleteMed: "🗑 حذف دارو",
  btnEditMedName: "نام", btnEditMedDose: "دوز", btnEditMedTimes: "ساعت‌ها",
  btnEditMedDays: "روزها", btnEditMedEnd: "پایان", btnEditMedNote: "یادداشت",
  medUpdated: "✅ به‌روزرسانی شد (فقط برای یادآوری‌های بعدی).",
  medDeleted: "🗑 دارو حذف شد.",
  confirmDeleteMedQ: "این دارو و سابقهٔ مصرفش حذف شود؟",
  inviteExisting: "⚠️ این فرد قبلاً متصل شده است. با ساخت لینک جدید، اگر فرد با حساب دیگری وصل شود حساب قبلی جایگزین می‌شود. ادامه؟",
  inviteCreated: (url: string) =>
    `🔗 لینک دعوت (۷۲ ساعت اعتبار، فقط یک‌بار قابل استفاده):\n${url}\n\nاین لینک دیگر نمایش داده نمی‌شود. لینک‌های قبلی این فرد باطل شدند.`,
  btnRevoke: "🚫 ابطال لینک‌ها",
  inviteRevoked: "🚫 لینک‌های فعال باطل شد.",
  inviteNone: "لینک فعالی وجود نداشت.",
  deletePersonAsk: (name: string) => `🗑 «${esc(name)}» و همهٔ داروها و سابقه‌اش برای همیشه حذف شود؟`,
  deletePersonFinal: (name: string) => `آخرین تأیید: حذف دائمی «${esc(name)}»؟`,
  deletePersonDone: "🗑 حذف شد.",
  yesDelete: "بله، حذف کن",
  nameUpdated: "✅ نام به‌روز شد.",
  tzUpdated: "✅ منطقهٔ زمانی به‌روز شد.",
  notifyConnected: (name: string) => `✅ ${esc(name)} متصل شد.`,
  notifyDeclined: (name: string) => `❌ ${esc(name)} شرایط را قبول نکرد. لینک هنوز معتبر است.`,
  notifyBlocked: (name: string) => `🚫 ${esc(name)} ربات را بلاک کرد؛ یادآوری‌ها متوقف شد.`,
  notifyDeleted: (name: string) => `🗑 ${esc(name)} همهٔ اطلاعات خود را پاک کرد.`,
  notifyStale: (name: string, n: number) =>
    `⚠️ ${toFa(n)} دوز ${esc(name)} به‌دلیل تأخیر سیستم ارسال نشد (مدت زیادی گذشته بود).`,
  notifyCronQuiet: (min: number) => `🚨 زمان‌بند یادآوری ${toFa(min)} دقیقه است اجرا نشده. بررسی کنید.`,
  reportTitle: (name: string) => `📊 <b>گزارش ${esc(name)}</b>`,
  reportRange: (label: string, taken: number, skipped: number, missed: number, pct: string) =>
    `${label}: ✅ ${toFa(taken)}  ✗ ${toFa(skipped)}  ⌛ ${toFa(missed)}  — ${pct}`,
  rToday: "امروز", r7: "۷ روز", r30: "۳۰ روز",
  noData: "—",
  statusText: (s: { lastCron: string; sentToday: number; failedToday: number; pending: number; people: number }) =>
    `ℹ️ <b>وضعیت</b>\nآخرین اجرای زمان‌بند: ${s.lastCron}\nارسال امروز: ${toFa(s.sentToday)}\nخطای ارسال امروز: ${toFa(s.failedToday)}\nدوزهای در انتظار پاسخ: ${toFa(s.pending)}\nافراد فعال: ${toFa(s.people)}`,
  cronNever: "هیچ‌وقت",
  unknownCmd: "متوجه نشدم. /help",
  error: "خطایی رخ داد. دوباره تلاش کنید.",
};

export function daysLabel(days: number[]): string {
  if (days.length === 7) return "هر روز";
  return DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join("، ");
}
