// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { useState } from 'react';
import { SchemaField } from './schema-field';
import type { FieldDescriptor, FieldValue } from './types';

beforeAll(() => {
  // jsdom lacks these; radix Select and Slider call them.
  globalThis.ResizeObserver ??= class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
afterEach(cleanup);

/** Renders a field with real state and records every onChange value. */
function mount(
  field: FieldDescriptor,
  initial: FieldValue,
  extra: { modified?: boolean } = {},
) {
  const changes: FieldValue[] = [];
  const onReset = vi.fn();
  function Harness() {
    const [value, setValue] = useState<FieldValue>(initial);
    return (
      <SchemaField
        field={field}
        value={value}
        modified={extra.modified}
        onReset={onReset}
        onChange={(v) => {
          changes.push(v);
          setValue(v);
        }}
      />
    );
  }
  render(<Harness />);
  return { changes, onReset };
}

const last = <T,>(list: T[]) => list[list.length - 1];

describe('SchemaField', () => {
  it('bool: a switch labelled by the key', () => {
    const { changes } = mount(
      { id: 'b', label: 'audible-bell', kind: 'bool' },
      false,
    );
    const sw = screen.getByRole('switch', { name: 'audible-bell' });
    fireEvent.click(sw);
    expect(changes).toEqual([true]);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('enum: a select of the allowed values', () => {
    const { changes } = mount(
      {
        id: 'e',
        label: 'cursor-shape',
        kind: 'enum',
        options: ['block', 'ibeam', 'underline'],
      },
      'block',
    );
    const trigger = screen.getByRole('combobox', { name: 'cursor-shape' });
    expect(trigger.textContent).toContain('block');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'ibeam' }));
    expect(changes).toEqual(['ibeam']);
  });

  it('range: slider plus a number box that rejects out-of-range input', () => {
    const { changes } = mount(
      { id: 'r', label: 'opacity', kind: 'range', min: 0, max: 1, step: 0.05 },
      0.5,
    );
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(last(changes)).toBe(0.55);
    const box = screen.getByRole('spinbutton', { name: 'opacity value' });
    fireEvent.change(box, { target: { value: '2' } });
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(last(changes)).toBe(0.55);
    fireEvent.change(box, { target: { value: '0.25' } });
    expect(last(changes)).toBe(0.25);
  });

  it('number: integers only when the field says so', () => {
    const { changes } = mount(
      { id: 'n', label: 'font-size', kind: 'number', integer: true },
      12,
    );
    const box = screen.getByRole('spinbutton', { name: 'font-size' });
    fireEvent.change(box, { target: { value: '13.5' } });
    expect(changes).toEqual([]);
    fireEvent.change(box, { target: { value: '14' } });
    expect(changes).toEqual([14]);
  });

  it('color: swatch picker and a validated hex box', () => {
    const { changes } = mount(
      { id: 'c', label: 'background', kind: 'color' },
      '#000000',
    );
    const hex = screen.getByRole('textbox', { name: 'background hex value' });
    fireEvent.change(hex, { target: { value: '#12' } });
    expect(hex.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Use #rrggbb')).toBeTruthy();
    expect(changes).toEqual([]);
    fireEvent.change(hex, { target: { value: '#1e1e2e' } });
    expect(changes).toEqual(['#1e1e2e']);
    fireEvent.input(screen.getByLabelText('background colour picker'), {
      target: { value: '#ff0000' },
    });
    expect(last(changes)).toBe('#ff0000');
  });

  it('list: add, edit, reorder and remove rows', () => {
    const { changes } = mount({ id: 'l', label: 'keybind', kind: 'list' }, [
      'a',
      'b',
    ]);
    fireEvent.click(
      screen.getByRole('button', { name: 'Move keybind entry 2 up' }),
    );
    expect(last(changes)).toEqual(['b', 'a']);
    fireEvent.click(screen.getByRole('button', { name: 'Add keybind entry' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'keybind entry 3' }), {
      target: { value: 'c' },
    });
    expect(last(changes)).toEqual(['b', 'a', 'c']);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove keybind entry 1' }),
    );
    expect(last(changes)).toEqual(['a', 'c']);
  });

  it('multi: checkboxes with search and removable chips', () => {
    const { changes } = mount(
      {
        id: 'm',
        label: 'Plugins',
        kind: 'multi',
        options: ['docker', 'git', 'kubectl'],
      },
      ['git'],
    );
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search Plugins' }),
      {
        target: { value: 'dock' },
      },
    );
    expect(screen.queryByRole('checkbox', { name: 'kubectl' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'docker' }));
    expect(last(changes)).toEqual(['git', 'docker']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove git' }));
    expect(last(changes)).toEqual(['docker']);
  });

  it('pairs: key/value rows for a(ss)', () => {
    const { changes } = mount(
      {
        id: 'p',
        label: 'Aliases',
        kind: 'pairs',
        partLabels: ['Name', 'Command'],
      },
      [['ll', 'ls -l']],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add aliases' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name 2' }), {
      target: { value: 'gs' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Command 2' }), {
      target: { value: 'git status' },
    });
    expect(last(changes)).toEqual([
      ['ll', 'ls -l'],
      ['gs', 'git status'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove ll' }));
    expect(last(changes)).toEqual([['gs', 'git status']]);
  });

  it('tuple: two number inputs for (uu)', () => {
    const { changes } = mount(
      {
        id: 't',
        label: 'size',
        kind: 'tuple',
        integer: true,
        min: 0,
        partLabels: ['columns', 'rows'],
      },
      [80, 24],
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: 'size rows' }), {
      target: { value: '40' },
    });
    expect(changes).toEqual([[80, 40]]);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'size columns' }), {
      target: { value: '-1' },
    });
    expect(changes).toHaveLength(1);
  });

  it('theme: searchable list with keyboard choice, preview chip and typed values', () => {
    const { changes } = mount(
      {
        id: 'theme',
        label: 'theme',
        kind: 'theme',
        options: ['Dracula', 'Nord', 'Night Owl'],
        allowCustom: true,
      },
      'Dracula',
    );
    const box = screen.getByRole('combobox', { name: 'Search theme' });
    fireEvent.change(box, { target: { value: 'n' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Use “n”',
      'Nord',
      'Night Owl',
    ]);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(changes).toEqual(['Nord']);
    expect(screen.getAllByText('Nord').length).toBeGreaterThan(0);
    fireEvent.change(box, { target: { value: 'light:Nord,dark:Dracula' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(last(changes)).toBe('light:Nord,dark:Dracula');
  });

  it('font: preview renders in the chosen family', () => {
    const { changes } = mount(
      {
        id: 'f',
        label: 'font-family',
        kind: 'font',
        options: ['JetBrains Mono', 'Fira Code'],
      },
      '',
    );
    const box = screen.getByRole('combobox', { name: 'Search font-family' });
    fireEvent.focus(box);
    fireEvent.click(screen.getByRole('option', { name: 'Fira Code' }));
    expect(changes).toEqual(['Fira Code']);
    const preview = screen.getByText(/Fira Code: AaBb/);
    expect(preview.style.fontFamily).toContain('Fira Code');
  });

  it('text: validation message and modified badge with reset', () => {
    const { changes, onReset } = mount(
      {
        id: 'x',
        label: 'palette',
        kind: 'text',
        validate: (v) => (String(v).includes('/') ? 'No slashes.' : null),
      },
      'Ubuntu',
      { modified: true },
    );
    expect(screen.getByText('modified')).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'palette' });
    act(() => {
      fireEvent.change(box, { target: { value: 'a/b' } });
    });
    expect(screen.getByRole('alert').textContent).toBe('No slashes.');
    expect(changes).toEqual(['a/b']);
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset palette to default' }),
    );
    expect(onReset).toHaveBeenCalledOnce();
  });
});
