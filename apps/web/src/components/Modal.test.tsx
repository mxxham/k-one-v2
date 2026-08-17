import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import Modal from './Modal';

function ModalHarness() {
  const [open, setOpen] = useState(true);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Test Modal" size="sm">
      <p>modal body</p>
    </Modal>
  );
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        <p>body</p>
      </Modal>,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('renders the title and children when open', () => {
    render(
      <Modal open onClose={() => {}} title="Visible">
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByText('Visible')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<ModalHarness />);
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByText('Test Modal')).not.toBeInTheDocument();
  });

  it('closes via the X button', () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Test Modal')).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T">
        <p>body</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalled();
  });
});
