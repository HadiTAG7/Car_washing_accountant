import { getDirection, getLanguage } from '../i18n/locale';

export function payrollPdfFilename(periodKey) {
  const safePeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodKey || ''))
    ? periodKey : getLanguage() === 'en' ? 'unspecified' : 'غير-محدد';
  return getLanguage() === 'en' ? `payroll-${safePeriod}.pdf` : `مسير-رواتب-${safePeriod}.pdf`;
}

async function waitForImages(root) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      window.setTimeout(done, 2000);
    });
  }));
}

export async function downloadPayrollPdf(source, { periodKey } = {}) {
  if (!source) throw new Error('لا توجد معاينة جاهزة للطباعة.');

  const shell = document.createElement('div');
  shell.className = 'payroll-pdf-export-shell';
  shell.setAttribute('dir', getDirection());

  const printable = source.cloneNode(true);
  printable.removeAttribute('hidden');
  printable.setAttribute('aria-hidden', 'true');
  // html2pdf's A4 container is narrower than the 1120px screen sheet. Allow
  // the cloned sheet to fit that container so the trailing columns/header
  // are not cropped in either language. Never resize the live preview.
  printable.style.width = '100%';
  printable.style.maxWidth = '100%';
  shell.appendChild(printable);
  document.body.appendChild(shell);

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    await waitForImages(printable);
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
