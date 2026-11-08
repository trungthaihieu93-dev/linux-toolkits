// @vitest-environment jsdom
import type { SavePreview } from '@linux-toolchain/term-config';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTwoFilesPatch } from 'diff';
import { SaveReviewDialog } from './save-review-dialog';
import { backupNote, originalFromPreview } from './preview-text';

// Monaco does not run in jsdom; the diff viewer is replaced by its inputs.
vi.mock('../monaco/lazy-editors', () => ({
  LazyDiffViewer: (p: {
    original: string;
    modified: string;
    ariaLabel: string;
  }) => <pre aria-label={p.ariaLabel}>{`${p.original}=>${p.modified}`}</pre>,
  LazyCodeEditor: () => null,
}));

afterEach(cleanup);

const PATH = '/home/u/.bashrc';
function preview(over: Partial<SavePreview> = {}): SavePreview {
  const current = 'echo one\n';
  const candidate = over.candidate ?? 'echo two\n';
  return {
    fileId: 'bashrc',
    path: PATH,
    diff: createTwoFilesPatch(
      PATH,
      PATH,
      current,
      candidate,
      'current',
      'candidate',
    ),
    changed: true,
    check: { ok: true, argv: ['bash', '-n', PATH], output: '' },
    baseMtimeMs: 1000,
    candidate,
    backupDir: '/home/u/.local/state/term-dashboard/backups',
    ...over,
  };
}

function mount(previews: SavePreview[], onApply = vi.fn()) {
  render(
    <SaveReviewDialog
      open
      onOpenChange={() => undefined}
      title="Save .bashrc"
      previews={previews}
      onApply={onApply}
    />,
  );
  return onApply;
}

const apply = () =>
  screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;

describe('SaveReviewDialog', () => {
  it('shows the diff, check and backup location and applies on a passing check', () => {
    const onApply = mount([preview()]);
    expect(screen.getByLabelText(`Changes to ${PATH}`).textContent).toBe(
      'echo one\n=>echo two\n',
    );
    expect(screen.getByText('passed')).toBeTruthy();
    expect(screen.getByText(`bash -n ${PATH}`)).toBeTruthy();
    expect(
      screen.getByText(
        `${PATH} is copied to /home/u/.local/state/term-dashboard/backups/<timestamp>/bashrc before it is replaced.`,
      ),
    ).toBeTruthy();
    expect(apply().disabled).toBe(false);
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('disables Apply and shows the output when the check fails', () => {
    const onApply = mount([
      preview({
        candidate: 'if then\n',
        check: {
          ok: false,
          argv: ['bash', '-n', PATH],
          output: `${PATH}: line 1: syntax error near unexpected token \`then'`,
        },
      }),
    ]);
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText(/syntax error near unexpected token/)).toBeTruthy();
    expect(apply().disabled).toBe(true);
    expect(apply().getAttribute('aria-describedby')).toBe(
      'save-blocked-reason',
    );
    expect(
      screen.getByText(
        'The syntax check failed. Fix the errors before saving.',
      ),
    ).toBeTruthy();
    fireEvent.click(apply());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('disables Apply when any of several files fails its check', () => {
    mount([
      preview(),
      preview({
        fileId: 'zshrc',
        path: '/home/u/.zshrc',
        check: { ok: false, argv: ['zsh', '-n'], output: 'parse error' },
      }),
    ]);
    expect(apply().disabled).toBe(true);
  });

  it('allows Apply when a check was skipped because its tool is missing', () => {
    mount([
      preview({
        check: {
          ok: true,
          argv: [],
          output: '',
          skipped: 'zsh is not installed',
        },
      }),
    ]);
    expect(screen.getByText('skipped')).toBeTruthy();
    expect(apply().disabled).toBe(false);
  });

  it('disables Apply when nothing would change', () => {
    mount([preview({ changed: false, diff: '', candidate: 'echo one\n' })]);
    expect(screen.getByText('no changes')).toBeTruthy();
    expect(apply().disabled).toBe(true);
  });
});

describe('preview text helpers', () => {
  it('rebuilds the current content from the diff', () => {
    expect(originalFromPreview(preview())).toBe('echo one\n');
    expect(originalFromPreview(preview({ baseMtimeMs: null }))).toBe('');
    expect(originalFromPreview(preview({ diff: 'not a diff @@' }))).toBeNull();
  });

  it('describes the backup or its absence', () => {
    expect(backupNote(preview({ baseMtimeMs: null }))).toBe(
      'No backup: the file does not exist yet.',
    );
  });
});
