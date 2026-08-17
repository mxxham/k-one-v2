import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders known statuses', () => {
    const { rerender } = render(<StatusBadge status="Dues In" />);
    expect(screen.getByText('Dues In')).toBeInTheDocument();
    rerender(<StatusBadge status="Completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('falls back to a dash for null/undefined', () => {
    const { rerender } = render(<StatusBadge />);
    expect(screen.getByText('—')).toBeInTheDocument();
    rerender(<StatusBadge status={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders unknown statuses with the default style', () => {
    render(<StatusBadge status="Mystery" />);
    const span = screen.getByText('Mystery');
    expect(span).toBeInTheDocument();
    expect(span.className).toContain('bg-gray-100');
  });
});
