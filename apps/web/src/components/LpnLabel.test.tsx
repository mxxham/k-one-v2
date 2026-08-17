import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LpnLabel, { LpnLabelData } from './LpnLabel';

function label(partial: Partial<LpnLabelData> = {}): LpnLabelData {
  return {
    lpn_code: 'LPN-20260817-00001',
    product_code: '550058593',
    product_name: 'Gadus S3',
    batch_number: 'B1',
    uom: 'CTN',
    quantity: 48,
    pallet_seq: 1,
    suggested_location: 'CA01A01',
    expiry_date: '2026-12-31',
    task_number: 'PKA-20260817-0001',
    order_number: 'IN-202608-0001',
    ...partial,
  };
}

describe('LpnLabel', () => {
  it('renders all label fields', () => {
    render(<LpnLabel label={label()} />);
    expect(screen.getAllByText('LPN-20260817-00001').length).toBeGreaterThan(0);
    expect(screen.getByText('Gadus S3')).toBeInTheDocument();
    expect(screen.getByText('550058593')).toBeInTheDocument();
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.getByText('2026-12-31')).toBeInTheDocument();
    expect(screen.getByText(/48/)).toBeInTheDocument();
    expect(screen.getByText(/CTN/)).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('CA01A01')).toBeInTheDocument();
    expect(screen.getByText('PKA-20260817-0001')).toBeInTheDocument();
  });

  it('falls back to dashes for missing optional fields', () => {
    render(
      <LpnLabel
        label={label({
          lpn_code: 'LPN-X',
          product_name: null,
          product_code: null,
          batch_number: null,
          expiry_date: null,
          suggested_location: null,
          task_number: null,
          quantity: 0,
        })}
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('calls onPrint and window.print on the print button', () => {
    const onPrint = vi.fn();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<LpnLabel label={label()} onPrint={onPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /Cetak Label LPN/i }));
    expect(onPrint).toHaveBeenCalled();
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('renders a barcode into the svg when jsbarcode succeeds', () => {
    const { container } = render(<LpnLabel label={label()} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toBeInTheDocument();
    expect(svg.childElementCount).toBeGreaterThan(0);
  });
});
