import { describe, expect, it } from 'vitest';
import { INVESTOR_GROUPS, TAB_GROUPS, visibleGroupsFor } from '../navGroups';

const idsOf = (groups) => groups.flatMap((g) => g.tabs.map((t) => t.id));

describe('من يرى أي تبويب', () => {
  it('المستثمر يرى تبويباً واحداً لا اثنين وعشرين', () => {
    const ids = idsOf(visibleGroupsFor({ role: 'partner', isPartnerView: true }));
    expect(ids).toEqual(['investor']);
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

  it('مجموعة المستثمر بلا عنوان، فلا رأس طيٍّ لعنصر واحد', () => {
    expect(INVESTOR_GROUPS).toHaveLength(1);
    expect(INVESTOR_GROUPS[0].title).toBeNull();
    expect(INVESTOR_GROUPS[0].tabs).toHaveLength(1);
  });

  it('لا تبويب بلا مُعرّف ولا عنوان', () => {
    for (const tab of TAB_GROUPS.flatMap((g) => g.tabs)) {
      expect(tab.id).toBeTruthy();
      expect(tab.label).toBeTruthy();
    }
  });
});
