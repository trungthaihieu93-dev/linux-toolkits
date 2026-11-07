/**
 * Pure rendering of the linux-toolchain catalog (`list --json`) into the docs
 * reference: one Markdown page per toolchain plus the JSON data file read by
 * the reference index. No I/O here; scripts/gen-toolchains.ts does the I/O.
 */

export interface ToolchainChoice {
	value: string;
	label: string;
	hint?: string;
}

export type ToolchainOption =
	| { key: string; kind: 'select'; label: string; default: string; choices: ToolchainChoice[] }
	| {
			key: string;
			kind: 'multi';
			label: string;
			default: string[];
			choices: ToolchainChoice[];
			min?: number;
	  }
	| { key: string; kind: 'confirm'; label: string; default: boolean };

export interface ToolchainEntry {
	id: string;
	label: string;
	description: string;
	requires: string[];
	addonImplies: Record<string, string>;
	options: ToolchainOption[];
}

export interface RenderedFile {
	/** Path relative to the website root, with forward slashes. */
	path: string;
	content: string;
}

/** The catalog JSON does not have the expected shape. */
export class CatalogError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CatalogError';
	}
}

export const PAGES_DIR = 'src/content/docs/ubuntu/toolchains';
export const DATA_FILE = 'src/data/toolchains.json';
export const GENERATED_NOTE =
	'Generated from the linux-toolchain catalog by scripts/gen-toolchains.ts — do not edit.';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const REFERENCE_URL = '/ubuntu/toolchains/';

// ---------------------------------------------------------------------------
// Validation

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(obj: Json, key: string, where: string, optional = false): string | undefined {
	const value = obj[key];
	if (value === undefined && optional) return undefined;
	if (typeof value !== 'string' || (!optional && value.trim() === '')) {
		throw new CatalogError(`${where}.${key}: expected a non-empty string, got ${JSON.stringify(value)}`);
	}
	return value;
}

function reqStr(obj: Json, key: string, where: string): string {
	return str(obj, key, where) as string;
}

function strArray(obj: Json, key: string, where: string): string[] {
	const value = obj[key];
	if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
		throw new CatalogError(`${where}.${key}: expected an array of strings, got ${JSON.stringify(value)}`);
	}
	return value as string[];
}

function parseChoices(obj: Json, where: string): ToolchainChoice[] {
	const raw = obj['choices'];
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new CatalogError(`${where}.choices: expected a non-empty array`);
	}
	return raw.map((c, i) => {
		const at = `${where}.choices[${i}]`;
		if (!isObject(c)) throw new CatalogError(`${at}: expected an object`);
		const hint = str(c, 'hint', at, true);
		return { value: reqStr(c, 'value', at), label: reqStr(c, 'label', at), ...(hint ? { hint } : {}) };
	});
}

function parseOption(raw: unknown, where: string): ToolchainOption {
	if (!isObject(raw)) throw new CatalogError(`${where}: expected an object`);
	const key = reqStr(raw, 'key', where);
	const label = reqStr(raw, 'label', where);
	const kind = raw['kind'];
	if (kind === 'select') {
		const choices = parseChoices(raw, where);
		const def = reqStr(raw, 'default', where);
		if (!choices.some((c) => c.value === def)) {
			throw new CatalogError(`${where}.default: ${JSON.stringify(def)} is not one of the choices`);
		}
		return { key, kind, label, default: def, choices };
	}
	if (kind === 'multi') {
		const choices = parseChoices(raw, where);
		const def = strArray(raw, 'default', where);
		const unknown = def.filter((d) => !choices.some((c) => c.value === d));
		if (unknown.length > 0) {
			throw new CatalogError(`${where}.default: ${JSON.stringify(unknown)} not among the choices`);
		}
		const min = raw['min'];
		if (min !== undefined && (typeof min !== 'number' || !Number.isInteger(min) || min < 0)) {
			throw new CatalogError(`${where}.min: expected a non-negative integer, got ${JSON.stringify(min)}`);
		}
		return { key, kind, label, default: def, choices, ...(min !== undefined ? { min } : {}) };
	}
	if (kind === 'confirm') {
		const def = raw['default'];
		if (typeof def !== 'boolean') {
			throw new CatalogError(`${where}.default: expected a boolean, got ${JSON.stringify(def)}`);
		}
		return { key, kind, label, default: def };
	}
	throw new CatalogError(`${where}.kind: expected select, multi or confirm, got ${JSON.stringify(kind)}`);
}

/**
 * Validate the parsed `list --json` output. Throws CatalogError naming the
 * first offending field, so a catalog change that breaks the docs fails loudly.
 */
export function parseCatalog(raw: unknown): ToolchainEntry[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new CatalogError('catalog: expected a non-empty array of toolchains');
	}
	const entries = raw.map((t, i): ToolchainEntry => {
		const where = `catalog[${i}]`;
		if (!isObject(t)) throw new CatalogError(`${where}: expected an object`);
		const id = reqStr(t, 'id', where);
		if (!ID_RE.test(id) || id === 'index') {
			throw new CatalogError(`${where}.id: ${JSON.stringify(id)} is not a usable page name`);
		}
		const at = `catalog[${i}] (${id})`;
		const implies = t['addonImplies'];
		if (!isObject(implies) || !Object.values(implies).every((v) => typeof v === 'string')) {
			throw new CatalogError(`${at}.addonImplies: expected an object of strings`);
		}
		const options = t['options'];
		if (!Array.isArray(options)) throw new CatalogError(`${at}.options: expected an array`);
		return {
			id,
			label: reqStr(t, 'label', at),
			description: reqStr(t, 'description', at),
			requires: strArray(t, 'requires', at),
			addonImplies: implies as Record<string, string>,
			options: options.map((o, j) => parseOption(o, `${at}.options[${j}]`)),
		};
	});

	const ids = new Set<string>();
	for (const e of entries) {
		if (ids.has(e.id)) throw new CatalogError(`catalog: duplicate id ${JSON.stringify(e.id)}`);
		ids.add(e.id);
	}
	for (const e of entries) {
		for (const target of [...e.requires, ...Object.values(e.addonImplies)]) {
			if (!ids.has(target)) {
				throw new CatalogError(`catalog (${e.id}): references unknown toolchain ${JSON.stringify(target)}`);
			}
		}
	}
	return entries;
}

// ---------------------------------------------------------------------------
// Markdown helpers

/**
 * Escape text for an inline Markdown position (never at the start of a block).
 * `~` matters because GFM treats single tildes as strikethrough (`~/.bashrc`).
 */
export function escapeInline(text: string): string {
	return text.replace(/\r?\n/g, ' ').replace(/[\\`*_[\]<|~&]/g, (c) => `\\${c}`);
}

/**
 * Inline code span that survives backticks. Inside a GFM table cell a `|`
 * would end the cell even in a code span, so `table` escapes it.
 */
export function code(text: string, table = false): string {
	const runs = text.match(/`+/g) ?? [];
	const fence = '`'.repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
	const pad = fence.length > 1 || text.startsWith('`') || text.endsWith('`') ? ' ' : '';
	const body = table ? text.replace(/\|/g, '\\|') : text;
	return `${fence}${pad}${body}${pad}${fence}`;
}

/** Quote a word for a POSIX shell when it contains anything beyond safe characters. */
export function shellArg(word: string): string {
	return /^[A-Za-z0-9@%+=:,./_-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

function yamlString(text: string): string {
	return JSON.stringify(text);
}

function pageUrl(id: string): string {
	return `${REFERENCE_URL}${id}/`;
}

function choiceText(choice: ToolchainChoice, table = false): string {
	const label = choice.label === choice.value ? '' : ` ${escapeInline(choice.label)}`;
	const hint = choice.hint ? ` (${escapeInline(choice.hint)})` : '';
	return `${code(choice.value, table)}${label}${hint}`;
}

function defaultText(option: ToolchainOption): string {
	if (option.kind === 'confirm') return code(String(option.default));
	if (option.kind === 'select') return code(option.default, true);
	return option.default.length > 0 ? code(option.default.join(','), true) : 'none';
}

function kindText(option: ToolchainOption): string {
	if (option.kind === 'select') return 'select (one value)';
	if (option.kind === 'confirm') return 'confirm (yes/no)';
	return option.min ? `multi (comma list, at least ${option.min})` : 'multi (comma list)';
}

function choicesText(option: ToolchainOption): string {
	if (option.kind === 'confirm') return `${code('true')}, ${code('false')}`;
	if (isAddons(option)) return '[see Add-ons](#add-ons)';
	return option.choices.map((c) => choiceText(c, true)).join('<br>');
}

function isAddons(option: ToolchainOption): option is Extract<ToolchainOption, { kind: 'multi' }> {
	return option.kind === 'multi' && option.key === 'addons';
}

/**
 * A `--opt` assignment that differs from the defaults, from the first option
 * that has one; undefined when no option can be changed.
 */
export function exampleOpt(entry: ToolchainEntry): string | undefined {
	for (const option of entry.options) {
		const key = `${entry.id}.${option.key}`;
		if (option.kind === 'confirm') return `${key}=${!option.default}`;
		if (option.kind === 'select') {
			const other = option.choices.find((c) => c.value !== option.default);
			if (other) return `${key}=${other.value}`;
			continue;
		}
		const extra = option.choices.find((c) => !option.default.includes(c.value));
		if (extra) {
			const values = option.choices
				.map((c) => c.value)
				.filter((v) => v === extra.value || option.default.includes(v));
			return `${key}=${values.join(',')}`;
		}
		if (option.default.length > Math.max(option.min ?? 0, 1)) {
			return `${key}=${option.default.slice(0, -1).join(',')}`;
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Rendering

function renderPage(entry: ToolchainEntry, order: number): string {
	const { id } = entry;
	const lines: string[] = [
		'---',
		`# ${GENERATED_NOTE}`,
		`title: ${yamlString(entry.label)}`,
		`description: ${yamlString(`linux-toolchain reference for ${id}: ${entry.description}`)}`,
		'sidebar:',
		`  order: ${order}`,
		'---',
		'',
		`**Installs:** ${escapeInline(entry.description)}. Toolchain id: ${code(id)}.`,
		'',
		'## Install',
		'',
		'Preview the install with the default options. This prints every script it would run and changes nothing:',
		'',
		'```sh title="Terminal"',
		`npx linux-toolchain --only ${shellArg(id)} --defaults --dry-run`,
		'```',
		'',
	];

	const opt = exampleOpt(entry);
	if (opt) {
		lines.push(
			'Set an option with `--opt` instead of its default:',
			'',
			'```sh title="Terminal"',
			`npx linux-toolchain --only ${shellArg(id)} --opt ${shellArg(opt)} --defaults --dry-run`,
			'```',
			'',
		);
	}
	lines.push(
		'Remove `--dry-run` to install for real. Without `--defaults`, the options below are asked interactively. `bunx linux-toolchain` takes the same arguments.',
		'',
		'## Options',
		'',
	);

	if (entry.options.length === 0) {
		lines.push('This toolchain has no options.', '');
	} else {
		lines.push(
			`Set with ${code(`--opt ${id}.<key>=<value>`)}. Multi options take a comma list (an empty value means none); yes/no options take ${code('true')} or ${code('false')}.`,
			'',
			'| Option | Kind | Choices | Default |',
			'| --- | --- | --- | --- |',
		);
		for (const option of entry.options) {
			const name = `${code(`${id}.${option.key}`, true)}<br>${escapeInline(option.label)}`;
			lines.push(`| ${name} | ${kindText(option)} | ${choicesText(option)} | ${defaultText(option)} |`);
		}
		lines.push('');
	}

	lines.push('## Add-ons', '');
	const addons = entry.options.find(isAddons);
	if (!addons) {
		lines.push('This toolchain has no add-ons.', '');
	} else {
		lines.push(
			`Chosen in the add-ons step or with ${code(`--opt ${id}.addons=...`)}. Recommended add-ons are pre-checked and installed with \`--defaults\`. A failed add-on is reported as a warning; the toolchain itself still succeeds.`,
			'',
		);
		for (const choice of addons.choices) {
			const notes: string[] = [];
			if (addons.default.includes(choice.value)) notes.push('**Default.**');
			const target = entry.addonImplies[choice.value];
			if (target) notes.push(`Also selects the [${code(target)}](${pageUrl(target)}) toolchain.`);
			lines.push(`- ${[choiceText(choice), ...notes].join(' ')}`);
		}
		lines.push('');
	}

	const implied = Object.entries(entry.addonImplies);
	if (entry.requires.length > 0 || implied.length > 0) {
		lines.push('## Dependencies', '');
		for (const req of entry.requires) {
			lines.push(
				`- Requires [${code(req)}](${pageUrl(req)}): selecting ${code(id)} also selects ${code(req)} unless it is already installed.`,
			);
		}
		for (const [addon, target] of implied) {
			lines.push(
				`- The add-on ${code(addon)} selects the [${code(target)}](${pageUrl(target)}) toolchain, which is then asked about too. ${code(`--opt ${target}.<key>=<value>`)} may target it.`,
			);
		}
		lines.push('');
	}

	lines.push(
		'---',
		'',
		`Back to the [toolchain reference](${REFERENCE_URL}). Run \`npx linux-toolchain list\` to print the catalog of the version you have.`,
		'',
	);
	return lines.join('\n');
}

/** Render the reference: one page per toolchain (catalog order) and the data file. */
export function renderToolchains(entries: readonly ToolchainEntry[]): RenderedFile[] {
	const pages = entries.map((entry, index) => ({
		path: `${PAGES_DIR}/${entry.id}.md`,
		content: renderPage(entry, index),
	}));
	const data = {
		path: DATA_FILE,
		content: `${JSON.stringify({ _comment: GENERATED_NOTE, toolchains: entries }, null, '\t')}\n`,
	};
	return [...pages, data];
}
