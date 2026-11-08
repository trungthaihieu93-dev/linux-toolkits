/**
 * Validators for identifiers that clients send in paths and bodies. The
 * server checks every one before using it; nothing client-supplied becomes
 * a path or argv element without passing here first.
 */
import {
  FILE_IDS,
  SHELL_NAMES,
  TERMINAL_KINDS,
  type FileId,
  type GhosttySchema,
  type ShellName,
  type TerminalKind,
} from './api';
import type { GSchema } from './gschema';

const BACKUP_TS = /^\d{8}T\d{6}Z(-\d+)?$/;
const PTYXIS_UUID = /^[0-9a-f]{32}$/;
const RFC4122_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCHEMA_ID = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/;
const GSETTINGS_KEY = /^[a-z][a-z0-9-]*$/;

const isString = (value: unknown): value is string => typeof value === 'string';

export function isFileId(value: unknown): value is FileId {
  return isString(value) && (FILE_IDS as readonly string[]).includes(value);
}

export function isShellName(value: unknown): value is ShellName {
  return isString(value) && (SHELL_NAMES as readonly string[]).includes(value);
}

export function isTerminalKind(value: unknown): value is TerminalKind {
  return (
    isString(value) && (TERMINAL_KINDS as readonly string[]).includes(value)
  );
}

/** `YYYYMMDDTHHMMSSZ`, optionally `-N`; also a real calendar time. */
export function isBackupTimestamp(value: unknown): value is string {
  if (!isString(value) || !BACKUP_TS.test(value)) return false;
  const [y, mo, d, h, mi, s] = [
    value.slice(0, 4),
    value.slice(4, 6),
    value.slice(6, 8),
    value.slice(9, 11),
    value.slice(11, 13),
    value.slice(13, 15),
  ].map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

/** Backup timestamp for `date` (UTC, second precision). */
export function formatBackupTimestamp(date: Date, suffix?: number): string {
  const ts = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return suffix ? `${ts}-${suffix}` : ts;
}

/** Profile uuid in the form the terminal uses (32 hex for Ptyxis, RFC 4122 for GNOME Terminal). */
export function isProfileUuid(
  kind: TerminalKind,
  value: unknown,
): value is string {
  if (!isString(value)) return false;
  return kind === 'ptyxis' ? PTYXIS_UUID.test(value) : RFC4122_UUID.test(value);
}

/** A schema id that is syntactically valid and present in `known` (the inventory). */
export function isSchemaId(
  value: unknown,
  known: Iterable<string>,
): value is string {
  if (!isString(value) || !SCHEMA_ID.test(value)) return false;
  for (const id of known) if (id === value) return true;
  return false;
}

/** A key name defined by the parsed `schema`. */
export function isSchemaKey(value: unknown, schema: GSchema): value is string {
  return (
    isString(value) &&
    GSETTINGS_KEY.test(value) &&
    schema.keys.some((k) => k.name === value)
  );
}

/** A Ghostty key defined by the parsed docs schema. */
export function isGhosttyKey(
  value: unknown,
  schema: GhosttySchema,
): value is string {
  return (
    isString(value) &&
    GSETTINGS_KEY.test(value) &&
    schema.keys.some((k) => k.key === value)
  );
}
