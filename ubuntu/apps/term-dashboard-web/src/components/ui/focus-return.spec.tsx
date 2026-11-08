// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from './dialog';

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Review and save
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Review</DialogTitle>
          <button type="button">Apply</button>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('dialogs opened from code', () => {
  it('return focus to the element that opened them', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Review and save' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog');
    await waitFor(() =>
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(
        true,
      ),
    );
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
