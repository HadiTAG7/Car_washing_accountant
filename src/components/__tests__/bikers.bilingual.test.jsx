// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AddBikerModal from '../AddBikerModal';
afterEach(cleanup);
const change = (id, value) => fireEvent.change(document.querySelector(id), { target: { value } });
const submit = () => fireEvent.submit(document.querySelector('form'));

describe('bilingual biker form', () => {
  it('saves two names and accepts an English-only name', () => {
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} />);
    change('#bikerFormNameEnglish', '  Ahmed Mohammed  ');
    submit();
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ahmed Mohammed', nameArabic: '', nameEnglish: 'Ahmed Mohammed' }));
  });
  it('editing the translated names keeps existing identity and financial fields', () => {
    const onUpdate = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onUpdate={onUpdate}
      initialValues={{ id: 'b1', name: 'أحمد', salary: 2000 }} />);
    expect(screen.getByLabelText('اسم البايكر بالعربي').value).toBe('أحمد');
    change('#bikerFormName', 'أحمد محمد');
    change('#bikerFormNameEnglish', 'Ahmed Mohammed');
    submit();
    expect(onUpdate).toHaveBeenCalledWith('b1', expect.objectContaining({
      name: 'أحمد', nameArabic: 'أحمد محمد', nameEnglish: 'Ahmed Mohammed', salary: 2000,
    }));
  });
  it('does not allow two blank names', () => {
    const onAdd = vi.fn();
    render(<AddBikerModal isOpen onClose={() => {}} onAdd={onAdd} />);
    submit();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
