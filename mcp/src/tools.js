// ═══════════════════════════════════════════════════════════════════════════
// الأدوات — ما يقدر المساعد أن يسأل عنه، وما يقدر أن يغيّره
// ═══════════════════════════════════════════════════════════════════════════
// Two groups, and the line between them matters more than the count.
//
// READS answer questions. They are computed by the app's own report modules,
// so an answer here and a screen in the app cannot disagree.
//
// WRITES all go through `callServer`, which is `httpsCallable` — the same door
// the app uses. Not one of them writes to the ledger directly. That is not
// caution for its own sake: balance, period derivation, closed-period refusal,
// atomic numbering, the posting lock and the audit record all live in that
// transaction, and a write that skipped it would skip every one of them.
//
// ── الحدّ الذي لا تسدّه أي بوابة ──
// The rules stop an UNBALANCED entry. Nothing stops a BALANCED WRONG one. An
// invoice read as 304 instead of 340 produces an entry that is legal,
// arithmetically sound and factually false, and it passes every gate here
// because they check consistency, not truth. Hence: every write echoes back
// what it wrote — entry number, id, amounts — so the transcript itself is a
// record to check, and `sweater_reverse_entry` is a first-class tool rather
// than an afterthought.
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { connect, callServer, readOnly, SweaterMcpError } from './client.js';
import { collection, addDoc } from 'firebase/firestore';
import { COL, OPERATIONAL, rows, row, ledgerBundle, lockId, feeRulesMapped } from './fetch.js';
import { resolvePeriod, previousPeriod, todayInfo, PERIOD_TOKENS } from './periods.js';
import {
  compactIncome, compactTrialBalance, compactBalanceSheet, compactEntry, compactRecord,
  accountRows, balanceOf, matchesQuery,
} from './shape.js';

import {
  trialBalance, incomeStatement, balanceSheet, generalLedger,
} from '../../src/lib/accounting/reports.js';
import { buildVatReport, currentPeriodKey } from '../../src/lib/accounting/vatReturn.js';
import { DEFAULT_CHART_OF_ACCOUNTS, indexAccounts, ACC } from '../../src/lib/accounting/chartOfAccounts.js';
import { taxPolicyAt } from '../../src/lib/accounting/taxPolicy.js';
import { startupRollup } from '../../src/lib/accounting/startupMigration.js';
import { validateTaxInvoiceFields, VAT_PROBLEM } from '../../src/lib/vatFields.js';
import { resolvePurchaseTax, PurchaseTaxError } from '../../src/lib/accounting/purchaseTax.js';

/**
 * المجموعات الوحيدة التي يجوز لهذا الخادم أن ينشئ فيها مستنداً **مباشرةً**.
 *
 * تشغيلية بحتة، تسمح بها `firestore.rules` لدور `operator` فما فوق — أي أن
 * الكتابة هنا لا تتجاوز شيئاً، بل تفعل ما يفعله التطبيق حرفياً. ولا مجموعة
 * دفترية واحدة فيها: القيود والأقفال والعدّادات والفترات وسجل التدقيق كلها
 * `allow write: if false`، ولا يصلها إلا الخادم الموثوق عبر `callServer`.
 *
 * مُصدَّرة ليفحصها اختبار: إضافة اسم دفتري هنا تُسقطه.
 */
export const DIRECT_WRITE_COLLECTIONS = {
  variable: 'variable_expenses',
  monthly: 'monthly_expenses',
  annual: 'annual_expense_entries',
};

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ بصيغة YYYY-MM-DD');
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });

const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);
// تاريخ السجل مهما كانت مجموعته: كانت القائمة تعرف أربعة أسماء، فمرشّح
// التاريخ على الغسلات (`wash_date`) والمصروفات (`logged_date`) لم يعمل يوماً.
const dateOf = (r) => String(
  r.date || r.entryDate || r.wash_date || r.logged_date || r.spent_date || r.payment_date
  || r.paid_date || r.issue_date || r.invoice_date || r.expense_date || r.start_date || r.created_at || '',
).slice(0, 10);

/** فترةٌ بلغة الإنسان — كل أدوات القراءة تقبلها بنفس المفردات. */
const PERIOD = z.string().optional().describe(
  `الفترة: this_month · last_month · 2026-08 · 2026 · 2026-Q3 · last_3_months · ytd · all. (${PERIOD_TOKENS.length} كلمة، أو مفتاح شهر/سنة/ربع)`,
);
const withMeta = (period, body) => ({ اليوم: todayInfo().today, الفترة: period?.label ?? null, ...body });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ─── القراءة ─────────────────────────────────────────────────────────────

export const readTools = [
  {
    name: 'sweater_whoami',
    title: 'من أنا في هذا النظام',
    description:
      'يعرض الحساب الذي يعمل به هذا الخادم ودوره كما تقرؤه قواعد الأمان، وهل هو في وضع القراءة فقط. '
      + 'ابدأ به عند أي شك في الصلاحيات — الدور هنا هو ما سيُطبَّق فعلاً، لا ما هو مفترض.',
    schema: {},
    async run() {
      const { uid, email, role } = await connect();
      const t = todayInfo();
      return text({
        اليوم: t.today, الشهر_الحالي: t.currentMonth, التاريخ: t.label,
        email, uid, role,
        mode: readOnly ? 'قراءة فقط' : 'قراءة وكتابة',
        canPostLedger: ['admin', 'accountant'].includes(role),
        canReopenPeriod: role === 'admin',
        ابدأ_بـ: 'sweater_overview لأي سؤالٍ عام، وsweater_search للبحث عن سجلٍ بعينه.',
      });
    },
  },
  {
    name: 'sweater_report',
    title: 'التقارير المالية',
    description:
      'قائمة الدخل أو ميزان المراجعة أو المركز المالي، من القيود المُرحّلة بنفس دوال التطبيق — الأرقام '
      + 'مطابقة للشاشة. الفترة بـ `period` (this_month · last_month · 2026-08 · 2026 · 2026-Q3 · ytd · all)؛ '
      + 'قائمة الدخل بلا فترة = هذا الشهر، والميزان والمركز بلا فترة = كل الدفاتر. `asOf` للمركز المالي '
      + 'حتى تاريخ. للسؤال العام استعمل sweater_overview أولاً.',
    schema: {
      report: z.enum(['trial_balance', 'income_statement', 'balance_sheet']),
      period: PERIOD,
      from: ISO.optional(), to: ISO.optional(), asOf: ISO.optional(),
    },
    async run({ report, period, from = null, to = null, asOf = null }) {
      const [{ accounts, entries, lines }, feeRules] = await Promise.all([ledgerBundle(), feeRulesMapped()]);
      if (report === 'balance_sheet') {
        const bs = balanceSheet(accounts, entries, lines, { asOf, feeRules });
        return text(withMeta({ label: asOf ? `حتى ${asOf}` : 'حتى اليوم' }, { المركز_المالي: compactBalanceSheet(bs) }));
      }
      const p = resolvePeriod({ period, from, to }, { fallback: report === 'income_statement' ? 'this_month' : 'all' });
      if (report === 'trial_balance') {
        const tb = trialBalance(accounts, entries, lines, { from: p.from, to: p.to });
        return text(withMeta(p, { ميزان_المراجعة: compactTrialBalance(tb) }));
      }
      const is = incomeStatement(accounts, entries, lines, { from: p.from, to: p.to, feeRules });
      const body = compactIncome(is);
      return text(withMeta(p, {
        قائمة_الدخل: body,
        تنبيه: body.hasActivity ? undefined : 'لا قيود مُرحّلة في هذه الفترة — افحص sweater_unposted أو اختر فترةً أخرى.',
      }));
    },
  },
  {
    name: 'sweater_overview',
    title: 'نظرة عامة — كيف وضعنا؟',
    description:
      'الردّ الواحد لأي سؤالٍ عام: الإيرادات والمصروفات وصافي الربح للفترة (مع مقارنةٍ بالفترة السابقة)، '
      + 'عدد الغسلات المكتملة، النقد في الصندوق والبنك، الذمم والموردون، ضريبة المخرجات والمدخلات، '
      + 'الشركاء ورأس مالهم، البايكرز، وما لم يُرحَّل بعد. ابدأ به دائماً. الفترة بـ `period`، '
      + 'وافتراضياً هذا الشهر.',
    schema: { period: PERIOD },
    async run({ period } = {}) {
      const p = resolvePeriod({ period });
      const prev = previousPeriod(p);
      const [{ accounts, entries, lines, periods }, feeRules, washes, partners, payments, bikers, locks] = await Promise.all([
        ledgerBundle(), feeRulesMapped(), rows('washes'), rows('partners'), rows('partner_payments'),
        rows('bikers').catch(() => []), rows(COL.LOCKS),
      ]);

      const is = incomeStatement(accounts, entries, lines, { from: p.from, to: p.to, feeRules });
      const prevIs = prev ? incomeStatement(accounts, entries, lines, { from: prev.from, to: prev.to, feeRules }) : null;
      const delta = (a, b) => (prevIs ? r2(a - b) : null);

      const tb = trialBalance(accounts, entries, lines, { to: p.to });
      const inP = (w) => inRange(String(w.wash_date || '').slice(0, 10), p.from, p.to);
      const done = washes.filter((w) => w.status === 'مكتملة' && inP(w));
      const washCount = done.reduce((s, w) => s + (Number(w.quantity) || 0), 0);
      const washGross = r2(done.reduce((s, w) => s + (Number(w.quantity) || 0) * (Number(w.price) || 0), 0));

      const lockSet = new Set(locks.map((l) => l.id));
      const kinds = {
        wash: 'washes', monthly_expense: 'monthly_expenses', variable_expense: 'variable_expenses',
        annual_expense: 'annual_expense_entries', partner_payment: 'partner_payments', temporary_expense: 'temporary_expenses',
      };
      const unposted = {};
      let unpostedCount = 0;
      for (const [kind, coll] of Object.entries(kinds)) {
        const list = kind === 'wash' ? washes : (kind === 'partner_payment' ? payments : await rows(coll));
        const n = list.filter((r) => !lockSet.has(lockId(kind, r.id)) && inRange(dateOf(r), p.from, p.to)).length;
        if (n) { unposted[kind] = n; unpostedCount += n; }
      }

      const today = todayInfo().today;
      const activeBikers = bikers.filter((b) => !b.end_date || String(b.end_date) > today).length;
      const totalWorkers = partners.reduce((s, x) => s + (Number(x.workers_count) || 0), 0);
      const paidCapital = r2(payments.reduce((s, x) => s + (Number(x.amount) || 0), 0));
      const periodStatus = p.months.map((k) => {
        const doc = periods.find((x) => (x.periodKey ?? x.id) === k);
        return { month: k, status: doc ? (doc.status === 'closed' ? 'مُقفَل (نهائي)' : 'مفتوح (مبدئي)') : 'لا قيود' };
      });

      return text(withMeta(p, {
        النتيجة: {
          الإيرادات: r2(is.totalRevenue), التكاليف_المباشرة: r2(is.totalCost), المصروفات_التشغيلية: r2(is.totalExpenses),
          الرسوم: r2(is.totalFees), صافي_الربح: r2(is.netProfit),
          مقارنةً_بـ: prev ? { الفترة: prev.label, فرق_الإيرادات: delta(is.totalRevenue, prevIs.totalRevenue), فرق_صافي_الربح: delta(is.netProfit, prevIs.netProfit) } : null,
          أكبر_المصروفات: accountRows([...is.costOfServices, ...is.expenses]).slice(0, 5),
          hasActivity: is.revenue.length + is.costOfServices.length + is.expenses.length > 0,
        },
        الغسلات: { مكتملة: washCount, صفوف: done.length, إجمالي_المبيعات_بالسجل: washGross, ملاحظة: 'من سجل الغسلات التشغيلي؛ إيرادات الدفاتر في «النتيجة».' },
        النقد_والذمم_حتى_نهاية_الفترة: {
          الصندوق: balanceOf(tb, ACC.CASH), البنك: balanceOf(tb, ACC.BANK),
          العملاء: r2(balanceOf(tb, ACC.RECEIVABLE) + balanceOf(tb, ACC.SWEATER_RECEIVABLE)), الموردون: balanceOf(tb, ACC.PAYABLE, 'credit'),
          ضريبة_مخرجات_مستحقة: balanceOf(tb, ACC.OUTPUT_VAT, 'credit'), ضريبة_مدخلات_قابلة_للاسترداد: balanceOf(tb, ACC.INPUT_VAT),
        },
        الشركاء: { العدد: partners.length, مجموع_العمالة: totalWorkers, رأس_المال_المسدَّد: paidCapital },
        البايكرز: { النشطون: activeBikers, الكل: bikers.length },
        غير_المرحَّل_في_الفترة: { العدد: unpostedCount, بالنوع: unposted, تنبيه: unpostedCount ? 'سجلاتٌ لم تدخل الدفاتر — التقرير أعلاه ناقصٌ بقدرها. sweater_unposted للتفصيل.' : null },
        حال_الأشهر: periodStatus,
      }));
    },
  },
  {
    name: 'sweater_search',
    title: 'بحث في السجلات',
    description:
      'يبحث بكلمةٍ أو رقمٍ أو مبلغ في كل المجموعات التشغيلية معاً — الغسلات والمصروفات والسندات والشركاء '
      + 'والبايكرز والفواتير — ويُرجع النتائج مضغوطةً مع المجموعة والمعرّف. استعمله بدل تفريغ مجموعةٍ كاملة: '
      + '«فاتورة المورد الفلاني»، «مبلغ 1150»، «سلفة أحمد». `collection` لتضييق البحث، و`period` للفترة.',
    schema: {
      query: z.string().min(1),
      collection: z.enum(OPERATIONAL).optional(),
      period: PERIOD,
      limit: z.number().int().min(1).max(100).optional(),
    },
    async run({ query, collection: only, period, limit = 30 }) {
      const p = period ? resolvePeriod({ period }) : null;
      const SEARCHABLE = ['washes', 'monthly_expenses', 'variable_expenses', 'annual_expense_entries',
        'temporary_expenses', 'partner_payments', 'partners', 'bikers', 'expense_vouchers', 'fixed_assets'];
      const targets = only ? [only] : SEARCHABLE;
      const hits = [];
      for (const name of targets) {
        const list = await rows(name).catch(() => []);
        for (const r of list) {
          if (p && !inRange(dateOf(r), p.from, p.to)) continue;
          if (!matchesQuery(r, query)) continue;
          hits.push({ collection: name, ...compactRecord(name, r) });
        }
      }
      hits.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      return text(withMeta(p, {
        query, count: hits.length, results: hits.slice(0, limit),
        تلميح: hits.length ? 'لمعرفة إن كان السجل مُرحَّلاً: sweater_unposted، أو sweater_journal_entries بالمصدر.' : 'لا نتائج — جرّب كلمةً أقصر أو مجموعةً أخرى.',
      }));
    },
  },
  {
    name: 'sweater_vat_report',
    title: 'تقرير ضريبة القيمة المضافة',
    description:
      'ضريبة المخرجات والمدخلات لفترة إقرار، مع الفواتير المؤهَّلة وغير المؤهَّلة وسببَ كل استبعاد. '
      + 'اترك `period` فارغاً للفترة الحالية. صيغة الفترة الربعية: 2026-Q1.',
    schema: { period: z.string().optional(), filing: z.enum(['monthly', 'quarterly']).optional() },
    async run({ period = '', filing = 'quarterly' }) {
      const key = period || currentPeriodKey(filing);
      const { entries, lines } = await ledgerBundle();
      const [washes, monthly, variable, annual, vouchers, settings] = await Promise.all([
        rows('washes'), rows('monthly_expenses'), rows('variable_expenses'),
        rows('annual_expense_entries'), rows('expense_vouchers'),
        row(COL.SETTINGS, 'accounting').catch(() => null),
      ]);
      // `taxPolicyAt(date, settings)` — the settings document whole, not just
      // the history array: it also carries the CURRENT policy, which is what
      // answers a date the history does not cover.
      return text(buildVatReport({
        inputs: [...monthly, ...variable, ...annual, ...vouchers],
        washes, entries, lines, period: key, filing,
        policyAt: (d) => taxPolicyAt(d, settings || {}),
      }));
    },
  },
  {
    name: 'sweater_general_ledger',
    title: 'دفتر أستاذ حساب',
    description:
      'حركة حسابٍ واحد بالتفصيل مع الرصيد الجاري. `account` رقم الحساب (1010 الصندوق · 1020 البنك · 4000 الإيرادات …) '
      + '— sweater_chart_of_accounts يعرض الأرقام. الفترة بـ `period`، وافتراضياً كل الدفاتر.',
    schema: { account: z.string(), period: PERIOD, from: ISO.optional(), to: ISO.optional() },
    async run({ account, period, from = null, to = null }) {
      const { accounts, entries, lines } = await ledgerBundle();
      const acc = accounts.find((a) => String(a.code) === String(account)) || null;
      if (!acc) {
        // ربما سمّاه المستخدم لا رقّمه: «الصندوق»، «البنك».
        const byName = accounts.filter((a) => String(a.nameArabic || '').includes(String(account)));
        throw new SweaterMcpError(
          `لا يوجد حساب برقم ${account} في دليل الحسابات.`
          + (byName.length ? ` أتقصد: ${byName.map((a) => `${a.code} ${a.nameArabic}`).join(' · ')}؟` : ' استعمل sweater_chart_of_accounts لرؤية الأرقام.'),
        );
      }
      const p = resolvePeriod({ period, from, to }, { fallback: 'all' });
      const gl = generalLedger(account, entries, lines, { from: p.from, to: p.to, account: acc });
      const movements = (gl.rows || gl.movements || gl.lines || []).map((m) => ({
        date: m.entryDate ?? m.date, entry: m.entryNumber ?? m.entryId ?? null,
        description: String(m.description || '').slice(0, 120),
        debit: r2(m.debit) || undefined, credit: r2(m.credit) || undefined, balance: r2(m.balance ?? m.running),
      }));
      return text(withMeta(p, {
        الحساب: `${acc.code} ${acc.nameArabic}`, النوع: acc.accountType,
        الرصيد_الافتتاحي: r2(gl.opening ?? gl.openingBalance), الرصيد_الختامي: r2(gl.closing ?? gl.closingBalance ?? gl.balance),
        عدد_الحركات: movements.length, الحركات: movements.slice(-100),
      }));
    },
  },
  {
    name: 'sweater_journal_entries',
    title: 'القيود',
    description:
      'قيود اليومية بسطورها (الحساب بالاسم، مدين/دائن)، بفلترة الفترة والحالة ونوع المصدر وكلمة بحث. '
      + 'استعمله للتحقق مما تغيّر قبل أي تصحيح، وللحصول على `entryId` اللازم للعكس. الفترة بـ `period`، '
      + 'وافتراضياً هذا الشهر؛ `query` تبحث في الوصف والمصدر.',
    schema: {
      period: PERIOD, from: ISO.optional(), to: ISO.optional(),
      status: z.enum(['posted', 'reversed']).optional(),
      sourceKind: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async run({ period, from = null, to = null, status = null, sourceKind = null, query = null, limit = 20 }) {
      const p = resolvePeriod({ period, from, to });
      const { accounts, entries } = await ledgerBundle();
      const index = indexAccounts(accounts);
      const q = String(query || '').toLowerCase();
      // `entryDate` هو اسم الحقل الذي يكتبه الخادم؛ الترشيح على `date` وحده لم
      // يطابق قيداً واحداً يوماً — فكانت الأداة تُرجع كل شيء أو لا شيء.
      const all = entries
        .filter((e) => inRange(dateOf(e), p.from, p.to))
        .filter((e) => !status || e.status === status)
        .filter((e) => !sourceKind || e.sourceKind === sourceKind || e.sourceType === sourceKind)
        .filter((e) => !q || `${e.description || ''} ${e.sourceType || ''} ${e.sourceId || ''} ${e.entryNumber || ''}`.toLowerCase().includes(q))
        .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || (Number(b.entryNumber) || 0) - (Number(a.entryNumber) || 0));
      return text(withMeta(p, {
        matched: all.length, shown: Math.min(all.length, limit),
        entries: all.slice(0, limit).map((e) => compactEntry(e, index)),
        تلميح: all.length > limit ? `عُرض أول ${limit} من ${all.length}؛ ضيّق بالفترة أو بـ query أو ارفع limit.` : undefined,
      }));
    },
  },
  {
    name: 'sweater_records',
    title: 'السجلات التشغيلية',
    description:
      `سجلات مجموعةٍ تشغيلية بفترة، مضغوطةً ومقروءة (اسم، مبلغ، تاريخ، حالة): ${OPERATIONAL.join('، ')}. `
      + 'هذه البيانات الخام قبل الترحيل. الفترة بـ `period` (افتراضياً هذا الشهر؛ `all` لكل شيء)، '
      + 'و`query` لكلمةٍ أو مبلغ. للبحث عبر المجموعات كلها استعمل sweater_search.',
    schema: {
      collection: z.enum(OPERATIONAL),
      period: PERIOD, from: ISO.optional(), to: ISO.optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(300).optional(),
    },
    async run({ collection: name, period, from = null, to = null, query = null, limit = 50 }) {
      // الشركاء والبايكرز والسكن سجلاتٌ بلا تاريخ تشغيلي — الفترة لا تعنيهم.
      const dateless = ['partners', 'bikers', 'housing_units', 'categories', 'fixed_assets', 'sweater_price_list'].includes(name);
      const p = dateless ? null : resolvePeriod({ period, from, to });
      const all = await rows(name);
      const out = all
        .filter((r) => !p || inRange(dateOf(r), p.from, p.to))
        .filter((r) => !query || matchesQuery(r, query))
        .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
      const amountOf = (r) => Number(r.amount ?? r.total_monthly_cost ?? r.total_variable_cost ?? ((Number(r.quantity) || 0) * (Number(r.price) || 0))) || 0;
      return text(withMeta(p, {
        collection: name, matched: out.length, total: all.length, shown: Math.min(out.length, limit),
        مجموع_المبالغ: r2(out.reduce((s, r) => s + amountOf(r), 0)),
        rows: out.slice(0, limit).map((r) => compactRecord(name, r)),
      }));
    },
  },
  {
    name: 'sweater_unposted',
    title: 'غير المُرحَّل',
    description:
      'السجلات التي لم تدخل الدفاتر بعد — لا يوجد لها قفل ترحيل. هذه هي الفجوة بين ما حدث فعلاً وما تقوله '
      + 'التقارير، فافحصها قبل أن تثق برقمٍ في قائمة الدخل.',
    schema: { limit: z.number().int().min(1).max(300).optional() },
    async run({ limit = 100 }) {
      const locks = new Set((await rows(COL.LOCKS)).map((l) => l.id));
      const kinds = {
        wash: 'washes', monthly_expense: 'monthly_expenses',
        variable_expense: 'variable_expenses', annual_expense: 'annual_expense_entries',
        partner_payment: 'partner_payments', temporary_expense: 'temporary_expenses',
      };
      const out = [];
      for (const [kind, coll] of Object.entries(kinds)) {
        for (const r of await rows(coll)) {
          if (locks.has(lockId(kind, r.id))) continue;
          const c = compactRecord(coll, r);
          out.push({
            kind, collection: coll, id: r.id, date: dateOf(r) || null,
            amount: r2(c.total ?? c.amount ?? 0),
            description: c.name || c.title || c.description || c.biker || c.notes || '',
            postWith: `sweater_post_source kind="${kind}" sourceId="${r.id}"`,
          });
        }
      }
      out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const byKind = {};
      for (const u of out) {
        byKind[u.kind] = byKind[u.kind] || { count: 0, total: 0 };
        byKind[u.kind].count += 1; byKind[u.kind].total = r2(byKind[u.kind].total + u.amount);
      }
      return text(withMeta(null, {
        count: out.length, total: r2(out.reduce((s, u) => s + u.amount, 0)), byKind,
        unposted: out.slice(0, limit),
        ملاحظة: out.length ? 'كل سجلٍ هنا غائبٌ عن التقارير حتى يُرحَّل. المصروفات الشهرية المتكررة تُرحَّل شهرياً فظهورها هنا طبيعي حتى يحين يومها.' : 'كل السجلات مُرحّلة — التقارير تعكس كل ما سُجّل.',
      }));
    },
  },
  {
    name: 'sweater_chart_of_accounts',
    title: 'دليل الحسابات',
    description:
      'دليل الحسابات مجمّعاً بالنوع (أصول، التزامات، حقوق ملكية، إيرادات، مصروفات) بالرقم والاسم — '
      + 'لتعرف رقم الحساب قبل sweater_general_ledger. إن كان فارغاً فالدفاتر لم تُفتح بعد.',
    schema: {},
    async run() {
      const accounts = await rows(COL.ACCOUNTS);
      const TYPE_AR = { asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات' };
      const grouped = {};
      for (const a of [...accounts].sort((x, y) => String(x.code).localeCompare(String(y.code)))) {
        const k = TYPE_AR[a.accountType] || a.accountType;
        (grouped[k] = grouped[k] || []).push(`${a.code} ${a.nameArabic}${a.active === false ? ' (موقوف)' : ''}`);
      }
      return text({
        seeded: accounts.length > 0,
        count: accounts.length,
        accounts: accounts.length ? grouped : undefined,
        hint: accounts.length ? undefined
          : `دليل الحسابات فارغ. استعمل sweater_seed_chart لتهيئته (${DEFAULT_CHART_OF_ACCOUNTS.length} حساباً افتراضياً).`,
      });
    },
  },
  {
    name: 'sweater_startup_costs',
    title: 'رسوم التأسيس',
    description:
      'خطط رسوم التأسيس: الموازنة والمصروف الفعلي المحسوب من بنود الصرف — لا من الحقل المخزَّن على الأب — '
      + 'والحالة المشتقة، مع آخر بنود الصرف لكل خطة. للفرق بين المخزَّن والمحسوب دلالةٌ على خطةٍ قديمة.',
    schema: {},
    async run() {
      const [parents, entries] = await Promise.all([rows(COL.STARTUP), rows(COL.STARTUP_ENTRIES)]);
      return text(parents.map((p) => {
        const mine = entries.filter((e) => e.startup_cost_id === p.id);
        // `startupRollup` takes AMOUNTS, and re-deriving here rather than
        // trusting `actual_amount` is the point: showing both side by side is
        // how a parent still carrying legacy spend gives itself away.
        const rolled = startupRollup(mine.map((e) => e.amount), p.budgeted_amount);
        return {
          id: p.id, name: p.name || p.itemName, budgeted: p.budgeted_amount,
          stored_actual: p.actual_amount, computed_actual: rolled.actualAmount,
          stored_status: p.status, derived_status: rolled.status,
          entriesCount: mine.length,
          entries: mine.slice(0, 20).map((e) => ({ id: e.id, date: e.spent_date ?? null, amount: r2(e.amount), description: e.description || '' })),
        };
      }));
    },
  },
];

// ─── الكتابة ─────────────────────────────────────────────────────────────
// Every one of these is a thin call to the trusted server. The thinness is the
// point: there is no logic here that could disagree with the app's.

export const writeTools = [
  {
    name: 'sweater_record_expense',
    title: 'تسجيل مصروف من فاتورة',
    description:
      'يسجّل مصروفاً جديداً — مثلاً من فاتورة صوّرها المستخدم. **يعرض أولاً ولا يكتب**: '
      + 'بلا `confirm: true` يُرجع ما سيُكتب بالضبط ومعاملته الضريبية، فيراجعه المستخدم. '
      + 'اعرض عليه المبلغ والتاريخ والمورّد ورقم الفاتورة والضريبة، واطلب تأكيده صراحةً، ثم أعد '
      + 'النداء بـ `confirm: true`. لا تؤكّد نيابةً عنه أبداً. '
      + 'kind: variable (شراء عادي) · monthly (فاتورة متكررة) · annual (بند سنوي).',
    schema: {
      kind: z.enum(['variable', 'monthly', 'annual']),
      description: z.string().min(2),
      amount: z.number().positive(),
      date: ISO,
      confirm: z.boolean().optional(),
      paymentMethod: z.enum(['cash', 'bank', 'credit']).optional(),
      category: z.string().optional(),
      // ── كتلة الفاتورة الضريبية ──
      // اتركها فارغة إن لم تكن فاتورة ضريبية. لا تخترع رقم ضريبي ولا نسبة:
      // الخادم يرفض افتراض 15% ويقول إن الضريبة غير قابلة للخصم، وهذا أصدق
      // من خصمٍ لا يسنده مستند.
      isTaxInvoice: z.boolean().optional(),
      supplier: z.string().optional(),
      invoiceNumber: z.string().optional(),
      invoiceDate: ISO.optional(),
      vatAmount: z.number().optional(),
      vatRate: z.number().optional(),
      priceMode: z.enum(['inclusive', 'exclusive']).optional(),
    },
    async run(a) {
      // لا `connect()` هنا: المعاينة لا تكتب شيئاً، فلا تحتاج قاعدة بيانات —
      // والاتصال يأتي عند الكتابة وحدها، أدناه.
      const coll = DIRECT_WRITE_COLLECTIONS[a.kind];
      const amountField = { variable: 'total_variable_cost', monthly: 'total_monthly_cost', annual: 'amount' }[a.kind];

      const row = {
        [amountField]: a.amount,
        description: a.description,
        logged_date: a.date,
        ...(a.kind === 'annual' ? { paid_date: a.date } : {}),
        ...(a.category ? { category: a.category } : {}),
        payment_method: a.paymentMethod || 'cash',
        is_tax_invoice: a.isTaxInvoice === true,
        supplier: a.supplier ?? null,
        invoice_number: a.invoiceNumber ?? null,
        invoice_date: a.invoiceDate ?? null,
        // `?? null` لا `|| null`: صفرٌ صريح إجابة حقيقية — توريد معفى أو
        // بنسبة صفر — و`||` كان سيمحوها إلى «غير مذكورة».
        vat_amount: a.vatAmount ?? null,
        vat_rate: a.vatRate ?? null,
        price_mode: a.priceMode || 'inclusive',
        created_at: new Date().toISOString(),
      };

      // ما يقوله المحرّك عن هذي الفاتورة قبل أن تُكتب: هل تدخل ضريبة المدخلات
      // أصلاً، ولماذا لا. نفس المحرّك الذي سيقرّر لحظة الترحيل، لا تخمين موازٍ.
      let tax;
      try {
        const r = resolvePurchaseTax({
          amount: a.amount, isTaxInvoice: row.is_tax_invoice, vatDeductible: true,
          invoiceNumber: row.invoice_number, invoiceDate: row.invoice_date,
          supplier: row.supplier, vatAmount: row.vat_amount, vatRate: row.vat_rate,
          priceMode: row.price_mode, recordDate: a.date,
        });
        tax = { net: r.net, vat: r.vat, gross: r.gross, deductible: r.deductible, reason: r.noInputVatReason || null };
      } catch (e) {
        // **فقط** رفض المحرّك المتعمَّد يُبتلع هنا. أول صياغة ابتلعت كل شيء،
        // فحوّلت `resolvePurchaseTax is not defined` — خطأ برمجي محض — إلى
        // «غير قابلة للخصم»: جوابٌ محاسبي معقول المظهر، كان سيمرّ بصمت ويترك
        // كل فاتورة بلا خصم بسببٍ يبدو مشروعاً. العطب الذي يلبس ثوب النتيجة
        // أخطر من العطب الذي ينهار.
        if (!(e instanceof PurchaseTaxError)) throw e;
        tax = { deductible: false, refused: e.message, reason: e.reason || null };
      }

      const problems = validateTaxInvoiceFields({
        isTaxInvoice: row.is_tax_invoice, supplier: row.supplier,
        invoiceNumber: row.invoice_number, invoiceDate: row.invoice_date,
        vatAmount: row.vat_amount, vatRate: row.vat_rate, priceMode: row.price_mode,
      }, { amount: a.amount }).filter((p) => p.severity === VAT_PROBLEM.BLOCKING);

      if (problems.length) {
        throw new SweaterMcpError(
          `لا يمكن تسجيلها كفاتورة ضريبية: ${problems.map((p) => p.message).join(' · ')}`,
          { code: 'invalid-argument' },
        );
      }

      if (a.confirm !== true) {
        return text({
          preview: true,
          سيُكتب_في: coll,
          البيانات: row,
          المعاملة_الضريبية: tax,
          تنبيه: 'لم يُكتب شيء بعد. اعرض هذي الأرقام على المستخدم واطلب تأكيده، '
            + 'ثم أعد النداء بـ confirm: true. لا تؤكّد نيابةً عنه.',
        });
      }

      const { db } = await connect();
      const ref = await addDoc(collection(db, coll), row);
      return text({
        created: true, id: ref.id, collection: coll,
        المعاملة_الضريبية: tax,
        التالي: `سجّل المصروف. لترحيله إلى الدفاتر: sweater_post_source بـ kind='${a.kind}' و sourceId='${ref.id}'.`,
      });
    },
  },
  {
    name: 'sweater_post_source',
    title: 'ترحيل سجل إلى الدفاتر',
    description:
      'يرحّل غسلة أو مصروفاً أو دفعة شريك إلى دفتر اليومية. الخادم يبني القيد من السجل نفسه — '
      + 'لا تُرسل مبالغ ولا حسابات، فهو لا يقبلها. مثال kind: wash · monthly_expense · variable_expense.',
    schema: { kind: z.string(), sourceId: z.string() },
    run: ({ kind, sourceId }) => callServer('ledgerPostSource', { kind, sourceId }).then(text),
  },
  {
    name: 'sweater_reverse_entry',
    title: 'عكس قيد',
    description:
      'يعكس قيداً بقيدٍ مضاد. هذا هو التصحيح الصحيح محاسبياً — لا يُحذف شيء ويبقى الأثر كاملاً. '
      + '`entryDate` مطلوب حين تكون فترة القيد الأصلي مقفلة، فيُعكس في فترة مفتوحة.',
    schema: { entryId: z.string(), entryDate: ISO.optional(), description: z.string().optional() },
    run: (a) => callServer('ledgerReverseEntry', a).then(text),
  },
  {
    name: 'sweater_close_period',
    title: 'إقفال فترة',
    description: 'يقفل شهراً فلا يقبل قيداً جديداً بتاريخه. صيغة المفتاح: 2026-08.',
    schema: { periodKey: z.string().regex(/^\d{4}-\d{2}$/) },
    run: (a) => callServer('ledgerClosePeriod', a).then(text),
  },
  {
    name: 'sweater_reopen_period',
    title: 'إعادة فتح فترة',
    description:
      'يعيد فتح شهر مقفل. يغيّر ما تقوله فترة سبق إقفالها، فهو للمدير وحده ويحتاج سبباً مكتوباً.',
    schema: { periodKey: z.string().regex(/^\d{4}-\d{2}$/), reason: z.string().min(3) },
    run: (a) => callServer('ledgerReopenPeriod', a).then(text),
  },
  {
    name: 'sweater_issue_document',
    title: 'إصدار مستند ضريبي',
    description:
      'فاتورة أو إشعار دائن/مدين. الرقم والتسلسل وهوية البائع كلها من الخادم، والإجماليات تُعاد حوسبتها '
      + 'من السطور — فما تُرسله من إجماليات يُتجاهل.',
    schema: {
      type: z.enum(['invoice', 'credit_note', 'debit_note']),
      washId: z.string().optional(),
      customerName: z.string().optional(),
      issueDate: ISO.optional(), supplyDate: ISO.optional(),
      lines: z.array(z.object({
        description: z.string(), quantity: z.number(), unitPrice: z.number(),
      })).optional(),
      relatedDocumentId: z.string().optional(), reason: z.string().optional(),
    },
    run: (a) => callServer('salesIssueDocument', a).then(text),
  },
  {
    name: 'sweater_void_document',
    title: 'إلغاء مستند ضريبي',
    description:
      'يُلغي مستنداً ويعكس قيده. `reversalDate` يحدّد الفترة التي يقع فيها العكس — سمِّه صراحةً '
      + 'حين تكون فترة المستند مقفلة.',
    schema: { documentId: z.string(), reason: z.string().min(3), reversalDate: ISO.optional() },
    run: (a) => callServer('salesVoidDocument', a).then(text),
  },
  {
    name: 'sweater_startup_entry',
    title: 'صرف رسوم تأسيس',
    description:
      'يضيف أو يحذف بند صرف تحت خطة تأسيس. الإجمالي والحالة يُعاد حسابهما على الخادم من البنود، '
      + 'فلا تُرسلهما. `action`: add أو delete.',
    schema: {
      action: z.enum(['add', 'delete']),
      startupCostId: z.string().optional(), entryId: z.string().optional(),
      amount: z.number().optional(), spendDate: ISO.optional(),
      paymentMethod: z.string().optional(), description: z.string().optional(),
    },
    run: ({ action, ...a }) => callServer(
      action === 'add' ? 'startupAddEntry' : 'startupDeleteEntry', a,
    ).then(text),
  },
  {
    name: 'sweater_seed_chart',
    title: 'تهيئة دليل الحسابات',
    description:
      'يفتح الدفاتر بإنشاء دليل الحسابات الافتراضي. آمن التكرار — لا يكرّر حساباً موجوداً. '
      + 'شغّله مرة واحدة على مشروع جديد.',
    schema: {},
    run: () => callServer('ledgerSeedChart', { accounts: DEFAULT_CHART_OF_ACCOUNTS }).then(text),
  },
];

export const allTools = [...readTools, ...writeTools];
