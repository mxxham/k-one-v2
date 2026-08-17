import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({
  api: vi.fn(),
  apiHref: vi.fn(() => 'http://localhost:3000/index.php?module=export&action=stock'),
}));

const mockToast = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({ canWrite: true, canAdmin: true, department: 'all' }));

vi.mock('@/lib/api', () => mockApi);
vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
}));

import StockPage from './StockPage';

const rows = [
  {
    id: 1,
    product_id: 10,
    product_code: '550058593',
    product_name: 'Gadus S3',
    category: 'Carton',
    uom_type: 'CTN',
    uom_per_pallet: 44,
    velocity_class: 'A',
    batch_number: 'B2026-01',
    location: 'CA01A01',
    quantity: 48,
    uom: 'CTN',
    pallet: 1,
    manufacture_date: '2026-07-01',
    expiry_date: '2026-12-01',
    stock_status: 'Available',
    hold_status: 'available',
    hold_reason: '',
    hold_by: null,
    hold_at: null,
  },
  {
    id: 2,
    product_id: 11,
    product_code: '550062464',
    product_name: 'Minyak Goreng',
    category: 'Drum',
    uom_type: 'DRUM',
    uom_per_pallet: 36,
    velocity_class: null,
    batch_number: 'B2026-02',
    location: 'CD01A02',
    quantity: 12,
    uom: 'DRUM',
    pallet: 1,
    manufacture_date: '2026-06-01',
    expiry_date: '2026-08-10',
    stock_status: 'Available',
    hold_status: 'on_hold',
    hold_reason: 'Rusak saat transit',
    hold_by: 1,
    hold_at: '2026-08-15T10:00:00',
  },
];

const summary = {
  total_products: 2,
  total_drums: 12,
  total_pallets: 2,
  available_items: 2,
  reserved_items: 0,
  expired_items: 0,
  dues_in_items: 0,
  expiring_soon: 1,
  critical: 1,
  expired: 0,
  total_qty: 60,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockToast.mockClear();
  mockAuth.canWrite = true;
  mockAuth.canAdmin = true;

  mockApi.api.mockImplementation((module: string, action: string) => {
    if (module === 'stock' && action === 'list') {
      return Promise.resolve({ success: true, rows, summary });
    }
    if (module === 'stock' && action === 'summary') {
      return Promise.resolve({ success: true, summary });
    }
    if (module === 'stock' && action === 'by_location') {
      return Promise.resolve({ success: true, rows: [{ area: 'CA', products: 2, total_qty: 60, total_pallet: 2 }] });
    }
    if (module === 'stock' && action === 'locations') {
      return Promise.resolve({ success: true, rows: ['CA01A01', 'CD01A02'] });
    }
    return Promise.resolve({ success: true });
  });
});

function renderPage() {
  return render(<StockPage />);
}

describe('StockPage', () => {
  it('renders KPI summary cards from the summary payload', async () => {
    renderPage();
    expect(await screen.findByText('Total Produk')).toBeInTheDocument();
    expect(screen.getAllByText('Total Pallet').length).toBeGreaterThan(0);
    expect(screen.getByText('Segera Expire')).toBeInTheDocument();
  });

  it('renders stock rows with product info and expiry status', async () => {
    renderPage();
    expect(await screen.findByText('550058593')).toBeInTheDocument();
    expect(screen.getByText('Gadus S3')).toBeInTheDocument();
    expect(screen.getByText('550062464')).toBeInTheDocument();
  });

  it('shows an empty state when there are no rows', async () => {
    mockApi.api.mockImplementation((module: string, action: string) => {
      if (module === 'stock' && action === 'list') {
        return Promise.resolve({ success: true, rows: [], summary });
      }
      return Promise.resolve({ success: true });
    });
    renderPage();
    expect(await screen.findByText('Tidak ada data stok')).toBeInTheDocument();
  });

  it('shows an error toast when the list load fails', async () => {
    mockApi.api.mockImplementation((module: string, action: string) => {
      if (module === 'stock' && action === 'list') {
        return Promise.reject(new Error('Database timeout'));
      }
      return Promise.resolve({ success: true });
    });
    renderPage();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('error', 'Database timeout'));
  });

  it('reloads the list when a search is submitted', async () => {
    renderPage();
    await screen.findByText('550058593');

    fireEvent.change(screen.getByPlaceholderText('Kode / nama produk, batch…'), { target: { value: 'gadus' } });
    fireEvent.click(screen.getByRole('button', { name: /Cari/i }));

    await waitFor(() => {
      const calls = mockApi.api.mock.calls.filter((c: any[]) => c[0] === 'stock' && c[1] === 'list');
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[calls.length - 1][2].params.q).toBe('gadus');
    });
  });

  it('opens the transfer modal and submits a stock transfer', async () => {
    renderPage();
    await screen.findByText('550058593');

    fireEvent.click(screen.getAllByTitle('Transfer')[0]);
    expect(screen.getByText('Transfer Stok')).toBeInTheDocument();

    const dest = screen.getByPlaceholderText('Contoh: A-01-01');
    fireEvent.change(dest, { target: { value: 'CD02B01' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Transfer' })[screen.getAllByRole('button', { name: 'Transfer' }).length - 1]);

    await waitFor(() => {
      const call = mockApi.api.mock.calls.find((c: any[]) => c[0] === 'stock' && c[1] === 'transfer');
      expect(call).toBeDefined();
      expect(call![2].body).toMatchObject({ stock_id: 1, to_location: 'CD02B01' });
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('success', 'Transfer stok berhasil'));
  });

  it('disables the hold submit until a reason is provided', async () => {
    renderPage();
    await screen.findByText('550058593');

    fireEvent.click(screen.getByTitle('Hold / Quarantine'));
    const holdBtn = screen.getByRole('button', { name: 'Hold' }) as HTMLButtonElement;
    expect(holdBtn.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Alasan hold / quarantine…'), { target: { value: 'QC check' } });
    expect(holdBtn.disabled).toBe(false);
    expect(mockApi.api).not.toHaveBeenCalledWith('stock', 'hold', expect.anything());
  });

  it('submits a hold with status and reason', async () => {
    renderPage();
    await screen.findByText('550058593');

    fireEvent.click(screen.getByTitle('Hold / Quarantine'));
    fireEvent.change(screen.getByPlaceholderText('Alasan hold / quarantine…'), { target: { value: 'QC check' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));

    await waitFor(() => {
      const call = mockApi.api.mock.calls.find((c: any[]) => c[0] === 'stock' && c[1] === 'hold');
      expect(call).toBeDefined();
      expect(call![2].body).toMatchObject({ stock_id: 1, status: 'on_hold', reason: 'QC check' });
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('success', 'Stok di-hold'));
  });

  it('releases a held stock row', async () => {
    renderPage();
    await screen.findByText('550062464');

    fireEvent.click(screen.getByTitle('Release Hold'));
    expect(screen.getByText('Release Hold Stok')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));

    await waitFor(() => {
      const call = mockApi.api.mock.calls.find((c: any[]) => c[0] === 'stock' && c[1] === 'release');
      expect(call).toBeDefined();
      expect(call![2].body).toMatchObject({ stock_id: 2 });
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('success', 'Stok di-release'));
  });

  it('hides write-only actions for non-write users', async () => {
    mockAuth.canWrite = false;
    renderPage();
    await screen.findByText('550058593');
    expect(screen.queryByTitle('Transfer')).toBeNull();
    expect(screen.queryByTitle('Hold / Quarantine')).toBeNull();
  });

  it('hides the adjust action from non-admin users', async () => {
    mockAuth.canAdmin = false;
    renderPage();
    await screen.findByText('550058593');
    expect(screen.queryByTitle('Adjust')).toBeNull();
  });

  it('opens the adjust modal for admins and submits', async () => {
    renderPage();
    await screen.findByText('550058593');

    fireEvent.click(screen.getAllByTitle('Adjust')[0]);
    expect(screen.getByText('Adjust Stok')).toBeInTheDocument();

    const qty = screen.getByPlaceholderText('Qty baru');
    fireEvent.change(qty, { target: { value: '50' } });
    fireEvent.change(screen.getByPlaceholderText('Alasan adjustment…'), { target: { value: 'Koreksi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    await waitFor(() => {
      const call = mockApi.api.mock.calls.find((c: any[]) => c[0] === 'stock' && c[1] === 'adjust');
      expect(call).toBeDefined();
      expect(call![2].body).toMatchObject({ stock_id: 1, quantity: 50, reason: 'Koreksi' });
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('success', 'Adjustment stok berhasil'));
  });

  it('renders the by-location area table', async () => {
    renderPage();
    await screen.findByText('Stok per Area');
    expect(screen.getByText('CA')).toBeInTheDocument();
  });

  it('shows the held reason next to held stock', async () => {
    renderPage();
    await screen.findByText('550062464');
    const row = screen.getByText('550062464').closest('tr')!;
    expect(within(row).getByText(': Rusak saat transit')).toBeInTheDocument();
  });
});