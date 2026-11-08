/**
 * `gsettings list-recursively [SCHEMA[:PATH]]` output: one `schema key value`
 * line per key, where value is GVariant text.
 */

/** Schema id to (key to GVariant text), in output order. */
export type GSettingsListing = Record<string, Record<string, string>>;

export class GSettingsListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GSettingsListError';
  }
}

const LINE = /^([A-Za-z0-9_.-]+) ([A-Za-z0-9_-]+) (.+)$/;

export function parseGSettingsList(text: string): GSettingsListing {
  const out: GSettingsListing = {};
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    const m = LINE.exec(line);
    if (!m) {
      throw new GSettingsListError(
        `line ${i + 1}: expected "schema key value", got ${JSON.stringify(line)}`,
      );
    }
    (out[m[1]] ??= {})[m[2]] = m[3];
  });
  return out;
}

/** Inverse of `parseGSettingsList` (newline-terminated). */
export function formatGSettingsList(listing: GSettingsListing): string {
  const lines: string[] = [];
  for (const [schema, keys] of Object.entries(listing)) {
    for (const [key, value] of Object.entries(keys)) {
      lines.push(`${schema} ${key} ${value}`);
    }
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}
