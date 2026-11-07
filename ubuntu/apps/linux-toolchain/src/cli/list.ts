import chalk from 'chalk';
import type { Option, Toolchain } from '@linux-toolchain/toolchains';

/** JSON shape of one `list --json` entry. */
export interface ToolchainListing {
  id: string;
  label: string;
  description: string;
  requires: string[];
  addonImplies: Record<string, string>;
  options: Option[];
}

export function listJson(catalog: readonly Toolchain[]): string {
  const entries: ToolchainListing[] = catalog.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    requires: t.requires ?? [],
    addonImplies: t.addonImplies ?? {},
    options: t.options,
  }));
  return `${JSON.stringify(entries, null, 2)}\n`;
}

function describeOption(option: Option): string {
  if (option.kind === 'confirm')
    return `true|false (default ${option.default})`;
  const values = option.choices.map((c) => c.value).join('|');
  const def =
    option.kind === 'multi'
      ? option.default.join(',') || 'none'
      : option.default;
  return option.kind === 'multi'
    ? `list of ${values} (default ${def})`
    : `${values} (default ${def})`;
}

/** Human-readable catalog: id, label, description, then `--opt` keys. */
export function listText(catalog: readonly Toolchain[]): string {
  const width = Math.max(...catalog.map((t) => t.id.length));
  const lines: string[] = [];
  for (const t of catalog) {
    lines.push(
      `  ${chalk.cyan(t.id.padEnd(width))}  ${chalk.bold(t.label)}: ${t.description}`,
    );
    for (const o of t.options) {
      lines.push(
        `  ${' '.repeat(width)}    ${chalk.dim(`${t.id}.${o.key}`)} ${describeOption(o)}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
