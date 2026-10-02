// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LanguageProvider from '../LanguageProvider';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import BikerPayroll from '../../components/BikerPayroll';
import { useLanguage } from '../useLanguage';
import { LANGUAGE_KEY, getDirection, getLanguage, getLocale, loadEnglish, localizeClassName, readLanguage, setLanguage, translate } from '../locale';
import { jsx } from '../jsx-runtime';
import { formatCurrency, formatDate, formatNumber, extractVat } from '../../data/initialData';

beforeAll(loadEnglish);
beforeEach(() => { window.localStorage.clear(); setLanguage('ar'); document.documentElement.dir = 'rtl'; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); setLanguage('ar'); });

function Form({ inputRef }) {
  const [name, setName] = useState('');
  const { language } = useLanguage();
  return <><LanguageSwitcher /><h1>قائمة الدخل</h1><p>المصاريف المتغيرة والعمولات</p>
    <input ref={inputRef} aria-label="اسم الشريك" placeholder="اسم الشريك" value={name} onChange={e => setName(e.target.value)} />
    <select aria-label="طريقة الدفع" defaultValue="نقدي"><option value="نقدي">نقدي</option><option value="تحويل بنكي">تحويل بنكي</option></select>
    <output data-testid="entered-name" translate="no">{name}</output><output data-testid="locale">{language}</output>
    <span data-testid="personal-name" translate="no">هادي الغانم</span></>;
}
async function toEnglish() {
  fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
  await screen.findByRole('heading', { name: 'Income Statement' });
}

describe('site-wide language selection', () => {
  it('defaults to Arabic, preserving all existing Arabic labels', () => {
    render(<LanguageProvider><Form /></LanguageProvider>);
    expect(screen.getByRole('heading', { name: 'قائمة الدخل' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
  it('switches labels, placeholders, accessibility attributes, title and direction', async () => {
    render(<LanguageProvider><Form /></LanguageProvider>);
    await toEnglish();
    expect(screen.getByText('Variable Expenses and Commissions')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Partner Name' }).placeholder).toBe('Partner Name');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.title).toBe('Sweater | Accounting and Partner Management');
    expect(getDirection()).toBe('ltr');
    expect(getLocale()).toBe('en-GB');
  });
  it('retains typed data, the same DOM input/ref and canonical option values', async () => {
    const ref = createRef();
    render(<LanguageProvider><Form inputRef={ref} /></LanguageProvider>);
    const original = ref.current;
    fireEvent.change(original, { target: { value: 'هادي الغانم' } });
    await toEnglish();
    expect(ref.current).toBe(original);
    expect(original.value).toBe('هادي الغانم');
    expect(screen.getByTestId('entered-name').textContent).toBe('هادي الغانم');
    expect(screen.getByTestId('personal-name').textContent).toBe('هادي الغانم');
    expect(screen.getByRole('combobox').value).toBe('نقدي');
    expect(screen.getByRole('option', { name: 'Cash' }).value).toBe('نقدي');
    fireEvent.click(screen.getByRole('button', { name: 'التبديل إلى العربية' }));
    await screen.findByRole('heading', { name: 'قائمة الدخل' });
    expect(ref.current).toBe(original);
    expect(original.value).toBe('هادي الغانم');
  });
  it('persists English through a new application mount and restores it without resetting routing', async () => {
    history.replaceState(null, '', '/?page=summary');
    const first = render(<LanguageProvider><Form /></LanguageProvider>);
    await toEnglish();
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('en');
    first.unmount();
    render(<LanguageProvider><Form /></LanguageProvider>);
    await screen.findByRole('heading', { name: 'Income Statement' });
    expect(location.search).toBe('?page=summary');
  });
  it('accepts preference changes from another tab', async () => {
    render(<LanguageProvider><Form /></LanguageProvider>);
    fireEvent(window, new StorageEvent('storage', { key: LANGUAGE_KEY, newValue: 'en' }));
    await screen.findByRole('heading', { name: 'Income Statement' });
  });
  it('falls back safely if storage is unavailable or has an unsupported locale', () => {
    localStorage.setItem(LANGUAGE_KEY, 'fr');
    expect(readLanguage()).toBe('ar');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readLanguage()).toBe('ar');
  });
});

describe('presentation safety and financial formatting', () => {
  it('translates dynamic messages while preserving interpolated names verbatim', () => {
    setLanguage('en');
    const result = translate('هل تريد حذف "هادي الغانم"؟ لا يمكن التراجع.');
    expect(result).toContain('هادي الغانم');
    expect(result).not.toContain('هل تريد');
    expect(translate('اسم عربي لم يكتبه المطور')).toBe('اسم عربي لم يكتبه المطور');
    expect(translate('هل تريد حذف "أحمد محمد"؟ لا يمكن التراجع.')).toContain('أحمد محمد');
  });
  it('preserves whitespace even on cache hits and leaves numbers unchanged', () => {
    setLanguage('en');
    expect(translate(' حفظ ')).toBe(' Save ');
    expect(translate(' حفظ ')).toBe(' Save ');
    expect(translate(45.25)).toBe(45.25);
  });
  it('translates known UI labels inside dynamic accessibility messages', () => {
    setLanguage('en');
    expect(translate('تفاصيل المصاريف المتغيرة والعمولات')).toBe('Details Variable Expenses and Commissions');
    expect(translate('بنود المصاريف الشهرية والرواتب')).toBe('Items Monthly Expenses and Salaries');
  });
  it('mirrors physical layout utilities without reversing intentionally LTR IDs', () => {
    expect(localizeClassName('md:mr-64 right-0 text-right border-l translate-x-full', 'en'))
      .toBe('md:ml-64 left-0 text-left border-r -translate-x-full');
    expect(localizeClassName('md:mr-64 right-0 text-right', 'ar')).toBe('md:mr-64 right-0 text-right');
    render(<LanguageProvider>{jsx('code', { dir: 'ltr', children: 'ACC-1200' })}</LanguageProvider>);
    expect(screen.getByText('ACC-1200').dir).toBe('ltr');
  });
  it('changes date/currency presentation but not monetary values, VAT or precision', () => {
    const vat = extractVat(115);
    setLanguage('en');
    expect(formatCurrency(1234.56)).toContain('1,234.56');
    expect(formatCurrency(1234.56)).toContain('SAR');
    expect(formatDate('2026-10-03')).toContain('Oct');
    expect(formatNumber(1234)).toBe('1,234');
    expect(extractVat(115)).toBe(vat);
    expect(getLanguage()).toBe('en');
  });
  it('renders templates and nested child arrays without translating input values', async () => {
    render(<LanguageProvider><LanguageSwitcher />{jsx('p', { children: ['حفظ', ['إلغاء']] })}</LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
    await waitFor(() => expect(screen.getByText('SaveCancel')).toBeTruthy());
  });
  it('translates text inside React fragments used by form buttons', async () => {
    render(<LanguageProvider><LanguageSwitcher /><button><>تسجيل الدخول</></button></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
    await screen.findByRole('button', { name: 'Sign In' });
  });
  it('updates payroll print amounts and dates in both directions without changing names', async () => {
    const { container } = render(<LanguageProvider><LanguageSwitcher /><BikerPayroll role="admin" previewMode /></LanguageProvider>);
    const sheet = () => container.querySelector('.payroll-print-sheet');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
    await screen.findByRole('region', { name: 'Payroll' });
    expect(sheet().dir).toBe('ltr');
    expect(sheet().textContent).toContain('SAR');
    expect(sheet().textContent).toContain('Aug 2026');
    expect(sheet().textContent).toContain('أحمد محمد');
    fireEvent.click(screen.getByRole('button', { name: 'التبديل إلى العربية' }));
    await screen.findByRole('region', { name: 'مسير الرواتب' });
    expect(sheet().dir).toBe('rtl');
    expect(sheet().textContent).not.toContain('SAR');
    expect(sheet().textContent).toContain('أغسطس');
    expect(sheet().textContent).toContain('أحمد محمد');
  });
});
