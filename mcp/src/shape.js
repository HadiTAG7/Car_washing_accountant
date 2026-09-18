// ═══════════════════════════════════════════════════════════════════════════
// الشكل — ما يصل النموذج يجب أن يُقرأ، لا أن يُفرَّغ
// ═══════════════════════════════════════════════════════════════════════════
// كانت الأدوات تُرجع صفوف Firestore كما هي: `total_monthly_cost` و`created_at`
// و`is_tax_invoice`، ومئة صفٍّ في ردٍّ واحد، وكائنات التقارير الداخلية بـ
// `debit/credit/known/normalBalance`. النموذج يغرق، فيُجيب بضعف أو يتوقف.
//
// هنا كل شيءٍ يُضغط إلى ما يحتاجه القارئ: اسمٌ ومبلغٌ وتاريخٌ وحالة. الأرقام
// لا تُحسب هنا — تُعاد تسميتها وتُرتَّب فقط، فلا رقمٌ ثانٍ يخالف التطبيق.
// دوالٌ نقيّة.
// ═══════════════════════════════════════════════════════════════════════════

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clip = (s, n = 160) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ─── التقارير ────────────────────────────────────────────────────────────

/** صفوف حسابٍ: رمزٌ واسمٌ ومبلغ — والصفر يُحذف. */
export function accountRows(rows) {
  return (rows || [])
    .filter((r) => Math.abs(Number(r.amount) || 0) >= 0.005)
    .map((r) => ({ code: String(r.code), name: r.nameArabic || String(r.code), amount: r2(r.amount) }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** قائمة الدخل من `incomeStatement` — بعناوينٍ عربية وبنودٍ بالحساب. */
export function compactIncome(is) {
  return {
    الإيرادات: r2(is.totalRevenue),
    التكاليف_المباشرة: r2(is.totalCost),
    مجمل_الربح: r2(is.grossProfit),
    المصروفات_التشغيلية: r2(is.totalExpenses),
    الربح_التشغيلي: r2(is.operatingProfit),
    الرسوم: (is.appliedFees || []).map((f) => ({ label: f.label, rate: f.rate, amount: r2(f.amount) })),
    صافي_الربح: r2(is.netProfit),
    تفصيل: {
      إيرادات: accountRows(is.revenue),
      تكاليف_مباشرة: accountRows(is.costOfServices),
      مصروفات: accountRows(is.expenses),
    },
    hasActivity: (is.revenue?.length || 0) + (is.costOfServices?.length || 0) + (is.expenses?.length || 0) > 0,
  };
}

/** ميزان المراجعة — رمزٌ واسمٌ ومدينٌ ودائن، والمجاميع. */
export function compactTrialBalance(tb) {
  return {
    rows: (tb.rows || [])
      .filter((r) => Math.abs(r.debit) + Math.abs(r.credit) >= 0.005)
      .map((r) => ({ code: String(r.code), name: r.nameArabic, debit: r2(r.debit), credit: r2(r.credit) })),
    totals: { debit: r2(tb.totalDebit ?? tb.totals?.debit), credit: r2(tb.totalCredit ?? tb.totals?.credit) },
    balanced: tb.balanced ?? null,
  };
}

/** المركز المالي — الأصول والالتزامات وحقوق الملكية، بالحساب. */
export function compactBalanceSheet(bs) {
  return {
    الأصول: accountRows(bs.assets),
    الالتزامات: accountRows(bs.liabilities),
    حقوق_الملكية: accountRows(bs.equity),
    إجمالي_الأصول: r2(bs.totalAssets),
    إجمالي_الالتزامات: r2(bs.totalLiabilities),
    نتيجة_الفترة: r2(bs.periodResult),
    إجمالي_حقوق_الملكية: r2(bs.totalEquity),
    متوازن: Boolean(bs.balanced),
    الفرق: r2(bs.difference),
  };
}

/** رصيد حسابٍ من ميزان المراجعة على جانبه الطبيعي (موجبٌ حين يكون على طبيعته). */
export function balanceOf(tb, code, side = 'debit') {
  const row = (tb.rows || []).find((r) => String(r.code) === String(code));
  if (!row) return 0;
  return r2(side === 'debit' ? row.debit - row.credit : row.credit - row.debit);
}

// ─── القيود ──────────────────────────────────────────────────────────────

/** قيدٌ بسطوره — «1010 الصندوق» بدل رمزٍ عارٍ، وبلا حقولٍ داخلية. */
export function compactEntry(e, accountIndex) {
  const nameOf = (code) => {
    const a = accountIndex?.get?.(String(code));
    return a ? `${code} ${a.nameArabic}` : String(code);
  };
  const lines = Array.isArray(e.lines) ? e.lines : [];
  return {
    id: e.id,
    number: e.entryNumber ?? e.number ?? null,
    date: e.entryDate ?? e.date ?? null,
    period: e.periodKey ?? null,
    description: clip(e.description || e.memo || ''),
    status: e.status,
    source: e.sourceType ? `${e.sourceType}${e.sourceId ? `:${e.sourceId}` : ''}` : null,
    total: r2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)),
    lines: lines.map((l) => ({
      account: nameOf(l.accountId),
      debit: r2(l.debit) || undefined,
      credit: r2(l.credit) || undefined,
    })),
    reversedBy: e.reversedBy ?? undefined,
  };
}

// ─── السجلات التشغيلية ──────────────────────────────────────────────────

const money = (q, p) => r2((Number(q) || 0) * (Number(p) || 0));
const bool = (v) => v === true;

const SHAPES = {
  washes: (r) => ({
    id: r.id, date: r.wash_date, biker: r.biker_name, quantity: r.quantity, price: r.price,
    total: money(r.quantity, r.price), status: r.status, payment: r.payment_method, origin: r.revenue_origin || 'direct',
  }),
  monthly_expenses: (r) => ({
    id: r.id, name: r.expense_name, category: r.category_id, total: r2(r.total_monthly_cost),
    paymentDay: r.payment_day ?? null, status: r.payment_status, recurrence: r.recurrence || 'monthly',
    date: r.logged_date ?? null, supplier: r.supplier ?? null, taxInvoice: bool(r.is_tax_invoice), invoiceNumber: r.invoice_number ?? null,
  }),
  variable_expenses: (r) => ({
    id: r.id, name: r.expense_name, category: r.category_id, quantity: r.quantity, unitCost: r2(r.unit_cost),
    total: r2(r.total_variable_cost), date: r.logged_date ?? null, supplier: r.supplier ?? null,
    taxInvoice: bool(r.is_tax_invoice), invoiceNumber: r.invoice_number ?? null,
  }),
  annual_expense_entries: (r) => ({
    id: r.id, parent: r.annual_expense_id, description: r.description, amount: r2(r.amount),
    date: r.spent_date ?? null, unit: r.unit ?? null, supplier: r.supplier ?? null, taxInvoice: bool(r.is_tax_invoice),
  }),
  annual_expenses: (r) => ({ id: r.id, name: r.expense_name || r.name, category: r.category_id, budget: r2(r.total_annual_cost ?? r.amount) }),
  temporary_expenses: (r) => ({
    id: r.id, title: r.title, amount: r2(r.amount), date: r.spent_date ?? null, status: r.status,
    recovered: r2(r.recovered_amount), recoveredDate: r.recovered_date ?? null, biker: r.biker_name ?? null, payment: r.payment_method ?? null,
  }),
  partner_payments: (r) => ({ id: r.id, partnerId: r.partner_id, amount: r2(r.amount), date: r.payment_date, method: r.payment_method, notes: clip(r.notes, 80) || null }),
  partners: (r) => ({ id: r.id, name: r.partner_name, workers: Number(r.workers_count) || 0, status: r.status || 'active', linkedAccount: Boolean(r.user_id) }),
  bikers: (r) => ({
    id: r.id, name: r.name, salary: r2(r.salary), startDate: r.start_date ?? null, endDate: r.end_date ?? null,
    residence: r.residence ?? null, nationality: r.nationality ?? null, iqamaExpiry: r.iqama_expiry ?? null,
  }),
  housing_units: (r) => ({ id: r.id, name: r.name, capacity: r.capacity ?? null, notes: clip(r.notes, 80) || null }),
  fixed_assets: (r) => ({ id: r.id, name: r.name, cost: r2(r.cost ?? r.amount), date: r.purchase_date ?? r.acquired_at ?? null, status: r.status ?? null }),
  expense_vouchers: (r) => ({ id: r.id, supplier: r.supplier ?? null, amount: r2(r.amount ?? r.total), date: r.invoice_date ?? r.date ?? null, invoiceNumber: r.invoice_number ?? null, vat: r2(r.vat_amount) }),
};

const DROP = /^(created|updated)_?at$|_url$|^raw$|^payload$|^secretBox$|^user_id$/i;

/** صفٌّ من مجموعةٍ لا نعرف شكلها: يُحذف الداخلي وتُقصّر النصوص. */
export function genericRecord(r) {
  const out = {};
  for (const [k, v] of Object.entries(r || {})) {
    if (DROP.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) continue;
    out[k] = typeof v === 'string' ? clip(v, 120) : v;
    if (Object.keys(out).length >= 14) break;
  }
  return out;
}

export function compactRecord(collection, row) {
  const shape = SHAPES[collection];
  return shape ? shape(row) : genericRecord(row);
}

/** ما يُبحث فيه نصّياً — كل قيمة نصّية أو رقمية في الصف (السطح فقط). */
export function searchableText(row) {
  return Object.values(row || {})
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .map((v) => String(v))
    .join(' ¦ ')
    .toLowerCase();
}

/** يطابق البحث: نصٌّ محتوى، أو رقمٌ مساوٍ لأحد حقول المبالغ. */
export function matchesQuery(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (searchableText(row).includes(q)) return true;
  const n = Number(q.replace(/[,٬]/g, ''));
  if (!Number.isFinite(n)) return false;
  return Object.values(row || {}).some((v) => typeof v === 'number' && Math.abs(v - n) < 0.005);
}
