// ─── CSV export ─────────────────────────────────────────────────────────
// Small dependency-free CSV builder + download trigger. Used by the report
// pages (VAT, P&L) so admins can hand a file to the accountant / ZATCA.
//
// Excel on Arabic Windows defaults to the system code page and mangles
// UTF-8 Arabic unless the file starts with a BOM — so we prepend one.
// Values are quoted and internal quotes doubled per RFC 4180.

function cell(value) {
  const s = value == null ? '' : String(value);
  // Always quote — simplest correct handling for commas, quotes, newlines,
  // and leading digits Excel might reinterpret.
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Build + download a CSV.
 *   headers : string[]              — column titles (row 1)
 *   rows    : (string|number)[][]   — data rows
 *   filename: string                — ".csv" appended if missing
 */
export function downloadCsv(filename, headers, rows) {
  const lines = [headers, ...rows].map((r) => r.map(cell).join(','));
  const body = '﻿' + lines.join('\r\n'); // BOM + CRLF for Excel
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
