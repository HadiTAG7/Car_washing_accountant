import { describe, expect, it } from 'vitest';
import {
  INVESTOR_GROUPS, INVESTOR_TABS, TAB_GROUPS, investorViewFor, resolveTab, visibleGroupsFor,
} from '../navGroups';

const idsOf = (groups) => groups.flatMap((g) => g.tabs.map((t) => t.id));

describe('من يرى أي تبويب', () => {
  it('المستثمر يرى خياراته الخمسة لا اثنين وعشرين', () => {
    const ids = idsOf(visibleGroupsFor({ role: 'partner', isPartnerView: true }));
    expect(ids).toEqual([
      'investor', 'investor_capital', 'investor_income', 'investor_trends', 'investor_assistant',
    ]);
    expect(investorViewFor('investor_assistant')).toBe('assistant');
  });

  it('ولا يصل إلى الدفاتر ولا التشغيل بأي حال', () => {
    const ids = idsOf(visibleGroupsFor({ role: 'partner', isPartnerView: true }));
    for (const forbidden of ['ledger', 'trial', 'balance', 'periods', 'bikers',
      'housing', 'washes', 'vat', 'documents', 'assets', 'partners', 'payments']) {
      expect(ids).not.toContain(forbidden);
    }
  });

  it('محاكاة المدير تُريه ما يراه الشريك بالضبط', () => {
    // كانت المحاكاة تُغيّر الأرقام والكتابة وتترك الشريط الجانبي كما هو،
    // فيراجع المديرُ واجهةً لا تُسلَّم لأحد. هذا التأكيد يفشل على الكود السابق.
    const asPartner = idsOf(visibleGroupsFor({ role: 'partner', isPartnerView: true }));
    const simulating = idsOf(visibleGroupsFor({ role: 'admin', isPartnerView: true }));
    expect(simulating).toEqual(asPartner);
  });

  it('المدير بلا محاكاة يرى كل شيء ومنه مركز القيادة', () => {
    const ids = idsOf(visibleGroupsFor({ role: 'admin' }));
    expect(ids).toContain('agent_command_center');
    expect(ids.length).toBe(idsOf(TAB_GROUPS).length);
  });

  it('مركز القيادة للمحاسب لا للمشغّل', () => {
    expect(idsOf(visibleGroupsFor({ role: 'accountant' }))).toContain('agent_command_center');
    expect(idsOf(visibleGroupsFor({ role: 'operator' }))).not.toContain('agent_command_center');
  });

  it('أعلام المعاينة تعلو على الطيّ — وإلا صارت بلا فائدة', () => {
    const ids = idsOf(visibleGroupsFor({ role: 'partner', isPartnerView: true, localPreview: true }));
    expect(ids).toContain('agent_command_center');
    expect(ids).toContain('ledger');
  });

  it('«نظرة عامة» بلا عنوان مجموعة، والبقية تحت عنوانٍ واحد يُطوى', () => {
    expect(INVESTOR_GROUPS[0].title).toBeNull();
    expect(idsOf([INVESTOR_GROUPS[0]])).toEqual(['investor']);
    expect(INVESTOR_GROUPS[1].title).toBeTruthy();
    expect(idsOf(INVESTOR_GROUPS)).toEqual(INVESTOR_TABS.map((t) => t.id));
  });

  it('لكل خيارٍ عرضٌ يخصّه — ولا يتكرّر عرضان', () => {
    const views = INVESTOR_TABS.map((t) => t.view);
    expect(new Set(views).size).toBe(views.length);
    for (const tab of INVESTOR_TABS) {
      expect(investorViewFor(tab.id)).toBe(tab.view);
      expect(tab.label).toBeTruthy();
    }
    // معرّفٌ لا يعرفه الجدول يسقط على الأول لا على فراغ.
    expect(investorViewFor('ledger')).toBe('overview');
    expect(investorViewFor(undefined)).toBe('overview');
  });

  it('وضع المستثمر لا يصيّر تبويباً إدارياً مهما طُلب', () => {
    // الشريط الجانبي حدٌّ، والحدّ يُطبَّق عند التصيير أيضاً: معرّفٌ إداريٌّ
    // بقي في الحالة — أو أُدخِل — يعود إلى صفحة المستثمر.
    for (const forbidden of ['ledger', 'bikers', 'payments', 'agent_command_center']) {
      expect(resolveTab(forbidden, { investorMode: true })).toBe('investor');
    }
    expect(resolveTab('investor_income', { investorMode: true })).toBe('investor_income');
  });

  it('وانتهاء المحاكاة على تبويب مستثمر يعود إلى «نظرة عامة» لا إلى فراغ', () => {
    // الثقب الذي فتحه التقسيم: `investor_trends` لا يصيّره أي شرطٍ إداري،
    // فبقاؤه بعد انتهاء المحاكاة شاشةٌ بيضاء.
    expect(resolveTab('investor_trends', { investorMode: false })).toBe('overview');
    expect(resolveTab('ledger', { investorMode: false })).toBe('ledger');
    expect(resolveTab('overview')).toBe('overview');
  });

  it('لا تبويب بلا مُعرّف ولا عنوان', () => {
    for (const tab of TAB_GROUPS.flatMap((g) => g.tabs)) {
      expect(tab.id).toBeTruthy();
      expect(tab.label).toBeTruthy();
    }
  });
});
