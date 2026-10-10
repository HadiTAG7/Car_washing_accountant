// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginScreen from '../LoginScreen';

const { signIn, requestPasswordReset } = vi.hoisted(() => ({
  signIn: vi.fn().mockResolvedValue({}), requestPasswordReset: vi.fn(),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ signIn }) }));
vi.mock('../../lib/firebaseClient', () => ({ auth: null, isFirebaseConfigured: true }));
vi.mock('../../lib/passwordReset', () => ({ requestPasswordReset, PasswordResetRateLimited: class extends Error {} }));
vi.mock('../LanguageSwitcher', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Login field labels', () => {
  it('identifies email and password by their visible labels and preserves sign-in inputs', async () => {
    render(<LoginScreen />);
    const email = screen.getByLabelText('البريد الإلكتروني');
    const password = screen.getByLabelText('كلمة المرور', { exact: true });
    expect(email.type).toBe('email');
    expect(password.type).toBe('password');
    expect(email.labels[0].textContent.trim()).toBe('البريد الإلكتروني');
    expect(password.labels[0].textContent.trim()).toBe('كلمة المرور');
    fireEvent.change(email, { target: { value: 'fixture@sweater.test' } });
    fireEvent.change(password, { target: { value: 'isolated-test-only' } });
    fireEvent.submit(email.form);
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('fixture@sweater.test', 'isolated-test-only'));
  });

  it('keeps the password label associated when visibility is toggled', () => {
    render(<LoginScreen />);
    const password = screen.getByLabelText('كلمة المرور', { exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'إظهار كلمة المرور' }));
    expect(screen.getByLabelText('كلمة المرور', { exact: true })).toBe(password);
    expect(password.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'إخفاء كلمة المرور' }));
    expect(password.type).toBe('password');
  });

  it('retains the labeled email in recovery mode without sending anything merely on navigation', () => {
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'fixture@sweater.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'نسيت كلمة المرور؟' }));
    expect(screen.getByLabelText('البريد الإلكتروني').value).toBe('fixture@sweater.test');
    expect(screen.queryByLabelText('كلمة المرور', { exact: true })).toBeNull();
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });
});
