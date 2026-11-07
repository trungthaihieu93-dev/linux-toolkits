import { catalog, getToolchain } from './catalog';
import { toolchainsName } from './index';

const IDS = [
  'nvm-bun',
  'bun-tools',
  'go',
  'rust',
  'python',
  'pyenv',
  'java',
  'jenv',
  'flutter',
  'android',
  'cpp',
  'docker',
  'claude',
];

describe('catalog invariants', () => {
  it('exposes the package name', () => {
    expect(toolchainsName).toBe('@linux-toolchain/toolchains');
  });

  it('has exactly the bash script ids, in order', () => {
    expect(catalog.map((t) => t.id)).toEqual(IDS);
  });

  it('has labels and descriptions', () => {
    for (const t of catalog) {
      expect(t.label, t.id).toBeTruthy();
      expect(t.description, t.id).toBeTruthy();
    }
  });

  it('requires and addonImplies point at existing components and add-ons', () => {
    for (const t of catalog) {
      for (const r of t.requires ?? []) expect(getToolchain(r), `${t.id} requires ${r}`).toBeDefined();
      for (const [addon, target] of Object.entries(t.addonImplies ?? {})) {
        expect(getToolchain(target), `${t.id} ${addon}`).toBeDefined();
        const addons = t.options.find((o) => o.key === 'addons');
        const known = addons?.kind === 'multi' && addons.choices.some((c) => c.value === addon);
        expect(known, `${t.id} ${addon}`).toBe(true);
      }
    }
  });

  it('options are well formed: unique keys, defaults within choices', () => {
    for (const t of catalog) {
      const keys = t.options.map((o) => o.key);
      expect(new Set(keys).size, t.id).toBe(keys.length);
      for (const o of t.options) {
        const where = `${t.id}.${o.key}`;
        expect(o.key, where).toMatch(/^[a-z][a-z0-9-]*$/);
        if (o.kind === 'confirm') {
          expect(typeof o.default, where).toBe('boolean');
          continue;
        }
        const values = o.choices.map((c) => c.value);
        expect(values.length, where).toBeGreaterThanOrEqual(1);
        expect(new Set(values).size, where).toBe(values.length);
        for (const v of values) expect(v, where).not.toMatch(/[,=\s]/);
        if (o.kind === 'select') {
          expect(values, where).toContain(o.default);
        } else {
          for (const d of o.default) expect(values, where).toContain(d);
          expect(o.default.length, where).toBeGreaterThanOrEqual(o.min ?? 0);
        }
      }
    }
  });

  it('add-ons are a multi option with at most 3 choices', () => {
    for (const t of catalog) {
      const addons = t.options.find((o) => o.key === 'addons');
      if (!addons) continue;
      expect(addons.kind, t.id).toBe('multi');
      if (addons.kind === 'multi') expect(addons.choices.length, t.id).toBeLessThanOrEqual(3);
    }
  });

  it('getToolchain finds by id', () => {
    expect(getToolchain('go')?.label).toBe('Go');
    expect(getToolchain('nope')).toBeUndefined();
  });
});
