// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AddBikerModal from '../AddBikerModal';
import { mapBiker, toBikerUpdate } from '../../lib/mappers';
import { LanguageContext } from '../../i18n/LanguageContext';
import { loadEnglish } from '../../i18n/locale';

afterEach(cleanup);

describe('worker current status form', () => {
  it('offers English suggestions and retains entered text in the saved payload', async () => {
    await loadEnglish();
    const onUpdate = vi.fn();
    render(<LanguageContext.Provider value={{ language: 'en' }}>
      <AddBikerModal isOpen onClose={() => {}} onUpdate={onUpdate}
        initialValues={{ id: 'test', name: 'Test worker', currentStatus: 'تدريب' }} />
    </LanguageContext.Provider>);
    const input = screen.getByLabelText('Current worker status');
    expect(input.value).toBe('تدريب');
    expect([...document.querySelectorAll('#bikerCurrentStatusOptions option')].map(o => o.value)).toContain('Working');
    fireEvent.change(input, { target: { value: 'On leave' } });
    fireEvent.submit(document.querySelector('form'));
    expect(onUpdate).toHaveBeenCalledWith('test', expect.objectContaining({ currentStatus: 'On leave' }));
  });
  it('keeps the saved status after unmounting and reloading the stored row', async () => {
    let row = { id: 'test', name: 'Test worker', salary: 900 };
    const onUpdate = vi.fn(async (_id, patch) => { row = { ...row, ...toBikerUpdate(patch) }; });
    const view = render(<AddBikerModal isOpen onClose={() => {}} onUpdate={onUpdate} initialValues={mapBiker(row)} />);
    fireEvent.change(screen.getByLabelText('حالة العامل الحالية'), { target: { value: 'رسب' } });
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    view.unmount();
    render(<AddBikerModal isOpen onClose={() => {}} initialValues={mapBiker(row)} />);
    expect(screen.getByLabelText('حالة العامل الحالية').value).toBe('رسب');
    expect(row.salary).toBe(900);
  });
  it('offers the requested statuses and saves a custom entry', () => {
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText('اسم البايكر بالعربي'), { target: { value: 'عامل تجريبي' } });
    const input = screen.getByLabelText('حالة العامل الحالية');
    expect([...document.querySelectorAll('#bikerCurrentStatusOptions option')].map(o => o.value))
      .toEqual(expect.arrayContaining(['يشتغل', 'هرب', 'تدريب', 'رسب']));
    fireEvent.change(input, { target: { value: '  بانتظار الوصول  ' } });
    fireEvent.submit(document.querySelector('form'));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ currentStatus: 'بانتظار الوصول' }));
  });
  it('loads the saved status on reopening, allows clearing, and preserves financial fields', () => {
    const onUpdate = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onUpdate={onUpdate}
      initialValues={{ id: 'test', name: 'Test worker', salary: 900, currentStatus: 'تدريب' }} />);
    const input = screen.getByLabelText('حالة العامل الحالية');
    expect(input.value).toBe('تدريب');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.submit(document.querySelector('form'));
    expect(onUpdate).toHaveBeenCalledWith('test', expect.objectContaining({
      currentStatus: '', name: 'Test worker', salary: 900, endDate: '',
    }));
  });
});
