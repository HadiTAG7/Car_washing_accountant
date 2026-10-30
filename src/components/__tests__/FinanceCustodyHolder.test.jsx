// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FinanceCustodyHolder from '../FinanceCustodyHolder';
afterEach(cleanup);
const holders = [{ id: 'b1', name: 'سالم', left: false, outstanding: 150 }, { id: 'b2', name: 'ماجد', left: true, outstanding: 20 }];
const form = (overrides = {}) => ({ fundingType: 'custody', custodyBikerId: '', amount: '120', ...overrides });
// formatCurrency wraps amounts in direction marks; compare the visible text.
const plain = text => text.replace(/[\u200e\u200f]/g, '').replace(/\u00a0/g, ' ');
const note = () => plain(screen.getByRole('note', { name: 'رصيد العهدة' }).textContent);

describe('the custody holder in the workbench form', () => {
  it('appears only for «من عهدة شخص» and «دفع موظف», listing every employee with his open custody', () => {
    const { container, rerender } = render(<FinanceCustodyHolder form={form({ fundingType: 'company_cash' })} holders={holders} onChange={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    const change = vi.fn();
    rerender(<FinanceCustodyHolder form={form()} holders={holders} onChange={change} />);
    const select = screen.getByLabelText('صاحب العهدة');
    expect([...select.options].map(o => plain(o.textContent))).toEqual(['اختر الموظف', 'سالم — عهدته 150.00 ر.س', 'ماجد — عهدته 20.00 ر.س (انتهت خدمته)']);
    fireEvent.change(select, { target: { value: 'b1' } });
    expect(change).toHaveBeenCalledWith('b1');
    rerender(<FinanceCustodyHolder form={form({ fundingType: 'employee' })} holders={holders} onChange={change} />);
    expect(screen.getByLabelText('الموظف الذي دفع')).toBeTruthy();
  });

  it('shows the balance after this document, and what stays owed to him when it exceeds his custody', () => {
    const { rerender } = render(<FinanceCustodyHolder form={form({ custodyBikerId: 'b1' })} holders={holders} onChange={vi.fn()} />);
    expect(note()).toContain('عهدة سالم المفتوحة 150.00');
    expect(note()).toContain('بعد الخصم 30.00');
    expect(note()).toContain('دائن 1300');
    rerender(<FinanceCustodyHolder form={form({ fundingType: 'employee', custodyBikerId: 'b2', amount: '50' })} holders={holders} onChange={vi.fn()} />);
    expect(note()).toContain('بعد الخصم 0.00');
    expect(note()).toContain('والزائد 30.00 ر.س يبقى له ولا يُخصم من راتبه');
    rerender(<FinanceCustodyHolder form={form({ custodyBikerId: 'b1' })} detail={{ protectedSource: true, row: {} }} holders={holders} onChange={vi.fn()} />);
    expect(note()).toContain('سُوّي هذا المستند من عهدة سالم عند ترحيله');
  });

  it('flags a holder recorded by name only, which no custody is deducted from', () => {
    render(<FinanceCustodyHolder form={form()} detail={{ row: { finance_metadata: { custodian: 'مشرف' } } }} holders={holders} onChange={vi.fn()} />);
    expect(screen.getByRole('note').textContent).toContain('«مشرف» غير مربوط بقائمة البايكرز');
  });
});
