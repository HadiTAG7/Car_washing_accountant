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
import { COL, OPERATIONAL, rows, row, ledgerBundle, lockId } from './fetch.js';

import {
  trialBalance, incomeStatement, balanceSheet, generalLedger,
} from '../../src/lib/accounting/reports.js';
import { buildVatReport, currentPeriodKey } from '../../src/lib/accounting/vatReturn.js';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/accounting/chartOfAccounts.js';
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
const dateOf = (r) => r.date || r.expense_date || r.payment_date || r.invoice_date || r.created_at || '';

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
      return text({
        email, uid, role,
        mode: readOnly ? 'قراءة فقط' : 'قراءة وكتابة',
        canPostLedger: ['admin', 'accountant'].includes(role),
        canReopenPeriod: role === 'admin',
      });
    },
  },
  {
    name: 'sweater_report',
    title: 'التقارير المالية',
    description:
      'ميزان المراجعة أو قائمة الدخل أو المركز المالي، محسوبةً من الدفاتر بنفس دوال التطبيق — '
      + 'فالأرقام هنا مطابقة لما تراه على الشاشة. `from`/`to` لقائمة الدخل وميزان المراجعة، و`asOf` للمركز المالي.',
    schema: {
      report: z.enum(['trial_balance', 'income_statement', 'balance_sheet']),
      from: ISO.optional(), to: ISO.optional(), asOf: ISO.optional(),
    },
    async run({ report, from = null, to = null, asOf = null }) {
      const { accounts, entries, lines } = await ledgerBundle();
      const feeRules = await rows('fee_rules').catch(() => []);
      if (report === 'trial_balance') return text(trialBalance(accounts, entries, lines, { from, to }));
      if (report === 'income_statement') return text(incomeStatement(accounts, entries, lines, { from, to, feeRules }));
      return text(balanceSheet(accounts, entries, lines, { asOf, feeRules }));
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
    description: 'حركة حساب واحد بالتفصيل مع الرصيد الجاري. `account` هو رقم الحساب، مثل 1200 أو 4100.',
    schema: { account: z.string(), from: ISO.optional(), to: ISO.optional() },
    async run({ account, from = null, to = null }) {
      const { accounts, entries, lines } = await ledgerBundle();
      const acc = accounts.find((a) => String(a.code) === String(account)) || null;
      if (!acc) throw new SweaterMcpError(`لا يوجد حساب برقم ${account} في دليل الحسابات.`);
      return text(generalLedger(account, entries, lines, { from, to, account: acc }));
    },
  },
  {
    name: 'sweater_journal_entries',
    title: 'القيود',
    description:
      'قيود اليومية مع سطورها، بفلترة التاريخ والحالة ونوع المصدر. استعمله للتحقق مما تغيّر ومَن غيّره '
      + 'قبل أي تصحيح — وللحصول على `entryId` اللازم للعكس.',
    schema: {
      from: ISO.optional(), to: ISO.optional(),
      status: z.enum(['posted', 'reversed']).optional(),
      sourceKind: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async run({ from = null, to = null, status = null, sourceKind = null, limit = 50 }) {
      const entries = await rows(COL.ENTRIES);
      const out = entries
        .filter((e) => inRange(e.date || '', from, to))
        .filter((e) => !status || e.status === status)
        .filter((e) => !sourceKind || e.sourceKind === sourceKind || e.sourceType === sourceKind)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, limit);
      return text({ count: out.length, entries: out });
    },
  },
  {
    name: 'sweater_records',
    title: 'السجلات التشغيلية',
    description:
      `قائمة من مجموعة تشغيلية: ${OPERATIONAL.join('، ')}. `
      + 'هذه هي البيانات الخام قبل الترحيل — الغسلات والمصروفات والشركاء.',
    schema: {
      collection: z.enum(OPERATIONAL),
      from: ISO.optional(), to: ISO.optional(),
      limit: z.number().int().min(1).max(300).optional(),
    },
    async run({ collection: name, from = null, to = null, limit = 100 }) {
      const all = await rows(name);
      const out = all
        .filter((r) => inRange(String(dateOf(r)).slice(0, 10), from, to))
        .sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a))))
        .slice(0, limit);
      return text({ collection: name, count: out.length, total: all.length, rows: out });
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
          out.push({ kind, id: r.id, date: dateOf(r), amount: r.amount ?? r.total ?? null, description: r.description || r.name || '' });
        }
      }
      return text({ count: out.length, unposted: out.slice(0, limit) });
    },
  },
  {
    name: 'sweater_chart_of_accounts',
    title: 'دليل الحسابات',
    description: 'الحسابات المُهيَّأة على المشروع. إن كان فارغاً فالدفاتر لم تُفتح بعد.',
    schema: {},
    async run() {
      const accounts = await rows(COL.ACCOUNTS);
      return text({
        seeded: accounts.length > 0,
        count: accounts.length,
        accounts: accounts.length ? accounts : undefined,
        hint: accounts.length ? undefined
          : `دليل الحسابات فارغ. استعمل sweater_seed_chart لتهيئته (${DEFAULT_CHART_OF_ACCOUNTS.length} حساباً افتراضياً).`,
      });
    },
  },
  {
    name: 'sweater_startup_costs',
    title: 'رسوم التأسيس',
    description: 'خطط التأسيس مع سجل الصرف المحسوب من البنود — لا من الحقل المخزَّن على الأب.',
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
          entries: mine,
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
