// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceAttestation from '../FinanceAttestation';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../lib/financeApi', () => ({ callFinanceApi: (...args) => mock.api(...args) }));
afterEach(cleanup); beforeEach(() => mock.api.mockReset());
const detail = (founding) => ({ sourceId: 'v6', sourceHash: 'a'.repeat(64), founding });

describe('«بلا إيصال، بإقرار المدير» in the document form', () => {
  it('is offered only on an attestable founding document', () => {
    const { container } = render(<FinanceAttestation kind="variable" detail={detail({ attestable: false, attestation: null })} onDone={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('needs a written reason and a clean form, then saves through the founding endpoint and re-reads', async () => {
    const done = vi.fn(), message = vi.fn();
    const { rerender } = render(<FinanceAttestation kind="variable" detail={detail({ attestable: true, attestation: null })} dirty onDone={done} onMessage={message} />);
    expect(screen.getByRole('note').textContent).toContain('احفظ تعديلاتك');
    expect(screen.getByRole('button', { name: 'بلا إيصال، بإقرار المدير' })).toHaveProperty('disabled', true);
    rerender(<FinanceAttestation kind="variable" detail={detail({ attestable: true, attestation: null })} dirty={false} onDone={done} onMessage={message} />);
    fireEvent.change(screen.getByLabelText('السبب'), { target: { value: 'لا' } });
    expect(screen.getByRole('button', { name: 'بلا إيصال، بإقرار المدير' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('السبب'), { target: { value: 'دفعته من حسابي ولم أحتفظ بالإيصال' } });
    fireEvent.click(screen.getByRole('button', { name: 'بلا إيصال، بإقرار المدير' }));
    mock.api.mockResolvedValueOnce({ saved: true });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith('v6'));
    expect(mock.api).toHaveBeenCalledWith('finance-workbench', { kind: 'founding', request: { action: 'attestDocument', kind: 'variable', sourceId: 'v6',
      sourceHash: 'a'.repeat(64), reason: 'دفعته من حسابي ولم أحتفظ بالإيصال', confirm: true } });
    expect(message).toHaveBeenCalledWith(expect.stringContaining('بإقرار المدير'));
  });

  it('shows who attested, when and why once saved', () => {
    render(<FinanceAttestation kind="variable" detail={detail({ attestable: false, attestation: { byName: 'هادي', atIso: '2026-10-30T09:00:00.000Z', note: 'بلا إيصال', approxDate: '2026-07-15' } })} onDone={vi.fn()} />);
    expect(screen.getByRole('note', { name: 'بإقرار المدير' }).textContent).toContain('أقرّه هادي');
    expect(screen.getByRole('note', { name: 'بإقرار المدير' }).textContent).toContain('«بلا إيصال»');
  });
});
