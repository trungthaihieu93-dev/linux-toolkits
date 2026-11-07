import { shQuote } from '@linux-toolchain/core';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const BIN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface LatestReleaseOptions {
  /** Called with a human-readable reason when the fallback tag is used. */
  onWarn?: (message: string) => void;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
}

/**
 * Tag of the latest GitHub release of `repo` (e.g. `jesseduffield/lazydocker`).
 * Never throws for network/API problems: any failure returns `fallbackTag`
 * and reports why through `onWarn`, like the nvm lookup in the bash script.
 */
export async function latestRelease(
  repo: string,
  fallbackTag: string,
  fetchFn: typeof fetch = fetch,
  options: LatestReleaseOptions = {},
): Promise<string> {
  if (!REPO_RE.test(repo))
    throw new Error(`invalid GitHub repo: ${JSON.stringify(repo)}`);
  if (!TAG_RE.test(fallbackTag))
    throw new Error(`invalid fallback tag: ${JSON.stringify(fallbackTag)}`);

  let reason: string;
  try {
    const res = await fetchFn(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'linux-toolchain',
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      },
    );
    if (res.ok) {
      const body: unknown = await res.json();
      const tag =
        body && typeof body === 'object' && 'tag_name' in body
          ? (body as { tag_name: unknown }).tag_name
          : undefined;
      if (typeof tag === 'string' && TAG_RE.test(tag)) return tag;
      reason = 'response has no usable tag_name';
    } else {
      reason = `HTTP ${res.status}`;
    }
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  options.onWarn?.(
    `could not resolve the latest ${repo} release (${reason}); using ${fallbackTag}`,
  );
  return fallbackTag;
}

export interface GithubBinarySpec {
  /** https URL of the release asset. */
  url: string;
  /** https URL of a checksums file (`<sha256>  <asset>` lines, or a lone hash). Verified when given. */
  sha256Url?: string;
  /** Installed file name, e.g. `lazydocker`. */
  binName: string;
  /** Absolute target directory (default /usr/local/bin). */
  dest?: string;
  archive: 'tar.gz' | 'zip' | 'raw';
  /** Path of the binary inside the archive (default `binName`). Ignored for `raw`. */
  innerPath?: string;
}

function assertHttps(url: string, what: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid ${what}: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== 'https:')
    throw new Error(`${what} must use https: ${url}`);
  return parsed;
}

/**
 * Root shell snippet that downloads a release binary into a temp dir, verifies
 * its sha256 when a checksum URL is given, extracts it and installs it with
 * mode 0755. Runs in a subshell so its temp-dir trap and `set -e` stay local.
 */
export function installGithubBinary(spec: GithubBinarySpec): string {
  const asset = decodeURIComponent(
    assertHttps(spec.url, 'asset URL').pathname.split('/').pop() ?? '',
  );
  if (!BIN_RE.test(asset))
    throw new Error(`cannot derive an asset name from ${spec.url}`);
  if (!BIN_RE.test(spec.binName))
    throw new Error(`invalid binary name: ${JSON.stringify(spec.binName)}`);
  const dest = spec.dest ?? '/usr/local/bin';
  if (!dest.startsWith('/')) throw new Error(`dest must be absolute: ${dest}`);
  const inner = spec.innerPath ?? spec.binName;
  if (inner.startsWith('/') || inner.split('/').includes('..')) {
    throw new Error(
      `innerPath must be relative and stay inside the archive: ${inner}`,
    );
  }

  const file = `"$tmp"/${shQuote(asset)}`;
  const lines = [
    '(',
    'set -e',
    'tmp=$(mktemp -d)',
    `trap 'rm -rf "$tmp"' EXIT`,
    `curl -fsSL --retry 3 -o ${file} ${shQuote(spec.url)}`,
  ];
  if (spec.sha256Url) {
    assertHttps(spec.sha256Url, 'checksum URL');
    lines.push(
      `curl -fsSL --retry 3 -o "$tmp/checksums" ${shQuote(spec.sha256Url)}`,
      // Match `<hash>  <asset>` (optionally `*<asset>`); a single-hash file applies to the asset.
      `expected=$(awk -v n=${shQuote(asset)} 'NR==1 && NF==1 {h=$1} {f=$2; sub(/^\\*/, "", f)} f==n {print $1; found=1; exit} END {if (!found && h) print h}' "$tmp/checksums")`,
      `[ -n "$expected" ] || { echo ${shQuote(`no sha256 for ${asset} in ${spec.sha256Url}`)} >&2; exit 1; }`,
      `printf '%s  %s\\n' "$expected" ${file} | sha256sum -c --quiet -`,
    );
  }
  switch (spec.archive) {
    case 'tar.gz':
      lines.push(
        'mkdir "$tmp/x"',
        `tar -xzf ${file} -C "$tmp/x"`,
        `src="$tmp/x"/${shQuote(inner)}`,
      );
      break;
    case 'zip':
      lines.push(
        'mkdir "$tmp/x"',
        `unzip -q ${file} -d "$tmp/x"`,
        `src="$tmp/x"/${shQuote(inner)}`,
      );
      break;
    case 'raw':
      lines.push(`src=${file}`);
      break;
  }
  lines.push(
    `install -d ${shQuote(dest)}`,
    `install -m 0755 "$src" ${shQuote(`${dest.replace(/\/+$/, '')}/${spec.binName}`)}`,
    ')',
  );
  return lines.join('\n');
}
