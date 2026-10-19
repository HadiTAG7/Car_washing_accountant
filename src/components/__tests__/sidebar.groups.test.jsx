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
 * وهو تجاوزٌ عند العرض لا مسحٌ للتفضيل: تعود المجموعة إلى الطي حين يغادرها.
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
  it('nests all five expense pages inside finance/expenses, not under settlements', () => {
    const select = renderSidebar({ groups: visibleGroupsFor({ role: 'admin' }) });
    const finance = screen.getByRole('group', { name: 'المالية', exact: true });
    const expenses = within(finance).getByRole('group', { name: 'المصاريف', exact: true });
    for (const label of ['رسوم التأسيس', 'المصاريف السنوية', 'المصاريف الشهرية', 'المصاريف المتغيرة', 'المصروفات المؤقتة']) {
      expect(within(expenses).getByRole('button', { name: label, exact: true })).toBeTruthy();
      expect(screen.getAllByRole('button', { name: label, exact: true })).toHaveLength(1);
    }
    expect(within(expenses).queryByRole('button', { name: 'تسويات سويتر' })).toBeNull();
    expect(within(finance).getByRole('button', { name: 'تسويات سويتر' })).toBeTruthy();
    fireEvent.click(within(expenses).getByRole('button', { name: 'المصاريف الشهرية', exact: true }));
    expect(select).toHaveBeenCalledWith('monthly');
    fireEvent.click(within(expenses).getByRole('button', { name: 'المصاريف', exact: true }));
    expect(within(expenses).queryByRole('button', { name: 'رسوم التأسيس' })).toBeNull();
    expect(within(finance).getByRole('button', { name: 'تسويات سويتر' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('mw:navCollapsed'))).toEqual(['finance:expenses']);
  });

  it('keeps both finance and expenses expanded for an active legacy expense URL without erasing preferences', () => {
    localStorage.setItem('mw:navCollapsed', JSON.stringify(['finance', 'finance:expenses']));
    renderSidebar({ activeTab: 'annual', groups: visibleGroupsFor({ role: 'admin' }) });
    expect(groupHeader('المالية').getAttribute('aria-expanded')).toBe('true');
    expect(groupHeader('المصاريف').getAttribute('aria-expanded')).toBe('true');
    expect(tabButton('المصاريف السنوية').getAttribute('aria-current')).toBe('page');
    expect(JSON.parse(localStorage.getItem('mw:navCollapsed'))).toEqual(['finance', 'finance:expenses']);
  });

  it('never restores section children removed by the caller role filter', () => {
    const finance = visibleGroupsFor({ role: 'admin' }).find(group => group.id === 'finance');
    renderSidebar({ groups: [{ ...finance, tabs: finance.tabs.filter(tab => ['finance', 'monthly'].includes(tab.id)) }] });
    expect(tabButton('المصاريف الشهرية')).toBeTruthy();
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
