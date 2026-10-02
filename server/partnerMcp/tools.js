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
import { roiSummary, momChange, ytdTotal } from '../../src/lib/accounting/partnerInsights.js';
import {
  assertScoped, shareOf, scaleMoney, scaleCount, shareLine, capitalOf,
  lastMonths, receiptsByMonth, rowsByAccount, METHOD_LABEL,
} from './scope.js';

const MONTH = z.string().regex(/^\d{4}-\d{2}$/, 'الشهر بصيغة YYYY-MM');

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const reply = (obj) => text(assertScoped(obj));

const NO_SHARE_HINT = 'لم تُسجَّل لك عمالة بعد. راجع الإدارة لتسجيل عدد عمالتك.';
const NO_ACTIVITY_HINT = 'لا توجد حركة مُرحّلة في هذا الشهر — القائمة تُبنى من القيود المُرحّلة في الدفاتر. اختر شهراً من `availableMonths`.';

// ─── مشترك ───────────────────────────────────────────────────────────────

async function identity(ctx) {
  const [partners, months] = await Promise.all([ctx.load.partners(), ctx.load.months()]);
  const share = shareOf(partners, ctx.principal.partnerId);
  const me = partners.find((p) => String(p.id) === String(ctx.principal.partnerId));
  const participation = await shareAt(ctx, months[0], share);
  return {
    partnerName: me?.partnerName ?? ctx.principal.partner?.partnerName ?? '',
    ...share,
    ...participation,
    sharePercent: Math.round(participation.factor * 10000) / 100,
    availableMonths: months,
    latestMonth: months[0],
  };
}

// Capital uses original ownership; operating allocations use eligible counts
// for EACH month, through the same private server calculation as the portal.
const shareAt = async (ctx, month, baseline) => ctx.load.participation
  ? { ...baseline, ...await ctx.load.participation(month) } : baseline;
const sharesFor = async (ctx, keys, baseline) => new Map(await Promise.all(keys.map(async key => [key, await shareAt(ctx, key, baseline)])));

async function statementFor(ctx, month, share) {
  const current = await shareAt(ctx, month, share);
  const [{ entries, lines }, accounts, feeRules] = await Promise.all([
    ctx.load.ledger(month, month), ctx.load.accounts(), ctx.load.feeRules(),
  ]);
  return monthlyStatement({
    accounts, entries, lines, periodKey: month, feeRules, scalingFactor: current.factor,
  });
}

function statementView(st) {
  return {
    month: st.periodKey,
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
    title: 'بياناتي وعدد عمالي',
    description:
      'اسم الشريك صاحب الرابط وعدد عماله فقط والأشهر المتاحة في الدفاتر. '
      + 'كل رقم في الأدوات يخص الشريك وحده. الرابط للقراءة فقط.',
    schema: {},
    async run(_args, ctx) {
      const id = await identity(ctx);
      return reply({
        partnerName: id.partnerName,
        workersCount: id.workersCount,
        hasShare: id.hasShare,
        availableMonths: id.availableMonths,
        latestMonth: id.latestMonth,
        // Only this partner's worker eligibility, never spread private inputs.
        ...(id.originalWorkers != null ? { originalWorkers: id.originalWorkers } : {}),
        ...(id.eligibleWorkers != null ? { eligibleWorkers: id.eligibleWorkers } : {}),
        ...(id.suspendedWorkers != null ? { suspendedWorkers: id.suspendedWorkers } : {}),
        ...(id.effectiveFrom != null ? { effectiveFrom: id.effectiveFrom } : {}),
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
      'قائمة دخل شهر واحد تخصك فقط: الإيرادات والمردودات وصافي الإيرادات، التكاليف المباشرة، '
      + 'المصاريف التشغيلية، الرسوم، وصافي ربحك — مع تفصيل كل بندٍ بالحساب. `month` بصيغة YYYY-MM؛ '
      + 'بلا `month` يُعرض آخر شهرٍ مُرحَّل. الأرقام من القيود المُرحّلة في الدفاتر.',
    schema: { month: MONTH.optional() },
    async run({ month } = {}, ctx) {
      const id = await identity(ctx);
      if (!id.hasShare) return reply({ hasShare: false, hint: NO_SHARE_HINT, availableMonths: id.availableMonths });
      const chosen = pickMonth(month, id.availableMonths);
      const [st, statuses] = await Promise.all([statementFor(ctx, chosen, id), ctx.load.periodStatuses()]);
      const periodStatus = statuses.get(chosen) ?? null;
      return reply({
        ...statementView(st),
        // «نهائي» شهرٌ مُقفَل لا يتغيّر؛ «مبدئي» مفتوحٌ قد يُضاف إليه قيد.
        periodStatus,
        periodStatusLabel: periodStatus === 'closed' ? 'نهائي — الشهر مُقفَل' : (periodStatus === 'open' ? 'مبدئي — الشهر مفتوح وقد يتغيّر' : null),
        availableMonths: id.availableMonths,
        note: st.hasActivity
          ? 'الأرقام حصّتك من نتائج الشركة، محسوبة على عدد البايكرز المؤهلين لهذا الشهر، ومبنيّة على القيود المُرحّلة.'
          : NO_ACTIVITY_HINT,
      });
    },
  },
  {
    name: 'partner_trend',
    title: 'اتجاه صافي ربحي',
    description:
      'صافي الإيرادات والتكاليف وصافي ربحك لكل شهر من آخر `months` شهراً (افتراضياً ٦، حتى ٢٤)، '
      + 'الأرقام تخصك فقط. لقراءة الاتجاه لا تفاصيل شهر بعينه.',
    schema: { months: z.number().int().min(1).max(24).optional() },
    async run({ months = 6 } = {}, ctx) {
      const id = await identity(ctx);
      if (!id.hasShare) return reply({ hasShare: false, hint: NO_SHARE_HINT, months: [] });
      const keys = lastMonths(months);
      const [{ entries, lines }, accounts, feeRules] = await Promise.all([
        ctx.load.ledger(keys[0], keys[keys.length - 1]), ctx.load.accounts(), ctx.load.feeRules(),
      ]);
      const shares = await sharesFor(ctx, keys, id);
      const rows = keys.map((k) => {
        const st = monthlyStatement({ accounts, entries, lines, periodKey: k, feeRules, scalingFactor: shares.get(k).factor });
        return { month: k, hasActivity: st.hasActivity, netRevenue: st.netRevenue, totalCosts: st.totalCosts, netProfit: st.netProfit };
      });
      const sum = (f) => Math.round(rows.reduce((s, r) => s + r[f], 0) * 100) / 100;
      return reply({
        months: rows,
        totals: { netRevenue: sum('netRevenue'), totalCosts: sum('totalCosts'), netProfit: sum('netProfit') },
      });
    },
  },
  {
    name: 'partner_operations',
    title: 'التشغيل بحصّتي — الغسلات والمصاريف',
    description:
      'أرقام التشغيل الخاصة بك لشهر واحد: عدد الغسلات التي تعادل حصتك فقط، '
      + 'ومبيعاتها الصافية بحصتك، وتفصيل التكاليف والمصاريف '
      + 'بالحساب من الدفاتر. `month` بصيغة YYYY-MM؛ افتراضياً آخر شهرٍ مُرحَّل. لا أسماء عاملين.',
    schema: { month: MONTH.optional() },
    async run({ month } = {}, ctx) {
      const id = await identity(ctx);
      if (!id.hasShare) return reply({ hasShare: false, hint: NO_SHARE_HINT, availableMonths: id.availableMonths });
      const chosen = pickMonth(month, id.availableMonths);
      const [washes, settings, st] = await Promise.all([
        ctx.load.washes(chosen), ctx.load.settings(), statementFor(ctx, chosen, id),
      ]);
      const current = await shareAt(ctx, chosen, id);
      const completed = washes.filter((w) => w.status === 'مكتملة' && w.washDate.slice(0, 7) === chosen);
      const companyCount = completed.reduce((s, w) => s + w.quantity, 0);
      const yourShareCount = scaleCount(companyCount, current.factor);
      const sales = operationalWashSales(washes, { periodKey: chosen, policyAt: (d) => taxPolicyAt(d, settings) });
      return reply({
        month: chosen,
        washes: {
          yourShareCount,
          text: shareLine(yourShareCount),
          grossSalesShare: scaleMoney(sales.gross, current.factor),
          netSalesShare: scaleMoney(sales.net, current.factor),
          vatShare: scaleMoney(sales.vat, current.factor),
          hasUnknownTaxPolicy: sales.unknownPolicy > 0,
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
    name: 'partner_roi',
    title: 'استرداد رأس مالي',
    description:
      'حصّتك من صافي الربح منذ أول شهرٍ مُرحَّل مقابل ما دفعته من رأس المال: نسبة الاسترداد، '
      + 'والمتبقّي، وتقدير الأشهر حتى الاسترداد بمتوسط آخر ستة أشهر فيها حركة، والتغيّر عن الشهر '
      + 'السابق، ومجموع حصّتك منذ بداية السنة. يجيب «متى يرجع رأس مالي؟».',
    schema: {},
    async run(_args, ctx) {
      const [id, receipts] = await Promise.all([identity(ctx), ctx.load.receipts()]);
      const paid = receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      if (!id.hasShare) return reply({ hasShare: false, paid, hint: NO_SHARE_HINT });
      const months = [...id.availableMonths].sort();
      const [{ entries, lines }, accounts, feeRules] = await Promise.all([
        ctx.load.ledger(months[0], months[months.length - 1]), ctx.load.accounts(), ctx.load.feeRules(),
      ]);
      const shares = await sharesFor(ctx, months, id);
      const nets = months.map((k) => {
        const st = monthlyStatement({ accounts, entries, lines, periodKey: k, feeRules, scalingFactor: shares.get(k).factor });
        return { month: k, netProfit: st.netProfit, hasActivity: st.hasActivity };
      });
      const roi = roiSummary({ nets, paid });
      const active = nets.filter((n) => n.hasActivity);
      const latest = active[active.length - 1] ?? null;
      const previous = active.length > 1 ? active[active.length - 2] : null;
      return reply({
        ...roi,
        estimate: roi.recovered
          ? 'استُردّ رأس مالك بالكامل.'
          : (roi.monthsToRecover === null
            ? 'لا تقدير — متوسط آخر الأشهر صفرٌ أو سالب.'
            : `بمتوسط آخر ${roi.monthsAveraged} أشهر يكتمل الاسترداد في نحو ${roi.monthsToRecover} شهراً.`),
        latestMonth: latest ? { month: latest.month, netProfit: latest.netProfit, ...momChange(latest.netProfit, previous?.netProfit ?? null) } : null,
        yearToDate: latest ? { year: latest.month.slice(0, 4), netProfit: ytdTotal(nets, latest.month.slice(0, 4)) } : null,
        note: 'الأرباح حصّتك من القيود المُرحّلة؛ الأشهر المفتوحة قد تتغيّر حتى تُقفل.',
      });
    },
  },
  {
    name: 'partner_summary',
    title: 'ملخّص شامل',
    description:
      'إجابة واحدة على «كيف وضعي؟»: رأس مالك (المطلوب والمسدّد والمتبقي)، وصافي ربحك من '
      + 'آخر شهرٍ مُرحَّل، واتجاه آخر ستة أشهر. للتفاصيل استعمل الأدوات المخصّصة.',
    schema: {},
    async run(_args, ctx) {
      const [id, partners, receipts] = await Promise.all([identity(ctx), ctx.load.partners(), ctx.load.receipts()]);
      const me = partners.find((p) => String(p.id) === String(ctx.principal.partnerId));
      const capital = capitalOf(me, receipts);
      if (!id.hasShare) {
        return reply({ partnerName: id.partnerName, hasShare: false, capital, hint: NO_SHARE_HINT });
      }
      const keys = lastMonths(6);
      const [{ entries, lines }, accounts, feeRules] = await Promise.all([
        ctx.load.ledger(keys[0], keys[keys.length - 1]), ctx.load.accounts(), ctx.load.feeRules(),
      ]);
      const shares = await sharesFor(ctx, keys, id);
      const trend = keys.map((k) => {
        const st = monthlyStatement({ accounts, entries, lines, periodKey: k, feeRules, scalingFactor: shares.get(k).factor });
        return { month: k, hasActivity: st.hasActivity, netRevenue: st.netRevenue, totalCosts: st.totalCosts, netProfit: st.netProfit };
      });
      const latest = await statementFor(ctx, id.latestMonth, id);
      return reply({
        partnerName: id.partnerName,
        workersCount: id.workersCount,
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
