import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WebBtn } from './WebBtn';

describe('WebBtn', () => {
  it('renders a link that opens in a new tab with the href', () => {
    render(<WebBtn href="http://x/print" label="Cetak" />);
    const link = screen.getByRole('link', { name: /Cetak/i });
    expect(link).toHaveAttribute('href', 'http://x/print');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
