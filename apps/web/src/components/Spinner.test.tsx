import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Spinner from './Spinner';

describe('Spinner', () => {
  it('renders the spinner with a label', () => {
    render(<Spinner label="Loading…" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders without a label', () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });
});
