// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { ActivityStore } from '../../lib/activity';
import { ActivityList } from './activity-list';

function LiveList({ store }: { store: ActivityStore }) {
  const commands = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <ActivityList commands={commands} />;
}

describe('ActivityList', () => {
  it('renders a started/output/exited sequence as it streams', async () => {
    const store = new ActivityStore();
    render(<LiveList store={store} />);
    expect(screen.getByText(/No commands yet/)).toBeTruthy();

    act(() =>
      store.apply({
        type: 'started',
        id: 'c1',
        ts: 0,
        argv: ['zsh', '-n', '/tmp/td x'],
      }),
    );
    const row = screen.getByTestId('activity-row');
    expect(row.textContent).toContain('zsh -n /tmp/td x');
    expect(within(row).getByText('running')).toBeTruthy();

    act(() => {
      store.apply({
        type: 'output',
        id: 'c1',
        ts: 1,
        stream: 'stdout',
        chunk: 'ok line\n',
      });
      store.apply({
        type: 'output',
        id: 'c1',
        ts: 2,
        stream: 'stderr',
        chunk: 'warn line\n',
      });
      store.apply({
        type: 'output',
        id: 'c1',
        ts: 3,
        stream: 'stdout',
        chunk: 'output truncated',
        truncatedBytes: 190_000,
      });
      store.apply({
        type: 'exited',
        id: 'c1',
        ts: 4,
        code: 0,
        signal: null,
        durationMs: 1250,
      });
    });
    expect(within(row).getByText('exit 0')).toBeTruthy();
    expect(row.textContent).toContain('1.25 s');

    const toggle = within(row).getByRole('button', { name: /Show output of/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const output = within(row).getByLabelText('Output of zsh -n /tmp/td x');
    const stdout = within(output).getByText(/ok line/);
    const stderr = within(output).getByText(/warn line/);
    expect(stdout.getAttribute('data-stream')).toBe('stdout');
    expect(stderr.getAttribute('data-stream')).toBe('stderr');
    expect(stderr.className).toContain('text-destructive');
    expect(output.textContent).toContain('[186 KB of output not shown]');
  });

  it('shows failures and copies the command shell-quoted', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const store = new ActivityStore();
    store.apply({
      type: 'started',
      id: 'c2',
      ts: 0,
      argv: ['gsettings', 'set', 'k', 'a b'],
    });
    store.apply({
      type: 'exited',
      id: 'c2',
      ts: 1,
      code: 1,
      signal: null,
      durationMs: 5,
    });
    render(<LiveList store={store} />);

    expect(screen.getByText('exit 1').className).toContain('text-destructive');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    });
    expect(writeText).toHaveBeenCalledWith(`gsettings set k 'a b'`);
    expect(screen.getByRole('button', { name: 'Command copied' })).toBeTruthy();
  });

  it('pauses auto-scroll when the user scrolls up', () => {
    const store = new ActivityStore();
    store.apply({ type: 'started', id: 'a', ts: 0, argv: ['true'] });
    render(<LiveList store={store} />);
    const scroller = screen.getByTestId('activity-scroll');
    Object.defineProperty(scroller, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scroller, 'clientHeight', {
      configurable: true,
      value: 200,
    });

    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    expect(screen.getByRole('button', { name: /Jump to latest/ })).toBeTruthy();

    act(() =>
      store.apply({ type: 'started', id: 'b', ts: 1, argv: ['false'] }),
    );
    expect(scroller.scrollTop).toBe(100);

    fireEvent.click(screen.getByRole('button', { name: /Jump to latest/ }));
    expect(scroller.scrollTop).toBe(1000);
  });
});
