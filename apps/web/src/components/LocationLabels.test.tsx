import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LocationLabels, { LocationLabelRow } from './LocationLabels';

const rows: LocationLabelRow[] = [
  { location_code: 'CD01A01', aisle: 'CD', rack: 'CD01', row_name: 'A', position: '01', zone: 'PICK_FAST' },
  { location_code: 'CD01A02', aisle: 'CD', rack: 'CD01', row_name: 'A', position: '02', zone: 'PICK_FAST' },
];

describe('LocationLabels', () => {
  it('renders one label per location code', () => {
    render(<LocationLabels labels={rows} />);
    expect(screen.getAllByText('CD01A01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CD01A02').length).toBeGreaterThan(0);
    expect(screen.getByText(/Cetak Label Lokasi \(2\)/)).toBeInTheDocument();
  });

  it('renders an empty message and disabled print when there are no labels', () => {
    render(<LocationLabels labels={[]} />);
    expect(screen.getByText('Tidak ada lokasi untuk dicetak.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cetak Label Lokasi/ })).toBeDisabled();
  });

  it('prints on the print button', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<LocationLabels labels={rows} />);
    fireEvent.click(screen.getByRole('button', { name: /Cetak Label Lokasi \(2\)/ }));
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('closes via the Tutup button', () => {
    const onClose = vi.fn();
    render(<LocationLabels labels={rows} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalled();
  });
});
