import type {
  GhosttyConfigView,
  GhosttySchema,
} from '@linux-toolchain/term-config';
import {
  docSummary,
  ghosttyFields,
  ghosttyFormState,
  rawNumberErrors,
  rawNumberKeys,
  stageChange,
  stageReset,
} from './ghostty-fields';

const SCHEMA: GhosttySchema = {
  version: '1.4.0',
  keys: [
    {
      key: 'font-size',
      doc: 'Font size in points. More text.',
      default: '13',
      defaults: ['13'],
      repeatable: false,
      control: 'number',
    },
    {
      key: 'theme',
      doc: 'A theme.',
      default: '',
      defaults: [''],
      repeatable: false,
      control: 'theme',
    },
    {
      key: 'background',
      doc: '',
      default: '#282c34',
      defaults: ['#282c34'],
      repeatable: false,
      control: 'color',
    },
    {
      key: 'keybind',
      doc: 'Keybinds.',
      default: 'ctrl+a=select_all',
      defaults: ['ctrl+a=select_all', 'ctrl+c=copy'],
      repeatable: true,
      control: 'text',
    },
    {
      key: 'cursor-style',
      doc: '',
      default: 'block',
      defaults: ['block'],
      repeatable: false,
      control: 'enum',
      values: ['block', 'bar'],
    },
  ],
};

const CONFIG: GhosttyConfigView = {
  files: [
    {
      id: 'ghostty',
      path: '/c/config.ghostty',
      exists: true,
      mtimeMs: 1,
      includes: [],
      entries: [{ key: 'font-size', value: '12', line: 1 }],
    },
    {
      id: 'ghostty-legacy',
      path: '/c/config',
      exists: true,
      mtimeMs: 2,
      includes: [],
      entries: [
        { key: 'font-size', value: '14', line: 1 },
        { key: 'keybind', value: 'ctrl+t=new_tab', line: 2 },
      ],
    },
  ],
  effective: {
    'font-size': ['14'],
    background: ['#1e1e2e'],
    keybind: ['ctrl+t=new_tab'],
  },
  conflicts: [
    {
      key: 'font-size',
      files: ['ghostty', 'ghostty-legacy'],
      winner: 'ghostty-legacy',
    },
  ],
};

describe('ghostty fields', () => {
  it('maps schema controls to field kinds, grouped by key prefix', () => {
    const fields = ghosttyFields(SCHEMA, ['Dracula'], ['Fira Code']);
    expect(fields.map((f) => [f.id, f.kind, f.group])).toEqual([
      ['font-size', 'number', 'Font'],
      ['theme', 'theme', 'Theme'],
      ['background', 'color', 'Background'],
      ['keybind', 'list', 'Keybind'],
      ['cursor-style', 'enum', 'Cursor'],
    ]);
    expect(fields[1].options).toEqual(['Dracula']);
    expect(docSummary('First sentence. Second one.\n\nMore.')).toBe(
      'First sentence.',
    );
  });

  it('shows the winning file value; theme-only values are not "modified"', () => {
    const state = ghosttyFormState(SCHEMA, CONFIG, new Map());
    expect(state.values['font-size']).toBe(14);
    expect(state.values['background']).toBe('#1e1e2e');
    // Repeatable keys list only what the files set, never the defaults.
    expect(state.values['keybind']).toEqual(['ctrl+t=new_tab']);
    expect([...state.modified].sort()).toEqual(['font-size', 'keybind']);
  });

  it('reads a file shared through a symlink once, so lists do not double', () => {
    const entries = [
      { key: 'font-size', value: '12', line: 1 },
      { key: 'keybind', value: 'ctrl+t=new_tab', line: 2 },
    ];
    const linked: GhosttyConfigView = {
      files: [
        { ...CONFIG.files[0], entries, sameFileAs: 'ghostty-legacy' },
        { ...CONFIG.files[1], entries },
      ],
      effective: {},
      conflicts: [],
    };
    const state = ghosttyFormState(SCHEMA, linked, new Map());
    expect(state.values['keybind']).toEqual(['ctrl+t=new_tab']);
    expect(state.values['font-size']).toBe(12);
    const [, , , keybind] = SCHEMA.keys;
    // The list the form shows matches the file, so nothing is staged.
    expect(
      stageChange(new Map(), keybind, ['ctrl+t=new_tab'], linked).size,
    ).toBe(0);
  });

  it('stages set/setList edits and drops edits that match the files', () => {
    const [size, , , keybind] = SCHEMA.keys;
    let staged = stageChange(new Map(), size, 16, CONFIG);
    expect(staged.get('font-size')).toEqual({
      op: 'set',
      key: 'font-size',
      value: '16',
    });
    staged = stageChange(staged, size, 14, CONFIG);
    expect(staged.has('font-size')).toBe(false);
    staged = stageChange(
      staged,
      keybind,
      ['ctrl+t=new_tab', 'ctrl+w=close_surface'],
      CONFIG,
    );
    expect(staged.get('keybind')).toEqual({
      op: 'setList',
      key: 'keybind',
      values: ['ctrl+t=new_tab', 'ctrl+w=close_surface'],
    });
    expect(
      ghosttyFormState(SCHEMA, CONFIG, staged).values['keybind'],
    ).toHaveLength(2);
  });

  it('resets with unset when a file sets the key', () => {
    const staged = stageReset(new Map(), 'font-size', CONFIG);
    expect(staged.get('font-size')).toEqual({ op: 'unset', key: 'font-size' });
    const state = ghosttyFormState(SCHEMA, CONFIG, staged);
    expect(state.values['font-size']).toBe(13);
    expect(state.modified.has('font-size')).toBe(false);
    expect(stageReset(new Map(), 'theme', CONFIG).size).toBe(0);
  });
});

describe('number keys whose value is not a number', () => {
  const config: GhosttyConfigView = {
    ...CONFIG,
    files: [
      {
        ...CONFIG.files[0],
        entries: [{ key: 'font-size', value: 'big', line: 1 }],
      },
    ],
    effective: {},
    conflicts: [],
  };

  it('shows the text from the file, not 0', () => {
    const raw = rawNumberKeys(SCHEMA, config);
    expect([...raw]).toEqual([['font-size', 'big']]);
    expect(
      ghosttyFormState(SCHEMA, config, new Map()).values['font-size'],
    ).toBe('big');
    // A number from the files keeps the number box.
    expect(rawNumberKeys(SCHEMA, CONFIG).size).toBe(0);
  });

  it('marks the file value and accepts only a number as an edit', () => {
    const raw = rawNumberKeys(SCHEMA, config);
    const field = ghosttyFields(SCHEMA, [], [], raw)[0];
    expect(field.kind).toBe('text');
    expect(field.validate?.('big')).toBeNull();
    expect(field.validate?.('bigger')).toBe('Enter a number.');
    expect(field.validate?.('15.5')).toBeNull();
    expect(rawNumberErrors(raw, new Map())).toEqual({
      'font-size': 'The config holds “big”, which is not a number.',
    });

    const staged = stageChange(new Map(), SCHEMA.keys[0], '15', config);
    expect(staged.get('font-size')).toEqual({
      op: 'set',
      key: 'font-size',
      value: '15',
    });
    expect(rawNumberErrors(raw, staged)).toEqual({});
    expect(ghosttyFormState(SCHEMA, config, staged).values['font-size']).toBe(
      '15',
    );
  });
});
