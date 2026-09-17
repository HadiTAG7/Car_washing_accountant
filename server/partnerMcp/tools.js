// ═══════════════════════════════════════════════════════════════════════════
// أدوات الشريك — قراءةٌ فقط، وحصّته وحدها
// ═══════════════════════════════════════════════════════════════════════════
// ستّ أدوات تجيب أسئلة الشريك عن نفسه: من أنا، كم دفعتُ، ما نصيبي من هذا
// الشهر، إلى أين تتجه، وكم غسلة تعادل حصّتي. لا أداة كتابةٍ واحدة في هذا
// الملف — لا معطَّلة ولا مخفيّة، بل غير موجودة: رابطٌ مسرَّب يقرأ حصّة صاحبه
// ولا يستطيع أكثر، بنيةً لا إعداداً.
//
// الأرقام تُحسب بدوال التطبيق نفسها (`monthlyStatement`،
// `operationalWashSales`) ثم تُقسَم بحصّته مرةً واحدة، فما يقوله المساعد
// هو ما تعرضه صفحته — لا رقمٌ ثانٍ يخالفه.
//
// كل أداة تنتهي بـ `assertScoped`: الحارس الأخير قبل أن يخرج الردّ.
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { monthlyStatement, operationalWashSales } from '../../src/lib/accounting/monthlyStatement.js';
import { taxPolicyAt } from '../../src/lib/accounting/taxPolicy.js';
import {
  assertScoped, shareOf, scaleMoney, scaleCount, shareLine, capitalOf,
  lastMonths, receiptsByMonth, rowsByAccount, METHOD_LABEL,
} from './scope.js';

const MONTH = z.string().regex(/^\d{4}-\d{2}$/, 'الشهر بصيغة YYYY-MM');

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const reply = (obj) => text(assertScoped(obj));

const NO_SHARE_HINT = 'لم تُسجَّل لك عمالة بعد — نسبتك ٠٪. راجع الإدارة لتسجيل عدد عمالتك، فالنسبة تُحسب عليه.';
const NO_ACTIVITY_HINT = 'لا توجد حركة مُرحّلة في هذا الشهر — القائمة تُبنى من القيود المُرحّلة في الدفاتر. اختر شهراً من `availableMonths`.';

// ─── مشترك ───────────────────────────────────────────────────────────────

async function identity(ctx) {
  const [partners, months] = await Promise.all([ctx.load.partners(), ctx.load.months()]);
  const share = shareOf(partners, ctx.principal.partnerId);
  const me = partners.find((p) => String(p.id) === String(ctx.principal.partnerId));
  return {
    partnerName: me?.partnerName ?? ctx.principal.partner?.partnerName ?? '',
    ...share,
    availableMonths: months,
    latestMonth: months[0],
  };
}

async function statementFor(ctx, month, share) {
  const [{ entries, lines }, accounts, feeRules] = await Promise.all([
    ctx.load.ledger(month, month), ctx.load.accounts(), ctx.load.feeRules(),
  ]);
  return monthlyStatement({
    accounts, entries, lines, periodKey: month, feeRules, scalingFactor: share.factor,
  });
}

function statementView(st, share) {
  return {
    month: st.periodKey,
    sharePercent: share.sharePercent,
    hasActivity: st.hasActivity,
    grossRevenue: st.grossRevenue,
    salesReturns: st.salesReturns,
    otherRevenue: st.otherRevenue,
    netRevenue: st.netRevenue,
    directCosts: st.directCosts,
    grossProfit: st.grossProfit,
    operatingExpenses: st.operatingExpenses,
    netProfitBeforeFees: st.netProfitBeforeFees,
    fees: (st.fees || []).map((f) => ({ key: f.key, label: f.label, rate: f.rate, amount: f.amount })),
    totalFees: st.totalFees,
    netProfit: st.netProfit,
    totalCosts: st.totalCosts,
    revenueByAccount: rowsByAccount(st.revenueRows),
    costsByAccount: rowsByAccount(st.costRows),
    expensesByAccount: rowsByAccount(st.expenseRows),
  };
}

const pickMonth = (requested, months) => (requested && months.includes(requested) ? requested : (requested || months[0]));

// ─── الأدوات ─────────────────────────────────────────────────────────────

export const partnerTools = [
  {
    name: 'partner_whoami',
    title: 'من أنا وما نسبتي',
    description:
      'اسم الشريك الذي يخصّه هذا الرابط، وعدد عمالته من مجموع العمالة، ونسبته المئوية، والأشهر التي '
      + 'للدفاتر فيها قول. ابدأ به: كل رقمٍ في بقية الأدوات مقسومٌ بهذه النسبة. الرابط للقراءة فقط.',
    schema: {},
    async run(_args, ctx) {
      const id = await identity(ctx);
      return reply({
        ...id,
        mode: 'قراءة فقط — حصّتك وحدها، بلا أسماء عاملين ولا بيانات شركاء آخرين',
        linkCreatedAtIso: ctx.principal.createdAtIso ?? null,
        hint: id.hasShare ? null : NO_SHARE_HINT,
      });
    },
  },
  {
    name: 'partner_capital',
    title: 'رأس مالي وسندات قبضي',
    description:
      'رسوم التأسيس المطلوبة منك (عمالتك × الرسم لكل عامل)، والمسدَّد من سندات قبضك، والمتبقّي، '
      + 'وقائمة سنداتك بالتاريخ والطريقة، وتحصيل آخر ستة أشهر. سنداتك وحدها — لا سند شريكٍ آخر.',
    schema: {},
    async run(_args, ctx) {
      const [partners, receipts] = await Promise.all([ctx.load.partners(), ctx.load.receipts()]);
      const me = partners.find((p) => String(p.id) === String(ctx.principal.partnerId));
      const capital = capitalOf(me, receipts);
      return reply({
        ...capital,
        receipts: receipts.map((r) => ({
          date: r.paymentDate,
          amount: r.amount,
          method: r.paymentMethod,
          methodLabel: METHOD_LABEL[r.paymentMethod] || r.paymentMethod,
          notes: r.notes || null,
        })),
        receiptsLast6Months: receiptsByMonth(receipts, lastMonths(6)),
      });
    },
  },
  {
    name: 'partner_income_statement',
    title: 'قائمة الدخل بحصّتي',
    description:
      'قائمة دخل شهرٍ واحد مقسومةً بنسبتك: الإيرادات والمردودات وصافي الإيرادات، التكاليف المباشرة، '
      + 'المصاريف التشغيلية، الرسوم، وصافي ربحك — مع تفصيل كل بندٍ بالحساب. `month` بصيغة YYYY-MM؛ '
      + 'بلا `month` يُعرض آخر شهرٍ مُرحَّل. الأرقام من القيود المُرحّلة في الدفاتر.',
    schema: { month: MONTH.optional() },
    async run({ month } = {}, ctx) {
      const id = await identity(ctx);
      if (!id.hasShare) return reply({ hasShare: false, sharePercent: 0, hint: NO_SHARE_HINT, availableMonths: id.availableMonths });
      const chosen = pickMonth(month, id.availableMonths);
      const st = await statementFor(ctx, chosen, id);
      return reply({
        ...statementView(st, id),
        availableMonths: id.availableMonths,
        note: st.hasActivity
          ? `الأرقام حصّتك (${id.sharePercent}%) من نتائج الشركة، محسوبة على عدد العمالة، ومبنيّة على القيود المُرحّلة.`
          : NO_ACTIVITY_HINT,
      });
    },
  },
  {
    name: 'partner_trend',
    title: 'اتجاه صافي ربحي',
    description:
      'صافي الإيرادات والتكاليف وصافي ربحك لكل شهر من آخر `months` شهراً (افتراضياً ٦، حتى ٢٤)، '
      + 'مقسومةً بنسبتك. لقراءة الاتجاه لا تفاصيل شهرٍ بعينه.',
    schema: { months: z.number().int().min(1).max(24).optional() },
    async run({ months = 6 } = {}, ctx) {
      const id = await identity(ctx);
      if (!id.hasShare) return reply({ hasShare: false, sharePercent: 0, hint: NO_SHARE_HINT, months: [] });
      const keys = lastMonths(months);
      const [{ entries, lines }, accounts, feeRules] = await Promise.all([
        ctx.load.ledger(keys[0], keys[keys.length - 1]), ctx.load.accounts(), ctx.load.feeRules(),
      ]);
      const rows = keys.map((k) => {
        const st = monthlyStatement({ accounts, entries, lines, periodKey: k, feeRules, scalingFactor: id.factor });
        return { month: k, hasActivity: st.hasActivity, netRevenue: st.netRevenue, totalCosts: st.totalCosts, netProfit: st.netProfit };
      });
      const sum = (f) => Math.round(rows.reduce((s, r) => s + r[f], 0) * 100) / 100;
      return reply({
        sharePercent: id.sharePercent,
        months: rows,
        totals: { netRevenue: sum('netRevenue'), totalCosts: sum('totalCosts'), netProfit: sum('netProfit') },
      });
    },
  },
  {
    name: 'partner_operations',
    title: 'التشغيل بحصّتي — الغسلات والمصاريف',
    description:
      'تشغيل شهرٍ واحد مقسوماً بنسبتك: عدد الغسلات المكتملة في الشركة وما يعادل حصّتك منها '
      + '(١٠٠ غسلة ونسبتك ١٠٪ = ١٠ غسلات)، ومبيعاتها الصافية بحصّتك، وتفصيل التكاليف والمصاريف '
      + 'بالحساب من الدفاتر. `month` بصيغة YYYY-MM؛ افتراضياً آخر شهرٍ مُرحَّل. لا أسماء عاملين.',
    schema: { month: MONTH.optional() },
    async run({ month } = {}, ctx) {
      const id = await identity(ctx);
      if (!id.hasShare) return reply({ hasShare: false, sharePercent: 0, hint: NO_SHARE_HINT, availableMonths: id.availableMonths });
      const chosen = pickMonth(month, id.availableMonths);
      const [washes, settings, st] = await Promise.all([
        ctx.load.washes(chosen), ctx.load.settings(), statementFor(ctx, chosen, id),
      ]);
      const completed = washes.filter((w) => w.status === 'مكتملة' && w.washDate.slice(0, 7) === chosen);
      const companyCount = completed.reduce((s, w) => s + w.quantity, 0);
      const yourShareCount = scaleCount(companyCount, id.factor);
      const sales = operationalWashSales(washes, { periodKey: chosen, policyAt: (d) => taxPolicyAt(d, settings) });
      return reply({
        month: chosen,
        sharePercent: id.sharePercent,
        washes: {
          companyCount,
          yourShareCount,
          text: shareLine(yourShareCount, companyCount),
          companyRows: completed.length,
          grossSalesShare: scaleMoney(sales.gross, id.factor),
          netSalesShare: scaleMoney(sales.net, id.factor),
          vatShare: scaleMoney(sales.vat, id.factor),
          unknownPolicyCount: sales.unknownPolicy,
        },
        ledger: {
          hasActivity: st.hasActivity,
          netRevenue: st.netRevenue,
          costsByAccount: rowsByAccount(st.costRows),
          expensesByAccount: rowsByAccount(st.expenseRows),
          totalCosts: st.totalCosts,
          netProfit: st.netProfit,
        },
        availableMonths: id.availableMonths,
        note: 'العدّ من سجل الغسلات المكتملة في الشهر؛ المبالغ والمصاريف من القيود المُرحّلة في الدفاتر. '
          + 'مبيعات الغسلات هنا تقديرٌ من السجل التشغيلي، والمعتمَد هو رقم الدفاتر في `ledger`.',
      });
    },
  },
  {
    name: 'partner_summary',
    title: 'ملخّص شامل',
    description:
      'إجابةٌ واحدة على «كيف وضعي؟»: نسبتك، ورأس مالك (المطلوب والمسدَّد والمتبقّي)، وصافي ربحك من '
      + 'آخر شهرٍ مُرحَّل، واتجاه آخر ستة أشهر. للتفاصيل استعمل الأدوات المخصّصة.',
    schema: {},
    async run(_args, ctx) {
      const [id, partners, receipts] = await Promise.all([identity(ctx), ctx.load.partners(), ctx.load.receipts()]);
      const me = partners.find((p) => String(p.id) === String(ctx.principal.partnerId));
      const capital = capitalOf(me, receipts);
      if (!id.hasShare) {
        return reply({ partnerName: id.partnerName, hasShare: false, sharePercent: 0, capital, hint: NO_SHARE_HINT });
      }
      const keys = lastMonths(6);
      const [{ entries, lines }, accounts, feeRules] = await Promise.all([
        ctx.load.ledger(keys[0], keys[keys.length - 1]), ctx.load.accounts(), ctx.load.feeRules(),
      ]);
      const trend = keys.map((k) => {
        const st = monthlyStatement({ accounts, entries, lines, periodKey: k, feeRules, scalingFactor: id.factor });
        return { month: k, hasActivity: st.hasActivity, netRevenue: st.netRevenue, totalCosts: st.totalCosts, netProfit: st.netProfit };
      });
      const latest = await statementFor(ctx, id.latestMonth, id);
      return reply({
        partnerName: id.partnerName,
        workersCount: id.workersCount,
        totalWorkers: id.totalWorkers,
        sharePercent: id.sharePercent,
        capital,
        latestMonth: {
          month: latest.periodKey,
          hasActivity: latest.hasActivity,
          netRevenue: latest.netRevenue,
          totalCosts: latest.totalCosts,
          netProfit: latest.netProfit,
        },
        trend,
      });
    },
  },
];

export const partnerToolNames = partnerTools.map((t) => t.name);
