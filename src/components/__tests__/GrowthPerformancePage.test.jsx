// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GrowthPerformanceContent, GrowthPerformanceView } from '../GrowthPerformancePage';
import { growthFixture } from './growthFixture';

afterEach(cleanup);
describe('growth page interactions', () => {
  it('returns keyboard focus to the selected day after closing inline details', () => {
    render(<GrowthPerformanceView data={growthFixture()} language="en" />);
    const day = screen.getByRole('button', { name: '2026-10-17: 42 · Complete' });
    day.focus(); fireEvent.click(day);
    const close = screen.getByRole('button', { name: 'Close details' });
    close.focus(); fireEvent.click(close);
    expect(document.activeElement).toBe(day);
  });
  it('applies dates explicitly and renders retry/loading/errors without reloading the document', () => {
    const changed = [];
    const source = { allowed: true, loading: false, data: growthFixture(), error: null, retry: () => changed.push('retry') };
    const { rerender } = render(<GrowthPerformanceContent source={source} period={{from:'2026-10-10',to:'2026-10-17'}} onPeriodChange={p => changed.push(p)} language="en" />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-17' } });
    expect(changed).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show period' }));
    expect(changed).toEqual([{from:'2026-10-17',to:'2026-10-17'}]);
    rerender(<GrowthPerformanceContent source={{...source,error:'Synthetic read error',data:null}} period={{from:'2026-10-10',to:'2026-10-17'}} onPeriodChange={() => {}} language="en" />);
    expect(screen.getByRole('alert').textContent).toContain('Synthetic read error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(changed.at(-1)).toBe('retry');
    rerender(<GrowthPerformanceContent source={{...source,loading:true,data:null}} period={{from:'2026-10-10',to:'2026-10-17'}} onPeriodChange={() => {}} language="en" />);
    expect(screen.getByRole('status').textContent).toContain('Loading growth data');
  });
  it('labels missing percentages unavailable, but a verified zero denominator not applicable', () => {
    const data = growthFixture(); data.workers[1].days.at(-1).coverage = 'partial';
    render(<GrowthPerformanceView data={data} language="en" />);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(rows[1]).getAllByRole('cell')[6].textContent).toBe('Not applicable');
    expect(within(rows[2]).getAllByRole('cell')[6].textContent).toBe('Unavailable');
  });
  it('filters the same population across cards, chart and worker table', () => {
    const { container } = render(<GrowthPerformanceView data={growthFixture()} language="en" />);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(8);
    expect(container.querySelector('.sw-growth__card strong').textContent).toBe('42');
    fireEvent.change(screen.getByLabelText('Biker'), { target: { value: 'fixture-1984' } });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(container.querySelector('.sw-growth__card strong').textContent).toBe('7');
    expect(screen.getByRole('button', { name: '2026-10-17: 7 · Complete' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2026-10-17: 7 · Complete' }));
    expect(screen.getByRole('button', { name: 'Close details' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'Wurood' } });
    expect(screen.getByLabelText('Biker').value).toBe('all');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5);
    expect(container.querySelector('.sw-growth__card strong').textContent).toBe('28');
  });
  it('keeps Arabic RTL, dated status, unavailable versus zero and single-day warnings', () => {
    const data = growthFixture(); data.from = data.to;
    data.workers[1].days.at(-1).coverage = 'partial';
    const { container } = render(<GrowthPerformanceView data={data} />);
    expect(container.firstElementChild.dir).toBe('rtl');
    expect(screen.getByText(/الحالة ليست حية/)).toBeTruthy();
    expect(container.querySelector('.sw-growth__card strong').textContent).toBe('غير متاح');
    expect(screen.getByText('عينة يوم واحد فقط.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('البايكر'), { target: { value: 'fixture-1982' } });
    expect(container.querySelector('.sw-growth__card strong').textContent).toBe('0');
    expect(screen.getByRole('button', { name: /2026-10-17: 0/ })).toBeTruthy();
  });
});
