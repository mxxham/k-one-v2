import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, EmptyState } from './Card';

describe('Card', () => {
  it('renders a title and children', () => {
    render(
      <Card title="My Card">
        <p>content</p>
      </Card>,
    );
    expect(screen.getByText('My Card')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('does not render a header without a title', () => {
    render(
      <Card>
        <p>content</p>
      </Card>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('renders actions next to the title', () => {
    render(
      <Card title="T" actions={<button>act</button>}>
        <p>c</p>
      </Card>,
    );
    expect(screen.getByRole('button', { name: 'act' })).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders the message', () => {
    render(<EmptyState message="Tidak ada data" />);
    expect(screen.getByText('Tidak ada data')).toBeInTheDocument();
  });
});
