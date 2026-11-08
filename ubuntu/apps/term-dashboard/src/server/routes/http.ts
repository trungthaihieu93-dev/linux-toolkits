import type { Context } from 'hono';
import {
  isBackupTimestamp,
  isFileId,
  isShellName,
  isTerminalKind,
  type FileId,
  type ShellName,
  type TerminalKind,
} from '@linux-toolchain/term-config';
import { badRequest } from '../../errors';

/** The JSON body as `unknown`; 400 when it is not JSON. */
export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw badRequest('expected a JSON body');
  }
}

/** The JSON body as an object; 400 otherwise. */
export async function objectBody(c: Context): Promise<Record<string, unknown>> {
  const body = await jsonBody(c);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw badRequest('expected a JSON object');
  }
  return body as Record<string, unknown>;
}

/** Optional JSON object body: an empty body is `{}`. */
export async function optionalObjectBody(
  c: Context,
): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest('expected a JSON body');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw badRequest('expected a JSON object');
  }
  return body as Record<string, unknown>;
}

export function mtimeField(
  body: Record<string, unknown>,
  field = 'baseMtimeMs',
): number | null {
  const value = body[field];
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    return value;
  throw badRequest(`${field} must be a number or null`);
}

export function stringField(
  body: Record<string, unknown>,
  field: string,
  max: number,
): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length > max) {
    throw badRequest(`${field} must be a string of at most ${max} characters`);
  }
  return value;
}

export function kindParam(c: Context): TerminalKind {
  const kind = c.req.param('kind');
  if (!isTerminalKind(kind)) throw badRequest('unknown terminal');
  return kind;
}

export function shellParam(c: Context): ShellName {
  const shell = c.req.param('shell');
  if (!isShellName(shell)) throw badRequest('unknown shell');
  return shell;
}

export function fileIdOf(value: unknown): FileId {
  if (!isFileId(value)) throw badRequest('unknown file id');
  return value;
}

export function tsParam(c: Context): string {
  const ts = c.req.param('ts');
  if (!isBackupTimestamp(ts)) throw badRequest('invalid backup timestamp');
  return ts;
}
