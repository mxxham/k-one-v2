import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders title and subtitle', () => {
    render(<PageHeader title="Stock" subtitle="Ringkasan stok" />);
    expect(screen.getByRole('heading', { name: 'Stock' })).toBeInTheDocument();
    expect(screen.getByText('Ringkasan stok')).toBeInTheDocument();
  });

  it('renders actions', () => {
    render(<PageHeader title="Stock" actions={<button>Export</button>} />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('renders without subtitle', () => {
    render(<PageHeader title="Stock" />);
    expect(screen.getByRole('heading', { name: 'Stock' })).toBeInTheDocument();
  });
});
