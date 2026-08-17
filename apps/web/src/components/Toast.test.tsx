import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from './Toast';

function Trigger({ kind }: { kind: 'success' | 'error' | 'info' }) {
  const toast = useToast();
  return <button onClick={() => toast(kind, `${kind} message`)}>{kind}</button>;
}

describe('ToastProvider', () => {
  it('shows a toast message on trigger', () => {
    render(
      <ToastProvider>
        <Trigger kind="success" />
      </ToastProvider>,
    );
    expect(screen.queryByText('success message')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'success' }));
    expect(screen.getByText('success message')).toBeInTheDocument();
  });

  it('renders error and info toasts too', () => {
    render(
      <ToastProvider>
        <Trigger kind="error" />
        <Trigger kind="info" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'error' }));
    fireEvent.click(screen.getByRole('button', { name: 'info' }));
    expect(screen.getByText('error message')).toBeInTheDocument();
    expect(screen.getByText('info message')).toBeInTheDocument();
  });

  it('dismisses a toast via its close button', () => {
    render(
      <ToastProvider>
        <Trigger kind="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'success' }));
    const toastEl = screen.getByText('success message');
    const closeBtn = toastEl.parentElement!.querySelector('button')!;
    fireEvent.click(closeBtn);
    expect(screen.queryByText('success message')).not.toBeInTheDocument();
  });

  it('auto-removes toasts after the timeout', () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <Trigger kind="success" />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'success' }));
      expect(screen.getByText('success message')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(4600);
      });
      expect(screen.queryByText('success message')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('useToast throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger kind="info" />)).toThrow('useToast must be used within ToastProvider');
    spy.mockRestore();
  });
});
