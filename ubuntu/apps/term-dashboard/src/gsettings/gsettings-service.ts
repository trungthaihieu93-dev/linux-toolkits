import { randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildSchemaView,
  formatGVariant,
  GVariantError,
  isBackupTimestamp,
  isProfileUuid,
  isSchemaKey,
  isSupportedGVariantType,
  parseGSchemaFiles,
  parseGSettingsList,
  parseGVariant,
  TERMINAL_KINDS,
  type BackupTimestamp,
  type GSchema,
  type GSchemaKey,
  type GSettingsBackupRef,
  type GSettingsSchemaView,
  type GSettingsTerminalInfo,
  type GSettingsTerminalSchemas,
  type GVariantValue,
  type TerminalKind,
  type TerminalProfilesView,
} from '@linux-toolchain/term-config';
import {
  badRequest,
  conflict,
  errorMessage,
  notFound,
  unavailable,
} from '../errors';
import {
  failureText,
  succeeded,
  type CommandResult,
  type CommandRunner,
} from '../exec/command-runner';
import type { FileStore } from '../files/file-store';
import { findExecutable, type Dirs, type Env } from '../system/environment';

/** Static facts about each gsettings-configured terminal. */
interface TerminalDef {
  kind: TerminalKind;
  label: string;
  binary: string;
  /** Schema XML file name prefix in `glib-2.0/schemas`. */
  filePrefix: string;
  schemas: GSettingsTerminalSchemas;
  newUuid: () => string;
}

export const TERMINALS: Readonly<Record<TerminalKind, TerminalDef>> = {
  ptyxis: {
    kind: 'ptyxis',
    label: 'Ptyxis',
    binary: 'ptyxis',
    filePrefix: 'org.gnome.Ptyxis',
    schemas: {
      global: { schema: 'org.gnome.Ptyxis', path: '/org/gnome/Ptyxis/' },
      shortcuts: {
        schema: 'org.gnome.Ptyxis.Shortcuts',
        path: '/org/gnome/Ptyxis/Shortcuts/',
      },
      profileList: {
        schema: 'org.gnome.Ptyxis',
        path: '/org/gnome/Ptyxis/',
        key: 'profile-uuids',
      },
      defaultProfile: {
        schema: 'org.gnome.Ptyxis',
        path: '/org/gnome/Ptyxis/',
        key: 'default-profile-uuid',
      },
      profile: 'org.gnome.Ptyxis.Profile',
      profilePathPrefix: '/org/gnome/Ptyxis/Profiles/',
      labelKey: 'label',
    },
    newUuid: () => randomUUID().replace(/-/g, ''),
  },
  'gnome-terminal': {
    kind: 'gnome-terminal',
    label: 'GNOME Terminal',
    binary: 'gnome-terminal',
    filePrefix: 'org.gnome.Terminal',
    // Ids from gnome-terminal's org.gnome.Terminal.gschema.xml. The schema is
    // not installed on the development machine; paths are taken from the
    // parsed XML when a schema declares its own.
    schemas: {
      global: {
        schema: 'org.gnome.Terminal.Legacy.Settings',
        path: '/org/gnome/terminal/legacy/',
      },
      shortcuts: {
        schema: 'org.gnome.Terminal.Legacy.Keybindings',
        path: '/org/gnome/terminal/legacy/keybindings/',
      },
      profileList: {
        schema: 'org.gnome.Terminal.ProfilesList',
        path: '/org/gnome/terminal/legacy/profiles:/',
        key: 'list',
      },
      defaultProfile: {
        schema: 'org.gnome.Terminal.ProfilesList',
        path: '/org/gnome/terminal/legacy/profiles:/',
        key: 'default',
      },
      profile: 'org.gnome.Terminal.Legacy.Profile',
      profilePathPrefix: '/org/gnome/terminal/legacy/profiles:/:',
      labelKey: 'visible-name',
    },
    newUuid: () => randomUUID(),
  },
};

export type SchemaTarget =
  | { part: 'global' }
  | { part: 'shortcuts' }
  | { part: 'profile'; uuid: string };

interface Resolved {
  schema: GSchema;
  path: string | null;
  /** `SCHEMA` or `SCHEMA:PATH`, as gsettings takes it. */
  arg: string;
}

/** Saved state of one terminal in a gsettings JSON backup. */
interface TerminalBackup {
  kind: TerminalKind;
  profileUuids: string[];
  entries: {
    schema: string;
    path: string | null;
    values: Record<string, string>;
  }[];
}

interface GSettingsBackupFile {
  version: 1;
  created: string;
  terminals: TerminalBackup[];
}

export const GSETTINGS_BACKUP_NAME = 'gsettings.json';
const MAX_LABEL = 256;
const MAX_VALUE = 64 * 1024;

const schemaArg = (schema: string, path: string | null) =>
  path ? `${schema}:${path}` : schema;

/**
 * Ptyxis and GNOME Terminal settings through the `gsettings` CLI only. The
 * `dconf` CLI ignores `GSETTINGS_BACKEND`, so using it would bypass a
 * sandboxed backend and touch the real database.
 *
 * Metadata comes from the schema XML (parsed once per run); values from one
 * `gsettings list-recursively SCHEMA[:PATH]`; effective defaults (vendor
 * overrides applied) from the same command with `GSETTINGS_BACKEND=memory`.
 */
export class GSettingsService {
  private readonly schemaCache = new Map<
    TerminalKind,
    Promise<GSchema[] | null>
  >();
  private readonly defaultsCache = new Map<
    string,
    Promise<Record<string, string>>
  >();
  private readonly versionCache = new Map<
    TerminalKind,
    Promise<string | null>
  >();
  private backupDone: Promise<GSettingsBackupRef | null> | null = null;

  constructor(
    private readonly runner: CommandRunner,
    private readonly files: FileStore,
    private readonly dirs: Dirs,
    private readonly env: Env,
  ) {}

  // -------------------------------------------------------------------------
  // Inventory and schema metadata

  async info(kind: TerminalKind): Promise<GSettingsTerminalInfo> {
    const def = TERMINALS[kind];
    const [binary, schemas] = await Promise.all([
      findExecutable(def.binary, this.env),
      this.loadSchemas(kind),
    ]);
    return {
      kind,
      label: def.label,
      installed: binary !== null,
      version: binary ? await this.version(kind) : null,
      schemas: schemas ? this.schemasFor(kind, schemas) : null,
    };
  }

  /** Schema XML of `kind`, or null when its schemas are not installed. */
  loadSchemas(kind: TerminalKind): Promise<GSchema[] | null> {
    let cached = this.schemaCache.get(kind);
    if (!cached) {
      cached = this.readSchemaXml(kind).catch((error: unknown) => {
        this.schemaCache.delete(kind);
        throw error;
      });
      this.schemaCache.set(kind, cached);
    }
    return cached;
  }

  private async readSchemaXml(kind: TerminalKind): Promise<GSchema[] | null> {
    const def = TERMINALS[kind];
    const dirs = [this.dirs.dataHome, ...this.dirs.dataDirs].map((d) =>
      join(d, 'glib-2.0', 'schemas'),
    );
    // The first folder that provides a file name wins, like gsettings.
    const texts = new Map<string, string>();
    for (const dir of dirs) {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of names.sort()) {
        if (!name.startsWith(`${def.filePrefix}.`) || !name.endsWith('.xml')) {
          continue;
        }
        if (texts.has(name)) continue;
        texts.set(name, await readFile(join(dir, name), 'utf8'));
      }
    }
    if (texts.size === 0) return null;
    const schemas = parseGSchemaFiles([...texts.values()]);
    const ids = new Set(schemas.map((s) => s.schemaId));
    const s = def.schemas;
    if (
      !ids.has(s.global.schema) ||
      !ids.has(s.profile) ||
      !ids.has(s.profileList.schema)
    ) {
      return null;
    }
    return schemas;
  }

  private schemasFor(
    kind: TerminalKind,
    schemas: GSchema[],
  ): GSettingsTerminalSchemas {
    const s = TERMINALS[kind].schemas;
    const pathOf = (id: string, fallback: string | null) =>
      schemas.find((x) => x.schemaId === id)?.path ?? fallback;
    const hasShortcuts =
      s.shortcuts !== null &&
      schemas.some((x) => x.schemaId === s.shortcuts?.schema);
    return {
      ...s,
      global: { ...s.global, path: pathOf(s.global.schema, s.global.path) },
      shortcuts:
        hasShortcuts && s.shortcuts
          ? {
              ...s.shortcuts,
              path: pathOf(s.shortcuts.schema, s.shortcuts.path),
            }
          : null,
    };
  }

  private version(kind: TerminalKind): Promise<string | null> {
    let cached = this.versionCache.get(kind);
    if (!cached) {
      cached = this.runner
        .run([TERMINALS[kind].binary, '--version'], { timeoutMs: 10_000 })
        .then((r) =>
          succeeded(r) ? (/(\d+(?:\.\d+)+)/.exec(r.stdout)?.[1] ?? null) : null,
        );
      this.versionCache.set(kind, cached);
    }
    return cached;
  }

  private async requireSchemas(kind: TerminalKind): Promise<GSchema[]> {
    const schemas = await this.loadSchemas(kind);
    if (!schemas) {
      throw unavailable(`${TERMINALS[kind].label} schemas are not installed`);
    }
    return schemas;
  }

  /** gsettings argument for a schema, using the fixed path only when relocatable. */
  private resolveRef(
    schemas: GSchema[],
    id: string,
    path: string | null,
  ): Resolved {
    const schema = schemas.find((s) => s.schemaId === id);
    if (!schema) throw unavailable(`schema ${id} is not installed`);
    const effective = schema.path ?? path;
    if (effective === null) throw new Error(`schema ${id} needs a path`);
    return {
      schema,
      path: effective,
      arg: schemaArg(id, schema.path ? null : effective),
    };
  }

  private async resolve(
    kind: TerminalKind,
    target: SchemaTarget,
  ): Promise<Resolved> {
    const schemas = await this.requireSchemas(kind);
    const s = TERMINALS[kind].schemas;
    if (target.part === 'global')
      return this.resolveRef(schemas, s.global.schema, s.global.path);
    if (target.part === 'shortcuts') {
      if (
        !s.shortcuts ||
        !schemas.some((x) => x.schemaId === s.shortcuts?.schema)
      ) {
        throw notFound(`${TERMINALS[kind].label} has no shortcuts schema`);
      }
      return this.resolveRef(schemas, s.shortcuts.schema, s.shortcuts.path);
    }
    if (!isProfileUuid(kind, target.uuid))
      throw badRequest('invalid profile uuid');
    return this.resolveRef(
      schemas,
      s.profile,
      `${s.profilePathPrefix}${target.uuid}/`,
    );
  }

  // -------------------------------------------------------------------------
  // gsettings calls

  private async gsettings(
    argv: string[],
    env?: Record<string, string>,
  ): Promise<CommandResult> {
    const full = ['gsettings', ...argv];
    const result = await this.runner.run(full, env ? { env } : {});
    if (result.notFound) throw unavailable('gsettings is not installed');
    if (!succeeded(result))
      throw badRequest('gsettings failed', failureText(full, result));
    return result;
  }

  private async listValues(r: Resolved): Promise<Record<string, string>> {
    const out = await this.gsettings(['list-recursively', r.arg]);
    return parseGSettingsList(out.stdout)[r.schema.schemaId] ?? {};
  }

  /** Effective defaults; the same for every path of a relocatable schema. */
  private defaults(r: Resolved): Promise<Record<string, string>> {
    const key = r.schema.schemaId;
    let cached = this.defaultsCache.get(key);
    if (!cached) {
      cached = this.gsettings(['list-recursively', r.arg], {
        GSETTINGS_BACKEND: 'memory',
      })
        .then((out) => parseGSettingsList(out.stdout)[key] ?? {})
        .catch((error: unknown) => {
          this.defaultsCache.delete(key);
          throw error;
        });
      this.defaultsCache.set(key, cached);
    }
    return cached;
  }

  async view(
    kind: TerminalKind,
    target: SchemaTarget,
  ): Promise<GSettingsSchemaView> {
    const r = await this.resolve(kind, target);
    if (target.part === 'profile') await this.requireProfile(kind, target.uuid);
    const [values, defaults] = await Promise.all([
      this.listValues(r),
      this.defaults(r),
    ]);
    return buildSchemaView(r.schema, values, defaults, r.path);
  }

  private keyOf(r: Resolved, key: unknown): GSchemaKey {
    if (!isSchemaKey(key, r.schema)) {
      throw badRequest(`unknown key for ${r.schema.schemaId}`);
    }
    return r.schema.keys.find((k) => k.name === key) as GSchemaKey;
  }

  async set(
    kind: TerminalKind,
    target: SchemaTarget,
    key: unknown,
    value: unknown,
  ): Promise<void> {
    const r = await this.resolve(kind, target);
    if (target.part === 'profile') await this.requireProfile(kind, target.uuid);
    const k = this.keyOf(r, key);
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > MAX_VALUE
    ) {
      throw badRequest('value must be GVariant text');
    }
    validateValue(k, value);
    await this.ensureBackup();
    await this.gsettings(['set', r.arg, k.name, value]);
  }

  async reset(
    kind: TerminalKind,
    target: SchemaTarget,
    key: unknown,
  ): Promise<void> {
    const r = await this.resolve(kind, target);
    if (target.part === 'profile') await this.requireProfile(kind, target.uuid);
    const k = this.keyOf(r, key);
    await this.ensureBackup();
    await this.gsettings(['reset', r.arg, k.name]);
  }

  // -------------------------------------------------------------------------
  // Profiles

  private async readList(
    kind: TerminalKind,
  ): Promise<{ uuids: string[]; defaultUuid: string | null }> {
    const schemas = await this.requireSchemas(kind);
    const s = TERMINALS[kind].schemas;
    const listRef = this.resolveRef(
      schemas,
      s.profileList.schema,
      s.profileList.path,
    );
    const values = await this.listValues(listRef);
    let defaultValues = values;
    if (s.defaultProfile.schema !== s.profileList.schema) {
      defaultValues = await this.listValues(
        this.resolveRef(
          schemas,
          s.defaultProfile.schema,
          s.defaultProfile.path,
        ),
      );
    }
    const uuids = asStrings(values[s.profileList.key], 'as').filter((u) =>
      isProfileUuid(kind, u),
    );
    const def = asStrings(defaultValues[s.defaultProfile.key], 's')[0] ?? '';
    return { uuids, defaultUuid: isProfileUuid(kind, def) ? def : null };
  }

  private async requireProfile(
    kind: TerminalKind,
    uuid: string,
  ): Promise<string[]> {
    const { uuids } = await this.readList(kind);
    if (!uuids.includes(uuid))
      throw notFound(`no ${TERMINALS[kind].label} profile ${uuid}`);
    return uuids;
  }

  private async writeList(kind: TerminalKind, uuids: string[]): Promise<void> {
    const schemas = await this.requireSchemas(kind);
    const s = TERMINALS[kind].schemas;
    const ref = this.resolveRef(
      schemas,
      s.profileList.schema,
      s.profileList.path,
    );
    await this.gsettings([
      'set',
      ref.arg,
      s.profileList.key,
      formatGVariant(uuids, 'as'),
    ]);
  }

  async profiles(kind: TerminalKind): Promise<TerminalProfilesView> {
    const { uuids, defaultUuid } = await this.readList(kind);
    const labelKey = TERMINALS[kind].schemas.labelKey;
    const profiles = [];
    for (const uuid of uuids) {
      const r = await this.resolve(kind, { part: 'profile', uuid });
      const out = await this.gsettings(['get', r.arg, labelKey]);
      profiles.push({
        uuid,
        label: asStrings(out.stdout.trim(), 's')[0] ?? '',
        isDefault: uuid === defaultUuid,
      });
    }
    return { kind, defaultUuid, profiles };
  }

  async createProfile(kind: TerminalKind, label: unknown): Promise<string> {
    const text = checkLabel(label);
    const { uuids } = await this.readList(kind);
    const uuid = TERMINALS[kind].newUuid();
    const r = await this.resolve(kind, { part: 'profile', uuid });
    await this.ensureBackup();
    await this.gsettings([
      'set',
      r.arg,
      TERMINALS[kind].schemas.labelKey,
      formatGVariant(text, 's'),
    ]);
    await this.writeList(kind, [...uuids, uuid]);
    return uuid;
  }

  /** Copy every non-default key of `uuid` into a new profile. */
  async duplicateProfile(
    kind: TerminalKind,
    uuid: string,
    label?: unknown,
  ): Promise<string> {
    const source = await this.resolve(kind, { part: 'profile', uuid });
    const uuids = await this.requireProfile(kind, uuid);
    const labelKey = TERMINALS[kind].schemas.labelKey;
    const view = buildSchemaView(
      source.schema,
      await this.listValues(source),
      await this.defaults(source),
      source.path,
    );
    let text: string;
    if (label === undefined || label === '') {
      const current = view.keys.find((k) => k.name === labelKey);
      const name = current ? (asStrings(current.value, 's')[0] ?? '') : '';
      text = `${name || 'Profile'} (copy)`.slice(0, MAX_LABEL);
    } else {
      text = checkLabel(label);
    }
    const copy = TERMINALS[kind].newUuid();
    const target = await this.resolve(kind, { part: 'profile', uuid: copy });
    await this.ensureBackup();
    for (const key of view.keys) {
      if (key.isDefault || key.name === labelKey) continue;
      await this.gsettings(['set', target.arg, key.name, key.value]);
    }
    await this.gsettings([
      'set',
      target.arg,
      labelKey,
      formatGVariant(text, 's'),
    ]);
    await this.writeList(kind, [...uuids, copy]);
    return copy;
  }

  /** Remove from the list, then reset every key at the profile's path. Never the default. */
  async deleteProfile(kind: TerminalKind, uuid: string): Promise<void> {
    const r = await this.resolve(kind, { part: 'profile', uuid });
    const { uuids, defaultUuid } = await this.readList(kind);
    if (!uuids.includes(uuid))
      throw notFound(`no ${TERMINALS[kind].label} profile ${uuid}`);
    if (uuid === defaultUuid)
      throw conflict('the default profile cannot be deleted');
    await this.ensureBackup();
    await this.writeList(
      kind,
      uuids.filter((u) => u !== uuid),
    );
    await this.gsettings(['reset-recursively', r.arg]);
  }

  async setDefaultProfile(kind: TerminalKind, uuid: string): Promise<void> {
    await this.resolve(kind, { part: 'profile', uuid });
    await this.requireProfile(kind, uuid);
    const schemas = await this.requireSchemas(kind);
    const s = TERMINALS[kind].schemas;
    const ref = this.resolveRef(
      schemas,
      s.defaultProfile.schema,
      s.defaultProfile.path,
    );
    await this.ensureBackup();
    await this.gsettings([
      'set',
      ref.arg,
      s.defaultProfile.key,
      formatGVariant(uuid, 's'),
    ]);
  }

  // -------------------------------------------------------------------------
  // JSON backup and restore

  /** Take the per-run backup before the first write; later calls reuse it. */
  ensureBackup(): Promise<GSettingsBackupRef | null> {
    if (!this.backupDone) {
      this.backupDone = this.backup().catch((error: unknown) => {
        this.backupDone = null;
        throw new Error(
          `gsettings backup failed, nothing was changed: ${errorMessage(error)}`,
        );
      });
    }
    return this.backupDone;
  }

  /** Every installed terminal's global, shortcuts and profile keys (non-default only). */
  async backup(): Promise<GSettingsBackupRef | null> {
    const terminals: TerminalBackup[] = [];
    for (const kind of TERMINAL_KINDS) {
      const schemas = await this.loadSchemas(kind);
      if (!schemas) continue;
      const { uuids } = await this.readList(kind);
      const targets: SchemaTarget[] = [{ part: 'global' }];
      const s = TERMINALS[kind].schemas;
      if (
        s.shortcuts &&
        schemas.some((x) => x.schemaId === s.shortcuts?.schema)
      ) {
        targets.push({ part: 'shortcuts' });
      }
      for (const uuid of uuids) targets.push({ part: 'profile', uuid });
      const refs = new Map<string, Resolved>();
      for (const t of targets) {
        const r = await this.resolve(kind, t);
        refs.set(r.arg, r);
      }
      // The profile list schema may differ from the global one (GNOME Terminal).
      const listRef = this.resolveRef(
        schemas,
        s.profileList.schema,
        s.profileList.path,
      );
      refs.set(listRef.arg, listRef);
      const entries: TerminalBackup['entries'] = [];
      for (const r of refs.values()) {
        const values = await this.listValues(r);
        const defaults = await this.defaults(r);
        const view = buildSchemaView(r.schema, values, defaults, r.path);
        const changed: Record<string, string> = {};
        for (const k of view.keys) if (!k.isDefault) changed[k.name] = k.value;
        entries.push({
          schema: r.schema.schemaId,
          path: r.schema.path ? null : r.path,
          values: changed,
        });
      }
      terminals.push({ kind, profileUuids: uuids, entries });
    }
    if (terminals.length === 0) return null;
    const file: GSettingsBackupFile = {
      version: 1,
      created: new Date().toISOString(),
      terminals,
    };
    const { ts, path } = await this.files.writePrivateBackup(
      GSETTINGS_BACKUP_NAME,
      `${JSON.stringify(file, null, 2)}\n`,
    );
    return { ts, path, kinds: terminals.map((t) => t.kind) };
  }

  async listBackups(): Promise<GSettingsBackupRef[]> {
    const out: GSettingsBackupRef[] = [];
    for (const ts of await this.files.backupTimestamps()) {
      const path = join(this.files.backupsDir, ts, GSETTINGS_BACKUP_NAME);
      try {
        if (!(await stat(path)).isFile()) continue;
        const parsed = parseBackup(await readFile(path, 'utf8'));
        out.push({ ts, path, kinds: parsed.terminals.map((t) => t.kind) });
      } catch {
        // Missing or unreadable backups are not listed.
      }
    }
    return out;
  }

  /**
   * For each saved terminal: reset profiles created after the backup, reset
   * every saved schema/path, then set every saved key.
   */
  async restore(ts: BackupTimestamp): Promise<TerminalKind[]> {
    if (!isBackupTimestamp(ts)) throw badRequest('invalid backup timestamp');
    const path = join(this.files.backupsDir, ts, GSETTINGS_BACKUP_NAME);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      throw notFound(`no gsettings backup at ${ts}`);
    }
    const saved = parseBackup(text);
    // Validate everything before changing anything.
    const plan: {
      kind: TerminalKind;
      extra: Resolved[];
      entries: { r: Resolved; values: [GSchemaKey, string][] }[];
    }[] = [];
    for (const t of saved.terminals) {
      const schemas = await this.requireSchemas(t.kind);
      const s = TERMINALS[t.kind].schemas;
      const allowed = new Set([
        s.global.schema,
        s.profileList.schema,
        s.defaultProfile.schema,
        s.profile,
      ]);
      if (s.shortcuts) allowed.add(s.shortcuts.schema);
      const entries = t.entries.map((e) => {
        if (!allowed.has(e.schema))
          throw badRequest(`backup names an unexpected schema ${e.schema}`);
        let r: Resolved;
        if (e.schema === s.profile) {
          const uuid = e.path?.startsWith(s.profilePathPrefix)
            ? e.path.slice(s.profilePathPrefix.length, -1)
            : '';
          if (
            !isProfileUuid(t.kind, uuid) ||
            e.path !== `${s.profilePathPrefix}${uuid}/`
          ) {
            throw badRequest(
              `backup has an invalid profile path ${String(e.path)}`,
            );
          }
          r = this.resolveRef(schemas, e.schema, e.path);
        } else {
          const ref = [
            s.global,
            s.profileList,
            s.defaultProfile,
            s.shortcuts,
          ].find((x) => x?.schema === e.schema);
          r = this.resolveRef(schemas, e.schema, ref?.path ?? null);
        }
        const values = Object.entries(e.values).map(
          ([key, value]): [GSchemaKey, string] => {
            const k = this.keyOf(r, key);
            validateValue(k, value);
            return [k, value];
          },
        );
        return { r, values };
      });
      const { uuids } = await this.readList(t.kind);
      const extra = uuids
        .filter((u) => !t.profileUuids.includes(u))
        .map((u) =>
          this.resolveRef(schemas, s.profile, `${s.profilePathPrefix}${u}/`),
        );
      plan.push({ kind: t.kind, extra, entries });
    }
    await this.ensureBackup();
    for (const p of plan) {
      for (const r of p.extra)
        await this.gsettings(['reset-recursively', r.arg]);
      for (const { r } of p.entries)
        await this.gsettings(['reset-recursively', r.arg]);
      for (const { r, values } of p.entries) {
        for (const [k, value] of values)
          await this.gsettings(['set', r.arg, k.name, value]);
      }
    }
    return plan.map((p) => p.kind);
  }
}

// ---------------------------------------------------------------------------
// Helpers

function checkLabel(label: unknown): string {
  if (
    typeof label !== 'string' ||
    label.trim() === '' ||
    label.length > MAX_LABEL ||
    /[\0\r\n]/.test(label)
  ) {
    throw badRequest(`label must be 1-${MAX_LABEL} characters on one line`);
  }
  return label.trim();
}

/** Strings of a GVariant `s`/`as` value; [] when absent or malformed. */
function asStrings(text: string | undefined, type: 's' | 'as'): string[] {
  if (text === undefined) return [];
  try {
    const value: GVariantValue = parseGVariant(text, type);
    if (type === 's') return typeof value === 'string' ? [value] : [];
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Check GVariant text against the key's type, enum, flags, range and choices. */
export function validateValue(key: GSchemaKey, text: string): void {
  if (!isSupportedGVariantType(key.type)) return; // gsettings itself validates
  let value: GVariantValue;
  try {
    value = parseGVariant(text, key.type);
  } catch (error) {
    const why = error instanceof GVariantError ? error.message : String(error);
    throw badRequest(`invalid value for ${key.name}`, why);
  }
  const allowed = key.enum ?? key.choices;
  if (allowed && (typeof value !== 'string' || !allowed.includes(value))) {
    throw badRequest(`${key.name} must be one of ${allowed.join(', ')}`);
  }
  if (
    key.flags &&
    Array.isArray(value) &&
    value.some((v) => typeof v !== 'string' || !key.flags?.includes(v))
  ) {
    throw badRequest(`${key.name} accepts only ${key.flags.join(', ')}`);
  }
  if (
    key.range &&
    typeof value === 'number' &&
    (value < key.range.min || value > key.range.max)
  ) {
    throw badRequest(
      `${key.name} must be between ${key.range.min} and ${key.range.max}`,
    );
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse and shape-check a gsettings backup file. */
export function parseBackup(text: string): GSettingsBackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw badRequest('gsettings backup is not valid JSON');
  }
  const bad = () => badRequest('gsettings backup has an unexpected shape');
  if (
    !isRecord(raw) ||
    raw['version'] !== 1 ||
    !Array.isArray(raw['terminals'])
  )
    throw bad();
  const terminals = raw['terminals'].map((t): TerminalBackup => {
    if (!isRecord(t) || !TERMINAL_KINDS.includes(t['kind'] as TerminalKind))
      throw bad();
    const uuids = t['profileUuids'];
    const entries = t['entries'];
    if (!Array.isArray(uuids) || !uuids.every((u) => typeof u === 'string'))
      throw bad();
    if (!Array.isArray(entries)) throw bad();
    return {
      kind: t['kind'] as TerminalKind,
      profileUuids: uuids as string[],
      entries: entries.map((e) => {
        if (!isRecord(e) || typeof e['schema'] !== 'string') throw bad();
        const path = e['path'];
        if (path !== null && typeof path !== 'string') throw bad();
        const values = e['values'];
        if (
          !isRecord(values) ||
          !Object.values(values).every((v) => typeof v === 'string')
        )
          throw bad();
        return {
          schema: e['schema'],
          path,
          values: values as Record<string, string>,
        };
      }),
    };
  });
  return {
    version: 1,
    created: typeof raw['created'] === 'string' ? raw['created'] : '',
    terminals,
  };
}
