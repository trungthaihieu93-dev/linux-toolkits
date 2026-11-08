// @vitest-environment jsdom
import type { ThemeMode } from '@linux-toolchain/term-config';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import {
  THEME_CACHE_KEY,
  ThemeProvider,
  type ThemeBackend,
} from '../../lib/theme';
import { ThemeToggle } from './theme-toggle';

/** A settings.json stand-in: what `save` stores, `load` returns. */
function fakeSettings(initial: ThemeMode) {
  let stored = initial;
  const backend: ThemeBackend & { save: ReturnType<typeof vi.fn> } = {
    load: vi.fn(async () => ({ theme: stored })),
    save: vi.fn(async (theme: ThemeMode) => {
      stored = theme;
    }),
  };
  return backend;
}

async function mount(
  backend: ThemeBackend,
  onSaveError?: (e: unknown) => void,
) {
  const view = render(
    <ThemeProvider backend={backend} onSaveError={onSaveError}>
      <TooltipProvider>
        <ThemeToggle />
      </TooltipProvider>
    </ThemeProvider>,
  );
  await act(() => Promise.resolve()); // settle the settings load
  return view;
}

const root = document.documentElement;

beforeEach(() => {
  sessionStorage.clear();
  root.classList.add('dark'); // index.html default
});

describe('ThemeToggle', () => {
  it('starts dark and switches to light, persisting through settings', async () => {
    const settings = fakeSettings('dark');
    await mount(settings);
    expect(root.classList.contains('dark')).toBe(true);

    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to light theme' }),
    );

    expect(root.classList.contains('dark')).toBe(false);
    expect(sessionStorage.getItem(THEME_CACHE_KEY)).toBe('light');
    expect(settings.save).toHaveBeenCalledWith('light');
    expect(
      screen.getByRole('button', { name: 'Switch to dark theme' }),
    ).toBeTruthy();
  });

  it('survives a reload: the saved theme comes back from settings', async () => {
    const settings = fakeSettings('dark');
    const first = await mount(settings);
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to light theme' }),
    );
    first.unmount();

    // A new tab (or a td restart): no cache, html back to the dark default.
    sessionStorage.clear();
    root.classList.add('dark');
    await mount(settings);
    expect(root.classList.contains('dark')).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Switch to dark theme' }),
    ).toBeTruthy();
  });

  it('keeps the new theme and reports when saving fails', async () => {
    const onSaveError = vi.fn();
    const backend: ThemeBackend = {
      load: async () => ({ theme: 'dark' }),
      save: async () => {
        throw new Error('HTTP 404');
      },
    };
    await mount(backend, onSaveError);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Switch to light theme' }),
      );
    });
    expect(root.classList.contains('dark')).toBe(false);
    expect(onSaveError).toHaveBeenCalledWith(expect.any(Error));
  });
});
