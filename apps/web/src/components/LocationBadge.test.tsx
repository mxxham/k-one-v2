import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LocationBadge, { LocationList } from './LocationBadge';

describe('LocationBadge', () => {
  it('renders an em dash for an empty code', () => {
    render(<LocationBadge locationCode="" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the raw code for invalid formats', () => {
    render(<LocationBadge locationCode="UNALLOCATED" />);
    expect(screen.getByText('UNALLOCATED')).toBeInTheDocument();
  });

  it('renders a short badge (rack-level)', () => {
    render(<LocationBadge locationCode="CD01A02" />);
    expect(screen.getByText('CD')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders a full badge including position', () => {
    render(<LocationBadge locationCode="CD01A02" format="full" />);
    expect(screen.getByText('CD01')).toBeInTheDocument();
    expect(screen.getByText('02')).toBeInTheDocument();
  });

  it('renders a detailed badge with level name and position', () => {
    render(<LocationBadge locationCode="CD01A02" format="detailed" />);
    expect(screen.getByText('Level A')).toBeInTheDocument();
    expect(screen.getByText('Bottom • Position 02')).toBeInTheDocument();
  });

  it('shows the level name when requested', () => {
    render(<LocationBadge locationCode="CD01A02" showLevel />);
    expect(screen.getByText('(Bottom)')).toBeInTheDocument();
  });

  it('shows the map icon when requested', () => {
    const { container } = render(<LocationBadge locationCode="CD01A02" showIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

describe('LocationList', () => {
  it('renders "No locations" when empty', () => {
    render(<LocationList locations={[]} />);
    expect(screen.getByText('No locations')).toBeInTheDocument();
  });

  it('renders each location badge', () => {
    render(<LocationList locations={['CD01A02', 'CA02B01']} />);
    expect(screen.getByText('CD')).toBeInTheDocument();
    expect(screen.getByText('CA')).toBeInTheDocument();
  });

  it('caps the display with a +N more marker', () => {
    render(<LocationList locations={['CA01A01', 'CA01A02', 'CA01A03']} maxDisplay={2} />);
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });
});
