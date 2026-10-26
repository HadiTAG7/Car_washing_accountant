// Pure normalisation shared with the existing VAT feed. No tax calculation.
export function composeTaxInvoices({startupEntries=[],annualEntries=[],monthlyExpenses=[],variableExpenses=[],voucherItems=[],ledgerParents=[],parentItems=[],includeNonTax=false}) {
    // ── `sourceKind` صريح، لا مشتق من التسمية المعروضة ──
    // The ledger keys a posted record by `kind__id`, because five collections
    // share `sourceType: 'expense'` and their ids are independent. The report
    // has to ask the same question with the same key, so every row states the
    // adapter kind that posts it — `voucher` for a generated voucher, NOT
    // `monthly`, which is only the badge it wears.
    const startup = (startupEntries || []).map((e) => ({
      ...e, source: 'startup', sourceKind: 'startup', parentId: e.startupCostId,
    }));
    const annual = (annualEntries || []).map((e) => ({
      ...e, source: 'annual', sourceKind: 'annual', parentId: e.annualExpenseId,
    }));
    // Monthly expenses: DOUBLE-COUNT GUARD, the same shape as the startup one
    // below. A template that has generated dated vouchers is represented by
    // those vouchers; counting the template as well would claim the same tax
    // twice — once as a real document and once as a ×N estimate.
    const voucherRows = (voucherItems || []).filter((v) => v.status !== 'cancelled');
    const voucheredTemplates = new Set(voucherRows.map((v) => String(v.templateId)));
    const monthly = (monthlyExpenses || [])
      .filter((m) => !voucheredTemplates.has(String(m.id)))
      .map((m) => ({
        id:          m.id,
        description: m.expenseName,
        amount:      m.totalMonthlyCost,
        spentDate:   m.recurrence === 'one_time' ? (m.loggedDate || '') : '',
        notes:       '',
        invoiceUrl:  m.invoiceUrl,
        invoiceNumber: m.invoiceNumber,
        invoiceDate:   m.invoiceDate,
        supplier:      m.supplier,
        vatAmount:     m.vatAmount ?? null,
        vatRate:       m.vatRate ?? null,
        priceMode:     m.priceMode || 'inclusive',
        vatDeductible: m.vatDeductible,
        isTaxInvoice: includeNonTax ? m.isTaxInvoice : true,
        createdAt:   m.loggedDate || '',
        source:      'monthly',
        sourceKind:  'monthly',
        parentId:    m.id,
        recurring:   m.recurrence !== 'one_time',
      }));
    // Each voucher IS a dated document, so it needs no recurrence estimate.
    const vouchers = voucherRows
      .filter((v) => includeNonTax || v.isTaxInvoice)
      .map((v) => ({
        id:           v.id,
        description:  `${v.templateName || 'مصروف شهري'} — ${v.periodKey}`,
        amount:       Number(v.amount) || 0,
        spentDate:    v.dueDate || '',
        notes:        '',
        invoiceUrl:   v.invoiceUrl || '',
        invoiceNumber: v.invoiceNumber || '',
        invoiceDate:   v.invoiceDate || '',
        supplier:      v.supplier || '',
        vatAmount:     v.vatAmount ?? null,
        vatRate:       v.vatRate ?? null,
        priceMode:     v.priceMode || 'inclusive',
        vatDeductible: v.vatDeductible !== false,
        isTaxInvoice: includeNonTax ? v.isTaxInvoice : true,
        createdAt:    v.generatedAtIso || v.dueDate || '',
        // The badge says «سند» and the KEY says `voucher` — the adapter that
        // posts it. Tagging a voucher `monthly` made it collide in the posted
        // set with the template it came from, whose id is a different id in a
        // different collection.
        source:       'voucher',
        sourceKind:   'voucher',
        parentId:     v.templateId,
      }));
    // Variable expenses are one-off logged events, so they always carry a
    // real spend date — no recurring special case needed.
    const variable = (variableExpenses || []).map((v) => ({
      id:           v.id,
      description:  v.expenseName,
      amount:       v.totalVariableCost,
      spentDate:    v.loggedDate || '',
      notes:        '',
      invoiceUrl:   v.invoiceUrl,
      invoiceNumber: v.invoiceNumber,
      invoiceDate:   v.invoiceDate,
      supplier:      v.supplier,
      vatAmount:     v.vatAmount ?? null,
      vatRate:       v.vatRate ?? null,
      priceMode:     v.priceMode || 'inclusive',
      vatDeductible: v.vatDeductible,
      isTaxInvoice: includeNonTax ? v.isTaxInvoice : true,
      createdAt:    v.loggedDate || '',
      source:       'variable',
      sourceKind:   'variable',
      parentId:     v.id,
    }));
    // Startup items: DOUBLE-COUNT GUARD. An item managed by the sub-ledger
    // already contributes its VAT through those entries, so a parent flag on
    // it must be ignored here — otherwise the same tax is reclaimed twice.
    const ledgerManaged = new Set(
      (ledgerParents || []).map((r) => r.startup_cost_id).filter(Boolean),
    );
    // ── بند تأسيس يحمل مبلغاً فعلياً بلا قيد فرعي ──
    // These rows can never be posted: `ADAPTERS.startup` reads
    // `startup_cost_entries`, and there is no server-authoritative path for a
    // parent-level amount — the parent has no spend date, no payment method
    // and no invoice identity, which is three of the things an entry cannot
    // be built without. They used to be reported as ordinary deductible
    // purchases dated by `created_at`, the day the ROW WAS TYPED, so the
    // claim sat in a quarter chosen by when someone opened a form and could
    // never appear on `1200` at all.
    //
    // They are now carried as REQUIRING CONVERSION: shown, totalled, and kept
    // out of `input.tax` until they become a real entry. `spentDate` is left
    // empty on purpose — inventing one is the bug, not the fix.
    const startupItems = (parentItems || [])
      .filter((i) => !ledgerManaged.has(i.id) && i.actualAmount > 0)
      .map((i) => ({
        id:           i.id,
        description:  i.itemName,
        // VAT is reclaimable on money actually paid, never on the plan.
        amount:       i.actualAmount,
        spentDate:    '',
        notes:        '',
        invoiceUrl:   i.invoiceUrl,
        invoiceNumber: i.invoiceNumber,
        invoiceDate:   i.invoiceDate,
        supplier:      i.supplier,
        vatAmount:     i.vatAmount ?? null,
        vatRate:       i.vatRate ?? null,
        priceMode:     i.priceMode || 'inclusive',
        vatDeductible: i.vatDeductible,
        isTaxInvoice: includeNonTax ? i.isTaxInvoice : true,
        createdAt:    i.createdAt || '',
        source:       'startup',
        // A kind no adapter answers to — which is the point, and why the
        // report refuses to treat the row as claimable.
        sourceKind:   'startup-parent',
        requiresConversion: true,
        parentId:     i.id,
      }));
    return [...startup, ...startupItems, ...annual, ...monthly, ...vouchers, ...variable]
      .sort((a, b) => {
        const byDate = String(b.spentDate).localeCompare(String(a.spentDate));
        return byDate !== 0 ? byDate : String(b.createdAt).localeCompare(String(a.createdAt));
      });
}
