// @vitest-environment jsdom
/**
 * القائمة الجانبية بمجموعاتها — والطيّ الذي لا يبتلع التبويب النشط
 * ═══════════════════════════════════════════════════════════════════════════
 * عشرون تبويباً في سطرٍ واحد صارت تمريراً لا قائمة، خاصةً على الجوال. فقُسّمت
 * إلى مجموعات تُطوى ويتذكّرها الجهاز.
 *
 * والادعاء الحامل هو الاستثناء: **المجموعة التي فيها التبويب النشط تُعرض
 * مفتوحةً ولو كانت محفوظةً مطويّة**. بدونه يختفي التبويب الحالي — والشريط
 * البرتقالي الذي يدلّ عليه — خلف رأسٍ مطوي، فتكذب القائمة عن مكان المستخدم.
 * ويظل الكشف الأولي خاضعًا لقرار المستخدم: ضغطة الطي الصريحة تعمل حتى داخل المجموعة النشطة.
 *
 * Run: npm test
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { visibleGroupsFor } from '../../lib/navGroups';

afterEach(cleanup);
beforeEach(() => { window.localStorage.clear(); });

const Icon = () => null;

const GROUPS = [
  { id: 'top', title: null, tabs: [{ id: 'overview', label: 'نظرة عامة', icon: Icon }] },
  {
    id: 'ops',
    title: 'التشغيل اليومي',
    tabs: [
      { id: 'washes', label: 'الغسلات', icon: Icon },
      { id: 'bikers', label: 'البايكر', icon: Icon },
    ],
  },
  {
    id: 'books',
    title: 'الدفاتر المحاسبية',
    tabs: [
      { id: 'ledger', label: 'دفتر الأستاذ', icon: Icon },
      { id: 'periods', label: 'إقفال الفترة', icon: Icon },
    ],
  },
];

function renderSidebar({ activeTab = 'overview', onSelectTab = vi.fn(), groups = GROUPS } = {}) {
  render(
    <Sidebar
      groups={groups}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
      user={{ email: 'a@b.com' }}
      onCloseMobile={() => {}}
    />,
  );
  return onSelectTab;
}

const tabButton = (label) => screen.queryByRole('button', { name: label });
const groupHeader = (title) => screen.getByRole('button', { name: title });

describe('Sidebar — المجموعات', () => {
  it.each(['finance', 'annual'])('lets an explicit fold hide the active finance group and reopen it with one click (%s)', activeTab => {
    localStorage.setItem('mw:navCollapsed',JSON.stringify(['finance','finance:daily']));
    const select=renderSidebar({activeTab,groups:visibleGroupsFor({role:'admin'})});
    const header=groupHeader('المالية');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(header.getAttribute('aria-controls'))).toBeNull();
    expect(tabButton('ملخص المالية')).toBeNull();
    expect(JSON.parse(localStorage.getItem('mw:navCollapsed'))).toContain('finance');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(tabButton('ملخص المالية')).toBeTruthy();
    expect(select).not.toHaveBeenCalled();
  });
  it('folds the active finance subsection without leaving the page or losing focus',()=>{
    const select=renderSidebar({activeTab:'finance',groups:visibleGroupsFor({role:'admin'})});
    const section=groupHeader('القوائم');section.focus();fireEvent.click(section);
    expect(section.getAttribute('aria-expanded')).toBe('false');
    expect(tabButton('ملخص المالية')).toBeNull();expect(document.activeElement).toBe(section);
    fireEvent.click(section);expect(tabButton('ملخص المالية').getAttribute('aria-current')).toBe('page');
    expect(select).not.toHaveBeenCalled();
  });
  it('uses the finance heading only for folding even from a different page',()=>{
    const select=renderSidebar({groups:visibleGroupsFor({role:'admin'})});
    fireEvent.click(groupHeader('المالية'));
    expect(groupHeader('المالية').getAttribute('aria-expanded')).toBe('false');
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(groupHeader('المالية'));fireEvent.click(tabButton('ملخص المالية'));
    expect(select).toHaveBeenCalledWith('finance');
  });
  it('shows one expense destination inside daily entry, retaining the three finance sections', () => {
    const select = renderSidebar({ groups: visibleGroupsFor({ role: 'admin' }) });
    const finance = screen.getByRole('group', { name: 'المالية', exact: true });
    const expenses = within(finance).getByRole('group', { name: 'الإدخال اليومي', exact: true });
    for (const label of ['رسوم التأسيس', 'المصاريف السنوية', 'المصاريف الشهرية', 'المصاريف المتغيرة', 'المصروفات المؤقتة']) {
      expect(screen.queryByRole('button', { name: label, exact: true })).toBeNull();
    }
    expect(within(expenses).getByRole('button', { name: 'تسويات سويتر' })).toBeTruthy();
    expect(within(finance).getByRole('button', { name: 'تسويات سويتر' })).toBeTruthy();
    fireEvent.click(within(expenses).getByRole('button', { name: 'المصاريف', exact: true }));
    expect(select).toHaveBeenCalledWith('expenses');
    expect(within(finance).getByRole('group', { name: 'القوائم' })).toBeTruthy();
    expect(within(finance).getByRole('group', { name: 'الشركاء والضريبة والإقفال' })).toBeTruthy();
  });

  it('keeps both finance and expenses expanded for an active legacy expense URL without erasing preferences', () => {
    localStorage.setItem('mw:navCollapsed', JSON.stringify(['finance', 'finance:daily']));
    renderSidebar({ activeTab: 'annual', groups: visibleGroupsFor({ role: 'admin' }) });
    expect(groupHeader('المالية').getAttribute('aria-expanded')).toBe('true');
    expect(groupHeader('الإدخال اليومي').getAttribute('aria-expanded')).toBe('true');
    expect(tabButton('المصاريف').getAttribute('aria-current')).toBe('page');
    expect(JSON.parse(localStorage.getItem('mw:navCollapsed'))).toEqual(['finance', 'finance:daily']);
  });

  it('never restores section children removed by the caller role filter', () => {
    const finance = visibleGroupsFor({ role: 'admin' }).find(group => group.id === 'finance');
    renderSidebar({ groups: [{ ...finance, tabs: finance.tabs.filter(tab => ['finance', 'expenses'].includes(tab.id)) }] });
    expect(tabButton('المصاريف')).toBeTruthy();
    expect(tabButton('صندوق العمل المالي')).toBeNull();
    expect(tabButton('تسويات سويتر')).toBeNull();
    expect(tabButton('رسوم التأسيس')).toBeNull();
    expect(tabButton('المصاريف السنوية')).toBeNull();
    expect(tabButton('المصاريف المتغيرة')).toBeNull();
  });

  it.each(['partner', 'supervisor'])('does not expose finance nesting in the restricted %s view', role => {
    renderSidebar({ groups: visibleGroupsFor({ role, isPartnerView: role === 'partner' }) });
    expect(screen.queryByRole('group', { name: 'المالية', exact: true })).toBeNull();
    expect(tabButton('رسوم التأسيس')).toBeNull();
  });

  it('بلا تفضيلٍ محفوظ: كل التبويبات ظاهرة، والعناوين معها', () => {
    renderSidebar();
    for (const label of ['نظرة عامة', 'الغسلات', 'البايكر', 'دفتر الأستاذ', 'إقفال الفترة']) {
      expect(tabButton(label)).toBeTruthy();
    }
    expect(groupHeader('التشغيل اليومي')).toBeTruthy();
    expect(groupHeader('الدفاتر المحاسبية')).toBeTruthy();
  });

  it('و«نظرة عامة» بلا رأسٍ يُطوى — الملخّص لا ينتمي لفئة', () => {
    renderSidebar();
    // العناوين القابلة للنقر هي التي تحمل aria-expanded — واحدٌ لكل مجموعة
    // مُعنونة، فمجموعة الرأس بلا عنوان لا تضيف واحداً.
    expect(document.querySelectorAll('[aria-expanded]')).toHaveLength(2);
  });

  it('والنقر على الرأس يطوي المجموعة ويحفظ الاختيار', () => {
    renderSidebar({ activeTab: 'overview' });
    fireEvent.click(groupHeader('الدفاتر المحاسبية'));

    expect(tabButton('دفتر الأستاذ')).toBeNull();
    expect(tabButton('إقفال الفترة')).toBeNull();
    expect(tabButton('الغسلات')).toBeTruthy();          // مجموعة أخرى لم تُمَسّ
    expect(groupHeader('الدفاتر المحاسبية').getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('mw:navCollapsed'))).toEqual(['books']);
  });

  it('والنقر ثانيةً يعيدها ويمسحها من المحفوظ', () => {
    renderSidebar({ activeTab: 'overview' });
    fireEvent.click(groupHeader('الدفاتر المحاسبية'));
    fireEvent.click(groupHeader('الدفاتر المحاسبية'));

    expect(tabButton('دفتر الأستاذ')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('mw:navCollapsed'))).toEqual([]);
  });

  it('والمحفوظ يُقرأ عند الفتح — المجموعة المطويّة تبقى مطويّة', () => {
    window.localStorage.setItem('mw:navCollapsed', JSON.stringify(['ops']));
    renderSidebar({ activeTab: 'overview' });
    expect(tabButton('الغسلات')).toBeNull();
    expect(tabButton('دفتر الأستاذ')).toBeTruthy();
  });

  it('لكن المجموعة التي فيها التبويب النشط تُعرض مفتوحةً رغم أنها محفوظة مطويّة', () => {
    // الادعاء الحامل: لولا هذا لاختفى التبويب الحالي خلف رأسٍ مطوي.
    window.localStorage.setItem('mw:navCollapsed', JSON.stringify(['books']));
    renderSidebar({ activeTab: 'ledger' });

    expect(tabButton('دفتر الأستاذ')).toBeTruthy();
    expect(tabButton('دفتر الأستاذ').getAttribute('aria-current')).toBe('page');
    expect(groupHeader('الدفاتر المحاسبية').getAttribute('aria-expanded')).toBe('true');
    // والتفضيل لم يُمسَح — تعود للطي حين يغادرها المستخدم.
    expect(JSON.parse(window.localStorage.getItem('mw:navCollapsed'))).toEqual(['books']);
  });

  it('و`onSelectTab` يصل بالمعرّف الصحيح من داخل مجموعة', () => {
    const onSelectTab = renderSidebar({ activeTab: 'overview' });
    fireEvent.click(tabButton('البايكر'));
    expect(onSelectTab).toHaveBeenCalledWith('bikers');
  });

  it('وتخزينٌ معطَّل لا يُسقط القائمة', () => {
    // الوضع الخاص وبعض الـwebviews ترمي من localStorage — وقائمةٌ تنهار
    // لأنها لم تستطع تذكّر تفضيل أسوأ من قائمةٍ تنسى.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => renderSidebar()).not.toThrow();
    expect(tabButton('الغسلات')).toBeTruthy();
    spy.mockRestore();
  });
});
