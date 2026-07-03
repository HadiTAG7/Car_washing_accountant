import { useMemo, useState } from 'react';

// ─── Dependency-free SVG trend charts ───────────────────────────────────────
// Two forms, per the data's job:
//   ColumnTrend — single-series magnitude over months (capital receipts).
//   LineTrend   — 3-series comparison over months (revenue / costs / net).
//
// Series colors were validated (lightness band, chroma floor, CVD
// separation, contrast) against BOTH card surfaces (#fff and slate-900):
//   blue  #4f46e5 (dark: #6366f1) · red #e63946 · green #059669
// Marks carry the color; all text stays on slate text tokens. Charts render
// inside `.chart-ltr` (time flows left→right) while labels remain Arabic.

const W = 560;
const H = 210;
const PAD = { top: 18, bottom: 30, left: 14, right: 52 };

// "Nice" rounded bound for an axis (1/2/2.5/5 × 10^k).
function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const m = v / base;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * base;
}

function compactNumber(n) {
  const abs = Math.abs(n);
  const trim = (s) => s.replace(/\.0$/, '');
  if (abs >= 1_000_000) return `${trim((n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1))}م`;
  if (abs >= 1_000) return `${trim((n / 1_000).toFixed(abs >= 10_000 ? 0 : 1))}ألف`;
  return String(Math.round(n));
}

// Shared axis scaffolding: horizontal hairline gridlines + tick labels.
function GridLines({ ticks, yOf }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yOf(t)}
            y2={yOf(t)}
            className={t === 0
              ? 'stroke-slate-300 dark:stroke-slate-600'
              : 'stroke-slate-100 dark:stroke-slate-800'}
            strokeWidth="1"
          />
          <text
            x={W - PAD.right + 6}
            y={yOf(t) + 3}
            className="fill-slate-400 dark:fill-slate-500"
            fontSize="10"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {compactNumber(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

function MonthLabels({ months, xOf }) {
  return (
    <g>
      {months.map((m, i) => (
        <text
          key={m.key}
          x={xOf(i)}
          y={H - PAD.bottom + 16}
          textAnchor="middle"
          fontSize="10"
          className="fill-slate-500 dark:fill-slate-400"
        >
          {m.label}
        </text>
      ))}
    </g>
  );
}

// Floating tooltip anchored by SVG-percentage coordinates so it tracks the
// mark at any rendered size.
function Tooltip({ at, children }) {
  if (!at) return null;
  const left = `${(at.x / W) * 100}%`;
  const top = `${(at.y / H) * 100}%`;
  return (
    <div
      dir="rtl"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 shadow-md whitespace-nowrap"
      style={{ left, top, marginTop: '-6px' }}
    >
      {children}
    </div>
  );
}

// Collapsible data table — the accessible, copy-friendly twin of the chart.
function DataTable({ head, rows }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer select-none text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
        عرض البيانات كجدول
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-right text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
              {head.map((h) => <th key={h} className="py-1.5 px-2 font-bold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                {r.map((c, j) => (
                  <td key={j} className={`py-1.5 px-2 whitespace-nowrap ${j === 0 ? 'text-slate-600 dark:text-slate-300' : 'tabular-nums text-slate-700 dark:text-slate-200'}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Single-series monthly columns (e.g. capital receipts).
 *   months : [{ key:'2026-02', label:'فبراير' }]
 *   values : number[] (same order)
 *   formatValue : fn for tooltips/table (e.g. formatCurrency)
 *   valueName   : series name used in tooltip/table header
 */
export function ColumnTrend({ months, values, formatValue = String, valueName = 'القيمة' }) {
  const [hover, setHover] = useState(null);
  const max = niceCeil(Math.max(...values, 1));
  const ticks = [0, max / 2, max];
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / months.length;
  const barW = Math.min(24, band * 0.55);
  const yOf = (v) => PAD.top + innerH - (v / max) * innerH;
  const xOf = (i) => PAD.left + band * i + band / 2;
  const latest = months.length - 1;

  return (
    <div className="relative" dir="rtl">
      <div className="chart-ltr">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={valueName}>
          <GridLines ticks={ticks} yOf={yOf} />
          {months.map((m, i) => {
            const v = values[i];
            const y = yOf(v);
            const x = xOf(i) - barW / 2;
            const h = Math.max(0, PAD.top + innerH - y);
            const r = Math.min(4, barW / 2, h); // rounded data-end, square baseline
            return (
              <g key={m.key}>
                {h > 0 && (
                  <path
                    d={`M ${x} ${y + r}
                        Q ${x} ${y} ${x + r} ${y}
                        L ${x + barW - r} ${y}
                        Q ${x + barW} ${y} ${x + barW} ${y + r}
                        L ${x + barW} ${y + h}
                        L ${x} ${y + h} Z`}
                    className={`fill-[#4f46e5] dark:fill-[#6366f1] transition-opacity ${hover != null && hover !== i ? 'opacity-45' : ''}`}
                  />
                )}
                {/* value on the cap — latest month only (selective labeling) */}
                {i === latest && v > 0 && (
                  <text
                    x={xOf(i)}
                    y={y - 6}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    className="fill-slate-600 dark:fill-slate-300"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {compactNumber(v)}
                  </text>
                )}
                {/* full-band hover target — larger than the mark */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
          <MonthLabels months={months} xOf={xOf} />
        </svg>
      </div>
      {hover != null && (
        <Tooltip at={{ x: xOf(hover), y: yOf(values[hover]) }}>
          {months[hover].label}: {formatValue(values[hover])}
        </Tooltip>
      )}
      <DataTable
        head={['الشهر', valueName]}
        rows={months.map((m, i) => [m.label, formatValue(values[i])])}
      />
    </div>
  );
}

/**
 * Multi-series monthly lines (revenue / costs / net).
 *   months : [{ key, label }]
 *   series : [{ id, label, values:number[], stroke:'class', dot:'class', swatch:'class' }]
 */
export function LineTrend({ months, series, formatValue = String }) {
  const [hover, setHover] = useState(null);
  const all = series.flatMap((s) => s.values);
  const rawMax = Math.max(...all, 1);
  const rawMin = Math.min(...all, 0);
  const max = niceCeil(rawMax);
  const min = rawMin < 0 ? -niceCeil(-rawMin) : 0;
  const ticks = useMemo(
    () => (min < 0 ? [min, 0, max / 2, max] : [0, max / 2, max]),
    [min, max],
  );
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / months.length;
  const yOf = (v) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;
  const xOf = (i) => PAD.left + band * i + band / 2;

  return (
    <div className="relative" dir="rtl">
      {/* Legend — always present for ≥2 series; swatches carry identity. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
        {series.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <span className={`w-2.5 h-2.5 rounded-sm ${s.swatch}`} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="chart-ltr">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label={series.map((s) => s.label).join(' / ')}
        >
          <GridLines ticks={ticks} yOf={yOf} />
          {series.map((s) => {
            const d = s.values
              .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(v)}`)
              .join(' ');
            return (
              <path
                key={s.id}
                d={d}
                fill="none"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                className={s.stroke}
              />
            );
          })}
          {/* end markers with a surface ring, so they read where lines cross */}
          {series.map((s) => {
            const i = months.length - 1;
            return (
              <circle
                key={s.id}
                cx={xOf(i)}
                cy={yOf(s.values[i])}
                r="4"
                strokeWidth="2"
                className={`${s.dot} stroke-white dark:stroke-slate-900`}
              />
            );
          })}
          {/* crosshair + column hover targets */}
          {hover != null && (
            <line
              x1={xOf(hover)}
              x2={xOf(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              strokeWidth="1"
              className="stroke-slate-300 dark:stroke-slate-600"
            />
          )}
          {months.map((m, i) => (
            <rect
              key={m.key}
              x={PAD.left + band * i}
              y={PAD.top}
              width={band}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          <MonthLabels months={months} xOf={xOf} />
        </svg>
      </div>

      {hover != null && (
        <Tooltip at={{ x: xOf(hover), y: PAD.top + 4 }}>
          <span className="block mb-0.5 text-slate-500 dark:text-slate-400">{months[hover].label}</span>
          {series.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-sm ${s.swatch}`} />
              {s.label}: {formatValue(s.values[hover])}
            </span>
          ))}
        </Tooltip>
      )}

      <DataTable
        head={['الشهر', ...series.map((s) => s.label)]}
        rows={months.map((m, i) => [m.label, ...series.map((s) => formatValue(s.values[i]))])}
      />
    </div>
  );
}
