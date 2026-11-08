/**
 * HTTP, SSE and WebSocket contract between the `td` server
 * (apps/term-dashboard) and its web UI (apps/term-dashboard-web).
 *
 * Conventions:
 * - Every body is JSON; errors are `ApiError` with a 4xx/5xx status
 *   (400 invalid input, 401 no session, 404 unknown id, 409 file changed on
 *   disk since `baseMtimeMs`, 413 body too large, 422 the syntax check of a
 *   save failed (`detail` holds its output), 503 the program or schema the
 *   route needs is not installed).
 * - Every `/api/*` call except `GET /api/health` and `POST /api/session`
 *   carries `Authorization: Bearer <SessionResponse.token>`.
 * - GVariant values travel as GVariant text (`'block'`, `uint32 80`,
 *   `['a', 'b']`), exactly as `gsettings get` prints and `gsettings set`
 *   accepts them.
 * - Timestamps are epoch milliseconds unless the field says otherwise.
 *
 * Exported names here are a stable contract: add fields compatibly, never
 * rename or remove them.
 */

// ---------------------------------------------------------------------------
// Shared identifiers

export type ShellName = 'bash' | 'zsh';
export const SHELL_NAMES: readonly ShellName[] = ['bash', 'zsh'];

/** Terminals configured through gsettings. */
export type TerminalKind = 'ptyxis' | 'gnome-terminal';
export const TERMINAL_KINDS: readonly TerminalKind[] = [
  'ptyxis',
  'gnome-terminal',
];

/**
 * Files td may read or write. Clients name files by id, never by path; the
 * server resolves ids against the target `HOME`/`XDG_CONFIG_HOME`.
 */
export type FileId =
  | 'bashrc'
  | 'bash_profile'
  | 'bash_aliases'
  | 'profile'
  | 'zshrc'
  | 'zshenv'
  | 'zprofile'
  | 'ghostty'
  | 'ghostty-legacy';
export const FILE_IDS: readonly FileId[] = [
  'bashrc',
  'bash_profile',
  'bash_aliases',
  'profile',
  'zshrc',
  'zshenv',
  'zprofile',
  'ghostty',
  'ghostty-legacy',
];

/** `ghostty` = `$XDG_CONFIG_HOME/ghostty/config.ghostty`, `ghostty-legacy` = `.../config`. */
export type GhosttyFileId = Extract<FileId, 'ghostty' | 'ghostty-legacy'>;

/** Shell files per shell; the first entry is the one Config mode edits. */
export const SHELL_FILE_IDS: Readonly<Record<ShellName, readonly FileId[]>> = {
  bash: ['bashrc', 'bash_profile', 'bash_aliases', 'profile'],
  zsh: ['zshrc', 'zshenv', 'zprofile'],
};

/** Files whose managed block Config mode can edit. */
export const CONFIG_MODE_FILE_IDS: readonly FileId[] = ['bashrc', 'zshrc'];

export type ThemeMode = 'dark' | 'light';

export interface ApiError {
  error: string;
  /** Extra human-readable detail (for example the failing check output). */
  detail?: string;
}

/** Reason a feature is unavailable on this machine, shown as-is in the UI. */
export interface Availability {
  available: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Health and session (launch code exchange)

/** `GET /api/health` (public). */
export interface Health {
  app: 'term-dashboard';
  version: string;
  pid: number;
}

/** `POST /api/session` (public): redeem the single-use `#c=` launch code. */
export interface SessionRequest {
  code: string;
}
export interface SessionResponse {
  token: string;
}

/** `POST /api/launch-code` (instance secret only; used by a second `td`). */
export interface LaunchCodeResponse {
  code: string;
}

// ---------------------------------------------------------------------------
// Settings (`~/.config/term-dashboard/settings.json`)

export interface Settings {
  theme: ThemeMode;
  /** Preferred port; 0 lets the OS choose. */
  port: number;
  /** Absolute path of the shell for the Terminal page; login shell when unset. */
  terminalShell?: string;
}

/** `GET /api/settings` → `Settings`; `PUT /api/settings` body → `Settings`. */
export type SettingsUpdate = Partial<Settings>;

// ---------------------------------------------------------------------------
// Inventory (`GET /api/inventory`)

export interface ConfigFileRef {
  id: FileId;
  path: string;
  exists: boolean;
}

export interface GhosttyInfo {
  installed: boolean;
  version: string | null;
  /** In Ghostty's load order: `config.ghostty`, then `config` (later wins). */
  files: ConfigFileRef[];
}

/** A gsettings schema id, plus its path when the schema is relocatable. */
export interface SchemaRef {
  schema: string;
  path: string | null;
}

export interface GSettingsTerminalSchemas {
  global: SchemaRef;
  shortcuts: SchemaRef | null;
  /** Where the profile uuid list lives (`profile-uuids` / `list`). */
  profileList: SchemaRef & { key: string };
  /** Where the default profile uuid lives. */
  defaultProfile: SchemaRef & { key: string };
  /** Relocatable profile schema id. */
  profile: string;
  /** Profile path = `profilePathPrefix + uuid + '/'`. */
  profilePathPrefix: string;
  /** Profile key that holds its display name. */
  labelKey: string;
}

export interface GSettingsTerminalInfo {
  kind: TerminalKind;
  label: string;
  installed: boolean;
  version: string | null;
  /** Null when the schemas are not installed. */
  schemas: GSettingsTerminalSchemas | null;
}

export interface ShellInfo {
  shell: ShellName;
  installed: boolean;
  binary: string | null;
  isLoginShell: boolean;
  files: ConfigFileRef[];
  /** The Config-mode file holds a `# >>> term-dashboard >>>` block. */
  managedBlock: boolean;
  ohMyZsh: boolean;
  /** Backup timestamp (`BackupTimestamp`) of the newest backup of any file. */
  lastBackup: string | null;
}

export interface TerminalInventory {
  home: string;
  loginShell: string | null;
  ghostty: GhosttyInfo;
  terminals: GSettingsTerminalInfo[];
  shells: ShellInfo[];
  /** Terminal page (needs util-linux `script`). */
  pty: Availability;
}

// ---------------------------------------------------------------------------
// gsettings schema views (`/api/terminals/:kind/...`)

export interface GSettingsRange {
  min: number;
  max: number;
}

export interface GSettingsKeyView {
  name: string;
  /** GVariant type string (`b`, `s`, `as`, `a(ss)`, `(uu)`, `ms`, ...). */
  type: string;
  /** Allowed nicks when the key is an enum (type is then `s`). */
  enum?: string[];
  /** Allowed nicks when the key is a flags key (type is then `as`). */
  flags?: string[];
  range?: GSettingsRange;
  /** `<choices>` of a string key. */
  choices?: string[];
  summary: string;
  description: string;
  /** Current value, GVariant text. */
  value: string;
  /** Effective default (vendor overrides applied), GVariant text. */
  default: string;
  isDefault: boolean;
}

/** `GET /api/terminals/:kind/global`, `.../shortcuts`, `.../profiles/:uuid`. */
export interface GSettingsSchemaView {
  schema: string;
  path: string | null;
  keys: GSettingsKeyView[];
}

/** `PUT /api/terminals/:kind/{global|shortcuts|profiles/:uuid}`. */
export interface GSettingsSetRequest {
  key: string;
  /** GVariant text of the new value. */
  value: string;
}

/** `POST /api/terminals/:kind/{...}/reset`. */
export interface GSettingsResetRequest {
  key: string;
}

export interface TerminalProfileSummary {
  uuid: string;
  label: string;
  isDefault: boolean;
}

/** `GET /api/terminals/:kind/profiles`. */
export interface TerminalProfilesView {
  kind: TerminalKind;
  defaultUuid: string | null;
  profiles: TerminalProfileSummary[];
}

/** `POST /api/terminals/:kind/profiles`. */
export interface CreateProfileRequest {
  label: string;
}
/** `POST /api/terminals/:kind/profiles/:uuid/duplicate`. */
export interface DuplicateProfileRequest {
  label?: string;
}
/** `PUT /api/terminals/:kind/profiles/:uuid/default` has no body. */
export interface ProfileCreated {
  uuid: string;
}

// ---------------------------------------------------------------------------
// Save flow shared by file writes

export interface CheckResult {
  ok: boolean;
  /** argv of the check, e.g. `['bash', '-n', '<tmp>']`; empty when skipped. */
  argv: string[];
  output: string;
  /** Why the check did not run (binary missing); `ok` is then true. */
  skipped?: string;
}

/** Returned by every `.../preview` route before anything is written. */
export interface SavePreview {
  fileId: FileId;
  path: string;
  /** Unified diff from current to candidate content; '' when unchanged. */
  diff: string;
  changed: boolean;
  check: CheckResult;
  /** mtime of the file the preview was computed from (null: no file yet). */
  baseMtimeMs: number | null;
  /** The candidate content that a save with the same request writes. */
  candidate: string;
}

export interface SaveResult {
  fileId: FileId;
  path: string;
  mtimeMs: number;
  /** Backup of the previous content; null when the file did not exist. */
  backup: BackupRef | null;
  check: CheckResult;
}

// ---------------------------------------------------------------------------
// Ghostty (`/api/ghostty/...`)

export type GhosttyControl =
  | 'bool'
  | 'number'
  | 'color'
  | 'enum'
  | 'theme'
  | 'font'
  | 'text';

export interface GhosttySchemaKey {
  key: string;
  /** Doc comment text without the `# ` prefixes. */
  doc: string;
  /** First default value ('' when the default is empty). */
  default: string;
  /** Every default line in order (several for `keybind`, `palette`, ...). */
  defaults: string[];
  repeatable: boolean;
  control: GhosttyControl;
  /** Allowed values when `control` is `enum`. */
  values?: string[];
}

/** `GET /api/ghostty/schema`. */
export interface GhosttySchema {
  version: string | null;
  keys: GhosttySchemaKey[];
}

export interface GhosttyEntryView {
  key: string;
  value: string;
  /** 1-based line number in the file. */
  line: number;
}

export interface GhosttyIncludeView {
  /** As written (a leading `?` is removed and reported as `optional`). */
  path: string;
  optional: boolean;
  line: number;
}

export interface GhosttyFileView {
  id: GhosttyFileId;
  path: string;
  exists: boolean;
  mtimeMs: number | null;
  entries: GhosttyEntryView[];
  includes: GhosttyIncludeView[];
}

export interface GhosttyConflict {
  key: string;
  files: GhosttyFileId[];
  /** File whose value Ghostty uses (loaded last). */
  winner: GhosttyFileId;
}

/** `GET /api/ghostty/config`. */
export interface GhosttyConfigView {
  /** In load order. */
  files: GhosttyFileView[];
  /** `ghostty +show-config` output, key to values. */
  effective: Record<string, string[]>;
  conflicts: GhosttyConflict[];
}

export type GhosttyEdit =
  | { op: 'set'; key: string; value: string }
  | { op: 'setList'; key: string; values: string[] }
  | { op: 'unset'; key: string };

/** `POST /api/ghostty/preview` → `GhosttySavePreview`; `POST /api/ghostty/save` → `GhosttySaveResult`. */
export interface GhosttySaveRequest {
  edits: GhosttyEdit[];
  /** mtimes the client last read; a mismatch returns 409. */
  baseMtimes: Partial<Record<GhosttyFileId, number | null>>;
}

export interface GhosttySavePreview {
  previews: SavePreview[];
  warnings: string[];
}

export interface GhosttySaveResult {
  results: SaveResult[];
  /** E.g. an include or the other file still overrides an edited key. */
  warnings: string[];
}

/** `GET /api/ghostty/themes`, `GET /api/ghostty/fonts`. */
export interface NameList {
  names: string[];
}

// ---------------------------------------------------------------------------
// Shells (`/api/shells/:shell/...`)

export interface ShellAlias {
  name: string;
  command: string;
}

export interface ShellExport {
  name: string;
  value: string;
}

export interface ShellHistory {
  size?: number;
  fileSize?: number;
  ignoreDups?: boolean;
  share?: boolean;
}

export interface OhMyZshModel {
  theme?: string;
  plugins?: string[];
  /** Unknown lines inside the omz block, preserved verbatim. */
  extra?: string[];
}

/**
 * What Config mode edits. Everything except `ohMyZsh` renders into the main
 * `# >>> term-dashboard >>>` block; `ohMyZsh` renders into the
 * `# >>> term-dashboard-omz >>>` block right above `source $ZSH/oh-my-zsh.sh`.
 */
export interface ShellBlockModel {
  aliases: ShellAlias[];
  exports: ShellExport[];
  /** Entries starting with `~/` expand to `$HOME/...` at runtime. */
  path: { prepend: string[]; append: string[] };
  history: ShellHistory;
  ohMyZsh?: OhMyZshModel;
  /** Unknown lines inside the main block, preserved verbatim. */
  extra?: string[];
}

export type ManagedBlockName = 'term-dashboard' | 'term-dashboard-omz';

export interface ManagedBlockState {
  name: ManagedBlockName;
  present: boolean;
  /** 1-based line numbers of the start and end markers. */
  startLine: number | null;
  endLine: number | null;
}

export interface OhMyZshState {
  /** The file sources oh-my-zsh at least once. */
  detected: boolean;
  /** 1-based line of the single `source $ZSH/oh-my-zsh.sh`; null if 0 or >1. */
  sourceLine: number | null;
  /** Theme/plugins can be edited (exactly one source line). */
  editable: boolean;
  disabledReason?: string;
}

export type OutsideLineKind =
  | 'alias'
  | 'export'
  | 'path'
  | 'zsh-theme'
  | 'plugins'
  | 'source';

/** A line outside the managed blocks that may interact with them. */
export interface OutsideLine {
  /** 1-based. */
  line: number;
  kind: OutsideLineKind;
  /** Alias or variable name, or the sourced path. */
  name: string | null;
  text: string;
}

/** `GET /api/shells/:shell/files/:fileId`. */
export interface ShellFileView {
  shell: ShellName;
  fileId: FileId;
  path: string;
  exists: boolean;
  content: string;
  mtimeMs: number | null;
  /** True for the Config-mode file of the shell (`bashrc`, `zshrc`). */
  configMode: boolean;
  blocks: {
    main: ManagedBlockState;
    /** zsh only. */
    omz: ManagedBlockState | null;
  };
  /** Parsed managed blocks; null when they are malformed (see `modelError`). */
  model: ShellBlockModel | null;
  /** Duplicate or unclosed markers; Config mode is disabled with this text. */
  modelError?: string;
  outside: OutsideLine[];
  /** zsh only. */
  ohMyZsh: OhMyZshState | null;
}

/** `POST /api/shells/:shell/config/{preview|save}`. */
export interface ShellConfigSaveRequest {
  fileId: FileId;
  model: ShellBlockModel;
  baseMtimeMs: number | null;
}

/** `POST /api/shells/:shell/raw/{preview|save}`. */
export interface ShellRawSaveRequest {
  fileId: FileId;
  content: string;
  baseMtimeMs: number | null;
}

/** `GET /api/shells/:shell/oh-my-zsh`. */
export interface OhMyZshCatalog {
  root: string | null;
  themes: string[];
  plugins: string[];
}

// ---------------------------------------------------------------------------
// Backups (`/api/backups/...`)

/** `YYYYMMDDTHHMMSSZ` with an optional `-N` suffix for same-second backups. */
export type BackupTimestamp = string;

export interface BackupRef {
  fileId: FileId;
  ts: BackupTimestamp;
  path: string;
  size: number;
}

export interface GSettingsBackupRef {
  ts: BackupTimestamp;
  path: string;
  kinds: TerminalKind[];
}

/** `GET /api/backups`. */
export interface BackupsView {
  dir: string;
  files: BackupRef[];
  gsettings: GSettingsBackupRef[];
}

/** `GET /api/backups/files/:fileId/:ts`. */
export interface BackupContent {
  ref: BackupRef;
  content: string;
}

/**
 * Optional body of `POST /api/backups/files/:fileId/:ts/restore`. Without
 * `baseMtimeMs` the restore does not check for concurrent changes.
 */
export interface BackupRestoreRequest {
  baseMtimeMs?: number | null;
}

/**
 * `POST /api/backups/files/:fileId/:ts/{preview|restore}` → `SavePreview` / `SaveResult`;
 * `POST /api/backups/gsettings/:ts/restore` → `{ restored: TerminalKind[] }`.
 */
export interface GSettingsRestoreResult {
  restored: TerminalKind[];
}

// ---------------------------------------------------------------------------
// Activity stream (`GET /api/activity`, SSE: `data: <ActivityEvent JSON>`)

export const ACTIVITY_LIMITS = {
  /** Commands kept in history (server and client). */
  maxCommands: 500,
  /** Bytes of event data kept in history (server and client). */
  maxBytes: 2 * 1024 * 1024,
  /** Output bytes per command before the rest is replaced by one marker. */
  maxOutputBytesPerCommand: 64 * 1024,
  heartbeatMs: 15_000,
} as const;

export type ActivityStream = 'stdout' | 'stderr';

interface ActivityEventBase {
  /** Command id, shared by all events of one command. */
  id: string;
  ts: number;
}

export interface ActivityStarted extends ActivityEventBase {
  type: 'started';
  argv: string[];
  cwd?: string;
}

export interface ActivityOutput extends ActivityEventBase {
  type: 'output';
  stream: ActivityStream;
  chunk: string;
  /**
   * Truncation marker: set (and `chunk` is a notice) when output past
   * `maxOutputBytesPerCommand` was dropped; the count of dropped bytes.
   */
  truncatedBytes?: number;
}

export interface ActivityExited extends ActivityEventBase {
  type: 'exited';
  /** Exit code; null when killed by a signal or the spawn failed. */
  code: number | null;
  signal: string | null;
  durationMs: number;
  /** Spawn or timeout error message. */
  error?: string;
}

export type ActivityEvent = ActivityStarted | ActivityOutput | ActivityExited;

// ---------------------------------------------------------------------------
// PTY (`/ws/pty`, subprotocols `['td', <token>]`)
// Terminal data travels as binary frames both ways; control messages are JSON
// text frames.

export const PTY_SUBPROTOCOL = 'td';

export const PTY_LIMITS = {
  /** Larger messages close the socket. */
  maxMessageBytes: 64 * 1024,
  maxSessions: 4,
} as const;

export type PtyClientMessage = { type: 'resize'; cols: number; rows: number };

export type PtyServerMessage =
  | { type: 'ready'; pid: number; shell: string }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Route table, so server and client build the same paths.

const seg = encodeURIComponent;

export const API_PATHS = {
  health: '/api/health',
  session: '/api/session',
  launchCode: '/api/launch-code',
  settings: '/api/settings',
  inventory: '/api/inventory',
  activity: '/api/activity',
  pty: '/ws/pty',
  terminalGlobal: (kind: TerminalKind) => `/api/terminals/${seg(kind)}/global`,
  terminalShortcuts: (kind: TerminalKind) =>
    `/api/terminals/${seg(kind)}/shortcuts`,
  terminalProfiles: (kind: TerminalKind) =>
    `/api/terminals/${seg(kind)}/profiles`,
  terminalProfile: (kind: TerminalKind, uuid: string) =>
    `/api/terminals/${seg(kind)}/profiles/${seg(uuid)}`,
  terminalProfileDuplicate: (kind: TerminalKind, uuid: string) =>
    `/api/terminals/${seg(kind)}/profiles/${seg(uuid)}/duplicate`,
  terminalProfileDefault: (kind: TerminalKind, uuid: string) =>
    `/api/terminals/${seg(kind)}/profiles/${seg(uuid)}/default`,
  /** `POST <global|shortcuts|profile path>/reset`, body `GSettingsResetRequest`. */
  terminalReset: (schemaPath: string) => `${schemaPath}/reset`,
  ghosttySchema: '/api/ghostty/schema',
  ghosttyConfig: '/api/ghostty/config',
  ghosttyThemes: '/api/ghostty/themes',
  ghosttyFonts: '/api/ghostty/fonts',
  ghosttyPreview: '/api/ghostty/preview',
  ghosttySave: '/api/ghostty/save',
  shellFile: (shell: ShellName, fileId: FileId) =>
    `/api/shells/${seg(shell)}/files/${seg(fileId)}`,
  shellConfig: (shell: ShellName, action: 'preview' | 'save') =>
    `/api/shells/${seg(shell)}/config/${action}`,
  shellRaw: (shell: ShellName, action: 'preview' | 'save') =>
    `/api/shells/${seg(shell)}/raw/${action}`,
  ohMyZsh: (shell: ShellName) => `/api/shells/${seg(shell)}/oh-my-zsh`,
  backups: '/api/backups',
  backupFile: (fileId: FileId, ts: BackupTimestamp) =>
    `/api/backups/files/${seg(fileId)}/${seg(ts)}`,
  backupFileAction: (
    fileId: FileId,
    ts: BackupTimestamp,
    action: 'preview' | 'restore',
  ) => `/api/backups/files/${seg(fileId)}/${seg(ts)}/${action}`,
  gsettingsRestore: (ts: BackupTimestamp) =>
    `/api/backups/gsettings/${seg(ts)}/restore`,
} as const;
