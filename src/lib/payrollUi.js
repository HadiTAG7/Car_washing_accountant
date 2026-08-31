export function adjustmentsFromPayrollLines(lines) {
  return Object.fromEntries((lines || []).map((line) => [line.bikerId, {
    bikerId: line.bikerId,
    bonus: line.bonus || 0,
    bonusReason: line.bonusReason || '',
    deduction: line.deduction || 0,
    deductionReason: line.deductionReason || '',
    advanceDeduction: line.advanceDeduction || 0,
    advanceDeductionTouched: line.advanceDeductionMode === 'manual',
  }]));
}

export function payrollAdvanceMax(line, adjustment) {
  const beforeAdvance = (Number(line.basicDue) || 0) + (Number(line.commission) || 0)
    + (Number(adjustment.bonus) || 0) - (Number(adjustment.deduction) || 0);
  return Math.round(Math.min(Number(line.advanceOutstanding) || 0, Math.max(0, beforeAdvance)) * 100) / 100;
}

export function payrollAdjustmentPayload(adjustments) {
  return Object.values(adjustments).map((row) => ({
    bikerId: row.bikerId,
    bonus: Number(row.bonus) || 0,
    bonusReason: row.bonusReason || '',
    deduction: Number(row.deduction) || 0,
    deductionReason: row.deductionReason || '',
    ...(row.advanceDeductionTouched
      ? { advanceDeduction: Number(row.advanceDeduction) || 0 } : {}),
  }));
}
