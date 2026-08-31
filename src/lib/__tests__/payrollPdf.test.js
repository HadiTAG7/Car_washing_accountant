// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const { save, worker } = vi.hoisted(() => {
  const pending = {};
  pending.outputPdf = vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' }));
  pending.set = vi.fn(() => pending);
  pending.from = vi.fn(() => pending);
  return { save: pending.outputPdf, worker: pending };
});

vi.mock('html2pdf.js', () => ({ default: vi.fn(() => worker) }));

import { downloadPayrollPdf, payrollPdfFilename } from '../payrollPdf';

afterEach(() => {
  cleanup();
  document.querySelectorAll('.payroll-pdf-export-shell').forEach((node) => node.remove());
  delete URL.createObjectURL;
  vi.clearAllMocks();
});

describe('ملف PDF لمسير الرواتب', () => {
  it('ينشئ اسماً عربيًا ثابتاً من الشهر', () => {
    expect(payrollPdfFilename('2026-08')).toBe('مسير-رواتب-2026-08.pdf');
    expect(payrollPdfFilename('bad')).toBe('مسير-رواتب-غير-محدد.pdf');
  });

  it('يصدر نسخة ظاهرة مستقلة ثم ينظفها بعد التنزيل', async () => {
    const source = document.createElement('section');
    source.hidden = true;
    source.innerHTML = '<h1>مسير الرواتب</h1>';
    document.body.appendChild(source);

    const createObjectURL = vi.fn(() => 'blob:payroll');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(downloadPayrollPdf(source, { periodKey: '2026-08' }))
      .resolves.toEqual({ filename: 'مسير-رواتب-2026-08.pdf', url: 'blob:payroll' });
    expect(worker.set).toHaveBeenCalled();
    expect(worker.from).toHaveBeenCalledWith(expect.any(HTMLElement));
    expect(save).toHaveBeenCalledWith('blob');
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.payroll-pdf-export-shell')).toBeNull();
    source.remove();
  });

  it('يرفض الطباعة بلا معاينة', async () => {
    await expect(downloadPayrollPdf(null, { periodKey: '2026-08' }))
      .rejects.toThrow(/لا توجد معاينة/);
  });
});
