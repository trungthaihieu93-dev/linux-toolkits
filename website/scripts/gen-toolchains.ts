/**
 * Generate the toolchain reference from the linux-toolchain catalog.
 *
 * Runs the CLI from its TypeScript source (`list --json`), validates the
 * output and writes one page per toolchain plus src/data/toolchains.json.
 * Stale generated pages (a toolchain removed from the catalog) are deleted.
 * Needs the ubuntu/ dependencies: `cd ubuntu && bun install --frozen-lockfile`.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CatalogError, DATA_FILE, PAGES_DIR, parseCatalog, renderToolchains } from './render-toolchains';

const websiteDir = resolve(import.meta.dir, '..');
const ubuntuDir = resolve(websiteDir, '../ubuntu');
const cliEntry = join(ubuntuDir, 'apps/linux-toolchain/src/main.ts');

function fail(message: string): never {
	console.error(`gen-toolchains: ${message}`);
	process.exit(1);
}

function readCatalog(): unknown {
	if (!existsSync(cliEntry)) fail(`CLI source not found at ${cliEntry}`);
	const proc = Bun.spawnSync([process.execPath, cliEntry, 'list', '--json'], {
		cwd: ubuntuDir,
		stdout: 'pipe',
		stderr: 'pipe',
	});
	if (proc.exitCode !== 0) {
		fail(
			`\`list --json\` exited with ${proc.exitCode}. Install the CLI dependencies with ` +
				`\`cd ubuntu && bun install --frozen-lockfile\`.\n${proc.stderr.toString()}`,
		);
	}
	try {
		return JSON.parse(proc.stdout.toString());
	} catch (error) {
		fail(`\`list --json\` did not print valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function main(): void {
	let files;
	try {
		files = renderToolchains(parseCatalog(readCatalog()));
	} catch (error) {
		if (error instanceof CatalogError) fail(`unexpected catalog shape: ${error.message}`);
		throw error;
	}

	const pagesDir = join(websiteDir, PAGES_DIR);
	if (existsSync(pagesDir)) {
		for (const name of readdirSync(pagesDir)) {
			if (name.endsWith('.md')) rmSync(join(pagesDir, name));
		}
	}
	for (const file of files) {
		const target = join(websiteDir, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.content);
	}
	console.log(`gen-toolchains: wrote ${files.length - 1} toolchain pages and ${DATA_FILE}`);
}

main();
