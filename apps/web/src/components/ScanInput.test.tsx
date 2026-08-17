import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScanInput from './ScanInput';

describe('ScanInput', () => {
  it('submits the trimmed value on Enter and clears the field', async () => {
    const onScan = vi.fn().mockResolvedValue(undefined);
    render(<ScanInput onScan={onScan} />);

    const input = screen.getByPlaceholderText('Scan kode…');
    fireEvent.change(input, { target: { value: '  LPN-001  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onScan).toHaveBeenCalledWith('LPN-001'));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('does not submit empty input', async () => {
    const onScan = vi.fn().mockResolvedValue(undefined);
    render(<ScanInput onScan={onScan} />);
    const input = screen.getByPlaceholderText('Scan kode…');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 10));
    expect(onScan).not.toHaveBeenCalled();
  });

  it('does not submit while disabled', async () => {
    const onScan = vi.fn().mockResolvedValue(undefined);
    render(<ScanInput onScan={onScan} disabled />);
    const input = screen.getByPlaceholderText('Scan kode…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ABC' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 10));
    expect(onScan).not.toHaveBeenCalled();
    expect(input.disabled).toBe(true);
  });

  it('disables the input while a scan is in flight', async () => {
    let resolveScan!: () => void;
    const onScan = vi.fn().mockImplementation(() => new Promise<void>((r) => (resolveScan = r)));
    render(<ScanInput onScan={onScan} />);
    const input = screen.getByPlaceholderText('Scan kode…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.disabled).toBe(true);
    await actResolve();
    resolveScan();
    await waitFor(() => expect(input.disabled).toBe(false));
  });

  it('uses a custom placeholder', () => {
    render(<ScanInput onScan={vi.fn()} placeholder="Scan bin…" />);
    expect(screen.getByPlaceholderText('Scan bin…')).toBeInTheDocument();
  });
});

async function actResolve() {
  await new Promise((r) => setTimeout(r, 0));
}
