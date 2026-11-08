// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { CodeEditor } from './monaco-editors';

const BOM = '\uFEFF';

/**
 * A stand-in for `@monaco-editor/react`'s Editor that keeps its text the way
 * Monaco does: the model drops a leading BOM when it is created, `onChange`
 * passes the model text, and a later `value` prop that differs from the model
 * text is applied as an edit, verbatim.
 */
const fake = vi.hoisted(() => ({
  text: null as string | null,
  onChange: undefined as ((v: string | undefined) => void) | undefined,
}));

vi.mock('@monaco-editor/react', () => ({
  Editor: (props: {
    value?: string;
    onChange?: (v: string | undefined) => void;
  }) => {
    const value = props.value ?? '';
    if (fake.text === null) fake.text = value.replace(/^\uFEFF/, '');
    else if (value !== fake.text) fake.text = value;
    fake.onChange = props.onChange;
    return null;
  },
  DiffEditor: () => null,
}));

vi.mock('./monaco-setup', () => ({ applyMonacoTheme: () => undefined }));
vi.mock('../../lib/theme', () => ({ useTheme: () => ({ theme: 'dark' }) }));

/** The user types `edit` over the whole text. */
function type(edit: string) {
  act(() => {
    fake.text = edit;
    fake.onChange?.(edit);
  });
}

function Harness({
  initial,
  onValue,
}: {
  initial: string;
  onValue: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CodeEditor
      value={value}
      onChange={(v) => {
        onValue(v);
        setValue(v);
      }}
      height="10px"
      ariaLabel="file"
    />
  );
}

beforeEach(() => {
  fake.text = null;
  fake.onChange = undefined;
});
afterEach(cleanup);

describe('CodeEditor', () => {
  it('keeps a leading BOM in the edited value', () => {
    const values: string[] = [];
    render(<Harness initial={`${BOM}a=1\n`} onValue={(v) => values.push(v)} />);
    type('a=2\n');
    type('a=3\n');
    expect(values).toEqual([`${BOM}a=2\n`, `${BOM}a=3\n`]);
    // The editor text never gains a visible U+FEFF character.
    expect(fake.text).toBe('a=3\n');
  });

  it('adds no BOM to a file that had none', () => {
    const values: string[] = [];
    render(<Harness initial={'a=1\n'} onValue={(v) => values.push(v)} />);
    type('a=2\n');
    expect(values).toEqual(['a=2\n']);
    expect(fake.text).toBe('a=2\n');
  });
});
