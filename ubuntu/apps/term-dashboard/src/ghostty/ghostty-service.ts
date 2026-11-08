import {
  entries,
  findConflicts,
  GHOSTTY_KEY_RE,
  GhosttyConfigError,
  includes,
  isGhosttyKey,
  parseGhostty,
  parseGhosttySchema,
  serializeGhostty,
  setList,
  setValue,
  unquote,
  unset,
  valuesByKey,
  type GhosttyConfigView,
  type GhosttyDoc,
  type GhosttyEdit,
  type GhosttyFileId,
  type GhosttyFileView,
  type GhosttySavePreview,
  type GhosttySaveRequest,
  type GhosttySaveResult,
  type GhosttySchema,
  type NameList,
  type SaveResult,
} from '@linux-toolchain/term-config';
import { badRequest, checkFailed, unavailable } from '../errors';
import {
  failureText,
  succeeded,
  type CommandRunner,
} from '../exec/command-runner';
import type { FileSnapshot, FileStore } from '../files/file-store';
import { previewWrite } from '../files/preview';

/** Ghostty's load order: `config.ghostty`, then `config` (later wins). */
export const GHOSTTY_FILES: readonly GhosttyFileId[] = [
  'ghostty',
  'ghostty-legacy',
];

const FILE_NAMES: Record<GhosttyFileId, string> = {
  ghostty: 'config.ghostty',
  'ghostty-legacy': 'config',
};

const MAX_EDITS = 2000;
const MAX_VALUE_LENGTH = 4096;

interface LoadedFile {
  snap: FileSnapshot;
  doc: GhosttyDoc;
}

interface EditPlan {
  files: Map<GhosttyFileId, LoadedFile>;
  changed: GhosttyFileId[];
  warnings: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isValue = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_VALUE_LENGTH;

/** Shape-check a save/preview body. Key names are checked against the schema later. */
export function parseGhosttySaveRequest(body: unknown): GhosttySaveRequest {
  if (!isRecord(body) || !Array.isArray(body['edits'])) {
    throw badRequest('expected { edits, baseMtimes }');
  }
  if (body['edits'].length === 0 || body['edits'].length > MAX_EDITS) {
    throw badRequest(`edits must hold 1-${MAX_EDITS} entries`);
  }
  const edits = body['edits'].map((e): GhosttyEdit => {
    if (!isRecord(e) || typeof e['key'] !== 'string') {
      throw badRequest('every edit needs a key');
    }
    const key = e['key'];
    if (e['op'] === 'set' && isValue(e['value'])) {
      return { op: 'set', key, value: e['value'] };
    }
    if (
      e['op'] === 'setList' &&
      Array.isArray(e['values']) &&
      e['values'].length <= MAX_EDITS &&
      e['values'].every(isValue)
    ) {
      return { op: 'setList', key, values: e['values'] };
    }
    if (e['op'] === 'unset') return { op: 'unset', key };
    throw badRequest(`invalid edit for ${JSON.stringify(key)}`);
  });
  const rawMtimes = body['baseMtimes'] ?? {};
  if (!isRecord(rawMtimes)) throw badRequest('baseMtimes must be an object');
  const baseMtimes: GhosttySaveRequest['baseMtimes'] = {};
  for (const [id, value] of Object.entries(rawMtimes)) {
    if (!GHOSTTY_FILES.includes(id as GhosttyFileId)) {
      throw badRequest(`unknown Ghostty file ${JSON.stringify(id)}`);
    }
    if (
      value !== null &&
      (typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw badRequest(`baseMtimes.${id} must be a number or null`);
    }
    baseMtimes[id as GhosttyFileId] = value;
  }
  return { edits, baseMtimes };
}

/** Names from `+list-themes --plain` (`Name (resources)`). */
export function parseThemeList(text: string): string[] {
  const names = text
    .split('\n')
    .map((l) => l.replace(/\s+\([^()]*\)\s*$/, '').trim())
    .filter((l) => l !== '');
  return [...new Set(names)];
}

/** Font families from `+list-fonts` (families flush left, faces indented). */
export function parseFontList(text: string): string[] {
  const names = text
    .split('\n')
    .filter((l) => l.trim() !== '' && !/^\s/.test(l))
    .map((l) => l.trim());
  return [...new Set(names)];
}

const normalize = (v: string) => unquote(v.trim()).trim().toLowerCase();

/**
 * Ghostty config files and the `ghostty` CLI. Edit rule: a key is edited in
 * the file that already sets it; when both files set it, in the file that
 * wins (`config`, loaded last) with a notice; new keys go to `config` when it
 * exists, else `config.ghostty`. Writes go through FileStore, which runs
 * `ghostty +validate-config` on the candidate.
 */
export class GhosttyService {
  private versionPromise: Promise<string | null> | null = null;
  private readonly schemaCache = new Map<string, Promise<GhosttySchema>>();

  constructor(
    private readonly runner: CommandRunner,
    private readonly files: FileStore,
  ) {}

  /** Ghostty version, or null when `ghostty` is not installed. */
  version(): Promise<string | null> {
    this.versionPromise ??= this.runner
      .run(['ghostty', '--version'], { timeoutMs: 15_000 })
      .then((r) => {
        if (!succeeded(r)) return null;
        const m =
          /version:\s*(\S+)/.exec(r.stdout) ?? /Ghostty\s+(\S+)/.exec(r.stdout);
        return m?.[1] ?? 'unknown';
      });
    return this.versionPromise;
  }

  private async requireGhostty(): Promise<string> {
    const version = await this.version();
    if (version === null) throw unavailable('Ghostty is not installed');
    return version;
  }

  private async cli(args: string[]): Promise<string> {
    const argv = ['ghostty', ...args];
    const r = await this.runner.run(argv, { timeoutMs: 30_000 });
    if (r.notFound) throw unavailable('Ghostty is not installed');
    if (!succeeded(r)) throw new Error(failureText(argv, r));
    return r.stdout;
  }

  /** `+show-config --default --docs`, parsed once per Ghostty version. */
  async schema(): Promise<GhosttySchema> {
    const version = await this.requireGhostty();
    let cached = this.schemaCache.get(version);
    if (!cached) {
      cached = this.cli(['+show-config', '--default', '--docs'])
        .then((text) => parseGhosttySchema(text, version))
        .catch((error: unknown) => {
          this.schemaCache.delete(version);
          throw error;
        });
      this.schemaCache.set(version, cached);
    }
    return cached;
  }

  async themes(): Promise<NameList> {
    await this.requireGhostty();
    return {
      names: parseThemeList(await this.cli(['+list-themes', '--plain'])),
    };
  }

  async fonts(): Promise<NameList> {
    await this.requireGhostty();
    return { names: parseFontList(await this.cli(['+list-fonts'])) };
  }

  /** `+show-config` (the effective configuration), key to values. */
  async effective(): Promise<Record<string, string[]>> {
    await this.requireGhostty();
    return valuesByKey(parseGhostty(await this.cli(['+show-config'])));
  }

  private async load(): Promise<Map<GhosttyFileId, LoadedFile>> {
    const out = new Map<GhosttyFileId, LoadedFile>();
    for (const id of GHOSTTY_FILES) {
      const snap = await this.files.read(id);
      out.set(id, { snap, doc: parseGhostty(snap.content) });
    }
    return out;
  }

  private view(id: GhosttyFileId, f: LoadedFile): GhosttyFileView {
    const lines: GhosttyFileView['entries'] = [];
    f.doc.lines.forEach((l, i) => {
      if (l.kind === 'entry')
        lines.push({ key: l.key, value: l.value, line: i + 1 });
    });
    return {
      id,
      path: f.snap.path,
      exists: f.snap.exists,
      mtimeMs: f.snap.mtimeMs,
      entries: lines,
      includes: includes(f.doc),
    };
  }

  private async repeatable(): Promise<(key: string) => boolean> {
    if ((await this.version()) === null) return () => false;
    const schema = await this.schema();
    const set = new Set(
      schema.keys.filter((k) => k.repeatable).map((k) => k.key),
    );
    return (key) => set.has(key);
  }

  async config(): Promise<GhosttyConfigView> {
    const files = await this.load();
    const isRepeatable = await this.repeatable();
    const installed = (await this.version()) !== null;
    return {
      files: GHOSTTY_FILES.map((id) =>
        this.view(id, files.get(id) as LoadedFile),
      ),
      effective: installed ? await this.effective() : {},
      conflicts: findConflicts(
        GHOSTTY_FILES.map((id) => ({
          id,
          doc: (files.get(id) as LoadedFile).doc,
        })),
        isRepeatable,
      ),
    };
  }

  private async plan(req: GhosttySaveRequest): Promise<EditPlan> {
    const schema = (await this.version()) === null ? null : await this.schema();
    for (const edit of req.edits) {
      const ok = schema
        ? isGhosttyKey(edit.key, schema)
        : GHOSTTY_KEY_RE.test(edit.key);
      if (!ok || edit.key === 'config-file') {
        throw badRequest(
          `unknown or read-only Ghostty key ${JSON.stringify(edit.key)}`,
        );
      }
    }
    const files = await this.load();
    const doc = (id: GhosttyFileId) => (files.get(id) as LoadedFile).doc;
    const setters = (key: string) =>
      GHOSTTY_FILES.filter((id) => entries(doc(id)).some((e) => e.key === key));
    const fallback: GhosttyFileId = (files.get('ghostty-legacy') as LoadedFile)
      .snap.exists
      ? 'ghostty-legacy'
      : 'ghostty';
    const warnings: string[] = [];
    try {
      for (const edit of req.edits) {
        const ids = setters(edit.key);
        if (edit.op === 'unset') {
          for (const id of ids) unset(doc(id), edit.key);
          continue;
        }
        const target = ids.length > 0 ? ids[ids.length - 1] : fallback;
        if (edit.op === 'set') {
          if (ids.length > 1) {
            warnings.push(
              `${edit.key} is set in both ${FILE_NAMES.ghostty} and ${FILE_NAMES['ghostty-legacy']}; editing ${FILE_NAMES[target]}, which Ghostty loads last`,
            );
          }
          setValue(doc(target), edit.key, edit.value);
        } else {
          setList(doc(target), edit.key, edit.values);
          const others = ids.filter((id) => id !== target);
          for (const id of others) unset(doc(id), edit.key);
          if (others.length > 0) {
            warnings.push(
              `${edit.key} lines from ${others.map((id) => FILE_NAMES[id]).join(', ')} were moved to ${FILE_NAMES[target]}`,
            );
          }
        }
      }
    } catch (error) {
      if (error instanceof GhosttyConfigError) throw badRequest(error.message);
      throw error;
    }
    const changed = GHOSTTY_FILES.filter((id) => doc(id).dirty);
    return { files, changed, warnings };
  }

  async preview(req: GhosttySaveRequest): Promise<GhosttySavePreview> {
    const plan = await this.plan(req);
    const previews = [];
    for (const id of plan.changed) {
      const f = plan.files.get(id) as LoadedFile;
      previews.push(
        await previewWrite(this.files, id, serializeGhostty(f.doc), f.snap),
      );
    }
    return { previews, warnings: plan.warnings };
  }

  async save(req: GhosttySaveRequest): Promise<GhosttySaveResult> {
    const plan = await this.plan(req);
    for (const id of plan.changed) {
      if (req.baseMtimes[id] === undefined) {
        throw badRequest(
          `baseMtimes.${id} is required to save ${FILE_NAMES[id]}`,
        );
      }
    }
    const candidates = plan.changed.map((id) => ({
      id,
      content: serializeGhostty((plan.files.get(id) as LoadedFile).doc),
    }));
    // Check every file before writing any, so a save never stops half-way
    // on a validation error.
    for (const { id, content } of candidates) {
      const check = await this.files.check(id, content);
      if (!check.ok) {
        throw checkFailed(
          `ghostty +validate-config failed for ${FILE_NAMES[id]}`,
          check.output,
        );
      }
    }
    const results: SaveResult[] = [];
    for (const { id, content } of candidates) {
      results.push(
        await this.files.write(id, content, {
          baseMtimeMs: req.baseMtimes[id] ?? null,
        }),
      );
    }
    const warnings = [...plan.warnings];
    if (results.length > 0 && (await this.version()) !== null) {
      warnings.push(...(await this.overrideWarnings(req.edits)));
    }
    return { results, warnings };
  }

  /** Edited keys whose effective value still differs (an include or the other file wins). */
  private async overrideWarnings(edits: GhosttyEdit[]): Promise<string[]> {
    const effective = await this.effective();
    const schema = await this.schema();
    const out: string[] = [];
    for (const edit of edits) {
      const eff = (effective[edit.key] ?? []).map(normalize);
      const def = schema.keys.find((k) => k.key === edit.key);
      if (edit.op === 'set') {
        const want = normalize(edit.value);
        const shownAsDefault =
          eff.length === 0 && def && normalize(def.default) === want;
        if (eff.length === 0 ? !shownAsDefault : eff[eff.length - 1] !== want) {
          out.push(
            `${edit.key} = ${edit.value} was saved, but Ghostty's effective value is ${eff.length ? effective[edit.key].join(', ') : 'unset'}; an include or the other file may override it`,
          );
        }
      } else if (
        edit.op === 'setList' &&
        !edit.values.some((v) => normalize(v) === 'clear')
      ) {
        const missing = edit.values.filter((v) => !eff.includes(normalize(v)));
        if (missing.length > 0) {
          out.push(
            `${edit.key}: ${missing.length} saved value(s) are not in Ghostty's effective config`,
          );
        }
      }
    }
    return out;
  }
}
