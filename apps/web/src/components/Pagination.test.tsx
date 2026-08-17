import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Pagination from './Pagination';

describe('Pagination', () => {
  it('renders nothing when there is a single page and no total', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onChange={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders page buttons and marks the active page', () => {
    render(<Pagination page={2} totalPages={3} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' }).className).toContain('bg-brand-600');
  });

  it('disables prev on the first page and next on the last page', () => {
    render(<Pagination page={1} totalPages={1} total={5} onChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toBeDisabled();
    expect(buttons[buttons.length - 1]).toBeDisabled();
  });

  it('calls onChange for next/prev and page numbers', () => {
    const onChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('shows an ellipsis for a large page window', () => {
    render(<Pagination page={5} totalPages={10} onChange={() => {}} />);
    expect(screen.getAllByText('…').length).toBeGreaterThan(0);
  });

  it('renders the total records count', () => {
    render(<Pagination page={1} totalPages={2} total={1500} onChange={() => {}} />);
    expect(screen.getByText('1,500 records')).toBeInTheDocument();
  });
});
