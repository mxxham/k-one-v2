import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field, TextInput, Select, TextArea, Grid } from './Field';

describe('Field', () => {
  it('renders the label, required marker, hint and children', () => {
    render(
      <Field label="Name" required hint="Nama produk">
        <TextInput />
      </Field>,
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByText('Nama produk')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('omits the required marker and hint when not provided', () => {
    render(
      <Field label="Name">
        <TextInput />
      </Field>,
    );
    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });
});

describe('TextInput / Select / TextArea', () => {
  it('merges passed className onto the base input classes', () => {
    render(<TextInput data-testid="in" className="extra" />);
    const input = screen.getByTestId('in');
    expect(input.className).toContain('border-gray-300');
    expect(input.className).toContain('extra');
  });

  it('renders a select and textarea', () => {
    render(
      <>
        <Select data-testid="sel">
          <option>a</option>
        </Select>
        <TextArea data-testid="ta" />
      </>,
    );
    expect(screen.getByTestId('sel')).toBeInTheDocument();
    expect(screen.getByTestId('ta')).toBeInTheDocument();
  });
});

describe('Grid', () => {
  it('maps column counts to responsive classes', () => {
    const { container } = render(
      <Grid cols={3}>
        <span>a</span>
      </Grid>,
    );
    expect(container.firstElementChild!.className).toContain('md:grid-cols-3');
  });
});
