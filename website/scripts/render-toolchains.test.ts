import { describe, expect, test } from 'bun:test';
import {
	CatalogError,
	DATA_FILE,
	GENERATED_NOTE,
	code,
	escapeInline,
	exampleOpt,
	parseCatalog,
	renderToolchains,
	type ToolchainEntry,
} from './render-toolchains';

/** Two toolchains covering every option kind, add-on hints, requires and addonImplies. */
const fixture = [
	{
		id: 'alpha',
		label: 'Alpha | SDK',
		description: 'alpha tools -> /opt/alpha, shell init in ~/.bashrc and ~/.zshrc',
		requires: [],
		addonImplies: { beta: 'beta' },
		options: [
			{
				key: 'channel',
				kind: 'select',
				label: 'Channel',
				choices: [
					{ value: 'stable', label: 'stable' },
					{ value: 'edge', label: 'Edge', hint: 'nightly | unsupported' },
				],
				default: 'stable',
			},
			{ key: 'shell', kind: 'confirm', label: 'Add shell init', default: true },
			{
				key: 'addons',
				kind: 'multi',
				label: 'Add-ons',
				choices: [
					{ value: 'lint', label: 'Linter', hint: 'apt' },
					{ value: 'fmt', label: 'fmt' },
					{ value: 'beta', label: 'Beta bridge', hint: 'selects the beta component' },
				],
				default: ['lint'],
			},
		],
	},
	{
		id: 'beta',
		label: 'Beta',
		description: 'beta runtime',
		requires: ['alpha'],
		addonImplies: {},
		options: [
			{
				key: 'versions',
				kind: 'multi',
				label: 'Versions',
				choices: [
					{ value: '1', label: 'One' },
					{ value: '2', label: 'Two' },
				],
				default: ['1', '2'],
				min: 1,
			},
		],
	},
];

function render(raw: unknown = fixture) {
	const files = renderToolchains(parseCatalog(raw));
	const byPath = new Map(files.map((f) => [f.path, f.content]));
	return { files, byPath };
}

function page(id: string, raw: unknown = fixture): string[] {
	const content = render(raw).byPath.get(`src/content/docs/ubuntu/toolchains/${id}.md`);
	if (content === undefined) throw new Error(`no page for ${id}`);
	return content.split('\n');
}

describe('renderToolchains', () => {
	test('writes one page per toolchain in catalog order, then the data file', () => {
		const { files } = render();
		expect(files.map((f) => f.path)).toEqual([
			'src/content/docs/ubuntu/toolchains/alpha.md',
			'src/content/docs/ubuntu/toolchains/beta.md',
			DATA_FILE,
		]);
		const data = JSON.parse(files[2]!.content);
		expect(data._comment).toBe(GENERATED_NOTE);
		expect(data.toolchains.map((t: ToolchainEntry) => t.id)).toEqual(['alpha', 'beta']);
	});

	test('frontmatter carries the generated note, title, description and order', () => {
		const lines = page('beta');
		expect(lines.slice(0, 7)).toEqual([
			'---',
			`# ${GENERATED_NOTE}`,
			'title: "Beta"',
			'description: "linux-toolchain reference for beta: beta runtime"',
			'sidebar:',
			'  order: 1',
			'---',
		]);
		expect(page('alpha')).toContain('title: "Alpha | SDK"');
	});

	test('escapes Markdown in the description (tildes, pipes)', () => {
		expect(page('alpha')).toContain(
			'**Installs:** alpha tools -> /opt/alpha, shell init in \\~/.bashrc and \\~/.zshrc. Toolchain id: `alpha`.',
		);
	});

	test('install examples always include --dry-run', () => {
		const lines = page('alpha');
		expect(lines).toContain('npx linux-toolchain --only alpha --defaults --dry-run');
		expect(lines).toContain('npx linux-toolchain --only alpha --opt alpha.channel=edge --defaults --dry-run');
		const commands = lines.filter((l) => l.startsWith('npx '));
		expect(commands.every((l) => l.endsWith('--dry-run'))).toBe(true);
	});

	test('options table: select with hints and escaped pipes, confirm, multi add-ons', () => {
		const lines = page('alpha');
		expect(lines).toContain('| Option | Kind | Choices | Default |');
		expect(lines).toContain(
			'| `alpha.channel`<br>Channel | select (one value) | `stable`<br>`edge` Edge (nightly \\| unsupported) | `stable` |',
		);
		expect(lines).toContain('| `alpha.shell`<br>Add shell init | confirm (yes/no) | `true`, `false` | `true` |');
		expect(lines).toContain('| `alpha.addons`<br>Add-ons | multi (comma list) | [see Add-ons](#add-ons) | `lint` |');
	});

	test('multi option with a minimum', () => {
		expect(page('beta')).toContain(
			'| `beta.versions`<br>Versions | multi (comma list, at least 1) | `1` One<br>`2` Two | `1,2` |',
		);
	});

	test('add-ons list hints, marks defaults and links implied toolchains', () => {
		const lines = page('alpha');
		expect(lines).toContain('- `lint` Linter (apt) **Default.**');
		expect(lines).toContain('- `fmt`');
		expect(lines).toContain(
			'- `beta` Beta bridge (selects the beta component) Also selects the [`beta`](/ubuntu/toolchains/beta/) toolchain.',
		);
		expect(page('beta')).toContain('This toolchain has no add-ons.');
	});

	test('dependencies section explains requires and addonImplies', () => {
		expect(page('beta')).toContain(
			'- Requires [`alpha`](/ubuntu/toolchains/alpha/): selecting `beta` also selects `alpha` unless it is already installed.',
		);
		expect(page('alpha').some((l) => l.startsWith('- The add-on `beta` selects the [`beta`](/ubuntu/toolchains/beta/) toolchain'))).toBe(true);
	});

	test('links back to the reference index', () => {
		expect(page('beta').some((l) => l.startsWith('Back to the [toolchain reference](/ubuntu/toolchains/).'))).toBe(true);
	});

	test('a toolchain without options says so and has no --opt example', () => {
		const raw = [{ id: 'gamma', label: 'Gamma', description: 'gamma', requires: [], addonImplies: {}, options: [] }];
		const lines = page('gamma', raw);
		expect(lines).toContain('This toolchain has no options.');
		expect(lines.some((l) => l.includes('--opt gamma'))).toBe(false);
	});

	test('output is deterministic and follows the input', () => {
		expect(render().files).toEqual(render().files);
		const changed = structuredClone(fixture);
		changed[1]!.label = 'Beta Renamed';
		expect(page('beta', changed)).toContain('title: "Beta Renamed"');
		expect(page('beta', changed)).not.toEqual(page('beta'));
	});
});

describe('exampleOpt', () => {
	test('uses the first option that can differ from its default', () => {
		const [alpha, beta] = parseCatalog(fixture);
		expect(exampleOpt(alpha!)).toBe('alpha.channel=edge');
		// Every choice is a default: drop the last one, keeping the minimum.
		expect(exampleOpt(beta!)).toBe('beta.versions=1');
	});

	test('adds a non-default value to a multi option, in choice order', () => {
		const [entry] = parseCatalog([
			{
				id: 'go',
				label: 'Go',
				description: 'go',
				requires: [],
				addonImplies: {},
				options: [
					{ key: 'version', kind: 'select', label: 'V', choices: [{ value: 'latest', label: 'L' }], default: 'latest' },
					{
						key: 'addons',
						kind: 'multi',
						label: 'Add-ons',
						choices: [
							{ value: 'a', label: 'a' },
							{ value: 'b', label: 'b' },
							{ value: 'c', label: 'c' },
						],
						default: ['a', 'c'],
					},
				],
			},
		]);
		expect(exampleOpt(entry!)).toBe('go.addons=a,b,c');
	});

	test('flips a confirm option', () => {
		const [entry] = parseCatalog([
			{
				id: 'd',
				label: 'D',
				description: 'd',
				requires: [],
				addonImplies: {},
				options: [{ key: 'group', kind: 'confirm', label: 'G', default: true }],
			},
		]);
		expect(exampleOpt(entry!)).toBe('d.group=false');
	});
});

describe('Markdown helpers', () => {
	test('escapeInline escapes inline-special characters and flattens newlines', () => {
		expect(escapeInline('a|b *c* _d_ [e] <f> ~g `h` & i\nj')).toBe(
			'a\\|b \\*c\\* \\_d\\_ \\[e\\] \\<f> \\~g \\`h\\` \\& i j',
		);
	});

	test('code spans survive backticks, and pipes inside tables', () => {
		expect(code('x')).toBe('`x`');
		expect(code('a`b')).toBe('`` a`b ``');
		expect(code('a|b')).toBe('`a|b`');
		expect(code('a|b', true)).toBe('`a\\|b`');
	});
});

describe('parseCatalog', () => {
	const base = fixture[1]!;
	const bad = (patch: Record<string, unknown>) => [fixture[0], { ...base, ...patch }];

	test('accepts the fixture', () => {
		expect(parseCatalog(fixture)).toHaveLength(2);
	});

	test.each([
		['an empty catalog', [], /non-empty array/],
		['a missing label', bad({ label: undefined }), /catalog\[1\] \(beta\)\.label/],
		['a missing description', bad({ description: undefined }), /\.description/],
		['missing options', bad({ options: undefined }), /\.options: expected an array/],
		['a bad requires', bad({ requires: 'alpha' }), /\.requires/],
		['an unknown requires target', bad({ requires: ['zeta'] }), /unknown toolchain "zeta"/],
		['an id that is not a page name', bad({ id: 'Beta Two' }), /\.id/],
		['a duplicate id', bad({ id: 'alpha', requires: [] }), /duplicate id/],
		['an unknown option kind', bad({ options: [{ key: 'k', kind: 'text', label: 'K', default: '' }] }), /\.kind/],
		[
			'a select default outside its choices',
			bad({ options: [{ key: 'k', kind: 'select', label: 'K', choices: [{ value: 'a', label: 'a' }], default: 'b' }] }),
			/not one of the choices/,
		],
		['a confirm without a boolean default', bad({ options: [{ key: 'k', kind: 'confirm', label: 'K' }] }), /\.default: expected a boolean/],
	])('rejects %s', (_name, raw, message) => {
		expect(() => parseCatalog(raw)).toThrow(CatalogError);
		expect(() => parseCatalog(raw)).toThrow(message);
	});
});
