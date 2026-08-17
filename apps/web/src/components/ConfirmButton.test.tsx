import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmButton from './ConfirmButton';

describe('ConfirmButton', () => {
  it('renders the label by default', () => {
    render(<ConfirmButton label="Hapus" onConfirm={() => {}} />);
    expect(screen.getByRole('button', { name: /Hapus/i })).toBeInTheDocument();
  });

  it('reveals confirm/cancel on click and stops propagation', () => {
    const parent = vi.fn();
    render(
      <div onClick={parent}>
        <ConfirmButton label="Hapus" onConfirm={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Hapus/i }));
    expect(screen.getByRole('button', { name: 'Konfirmasi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    expect(parent).not.toHaveBeenCalled();
  });

  it('calls onConfirm then returns to the label', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Hapus" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /Hapus/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Hapus/i })).toBeInTheDocument();
  });

  it('cancels back to the label without confirming', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Hapus" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /Hapus/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Hapus/i })).toBeInTheDocument();
  });

  it('uses the custom confirm text as a title', () => {
    render(<ConfirmButton label="Hapus" confirmText="Yakin hapus?" onConfirm={() => {}} />);
    expect(screen.getByRole('button', { name: /Hapus/i })).toHaveAttribute('title', 'Yakin hapus?');
  });
});
