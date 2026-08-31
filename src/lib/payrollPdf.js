export function payrollPdfFilename(periodKey) {
  const safePeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodKey || ''))
    ? periodKey : 'غير-محدد';
  return `مسير-رواتب-${safePeriod}.pdf`;
}

export async function downloadPayrollPdf(source, { periodKey } = {}) {
  if (!source) throw new Error('لا توجد معاينة جاهزة للطباعة.');

  const shell = document.createElement('div');
  shell.className = 'payroll-pdf-export-shell';
  shell.setAttribute('dir', 'rtl');

  const printable = source.cloneNode(true);
  printable.removeAttribute('hidden');
  printable.setAttribute('aria-hidden', 'true');
  shell.appendChild(printable);
  document.body.appendChild(shell);

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const module = await import('html2pdf.js');
    const html2pdf = module.default || module;
    const filename = payrollPdfFilename(periodKey);
    const blob = await html2pdf().set({
      filename,
      margin: [7, 7, 7, 7],
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr'] },
    }).from(printable).outputPdf('blob');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return { filename, url };
  } finally {
    shell.remove();
  }
}
