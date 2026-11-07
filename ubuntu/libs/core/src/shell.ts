/**
 * Pure builders for the shell snippets the installers run. Each returns bash
 * text; nothing here touches the system. Marker strings are byte-identical to
 * install-toolchains.sh so machines it already configured are recognised.
 */

/** Quote a value as a single bash word. Use for every interpolated value. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(`invalid snippet name: ${JSON.stringify(name)}`);
  }
}

/** Shell line printing a `[warn]` message to stderr, styled like the bash script. */
function warnLine(message: string): string {
  return `printf '\\033[1;33m[warn]\\033[0m %s\\n' ${message} >&2`;
}

export const PROFILE_HOOK_MARKER = '# devtools-profile-hook';
export const PROFILE_HOOK_LINE =
  'for _f in /etc/profile.d/devtools-*.sh; do [ -r "$_f" ] && . "$_f"; done; unset _f';

export function rcBlockStart(name: string): string {
  return `# >>> ${name} >>>`;
}

export function rcBlockEnd(name: string): string {
  return `# <<< ${name} <<<`;
}

export function profilePath(name: string): string {
  return `/etc/profile.d/devtools-${name}.sh`;
}

/**
 * apt-get install with the bulk-then-per-package fallback: if the bulk install
 * fails, retry one by one so a single missing package doesn't sink the rest.
 * Always exits 0. Runs as root.
 */
export function aptInstall(pkgs: readonly string[]): string {
  if (pkgs.length === 0)
    throw new Error('aptInstall needs at least one package');
  const quoted = pkgs.map(shQuote).join(' ');
  return [
    `if ! apt-get install -y --no-install-recommends ${quoted}; then`,
    `  ${warnLine(shQuote('bulk install failed, retrying package by package'))}`,
    `  for p in ${quoted}; do`,
    `    apt-get install -y --no-install-recommends "$p" || ${warnLine('"skipped: $p"')}`,
    '  done',
    'fi',
  ].join('\n');
}

/**
 * Append a marked block to the user's ~/.bashrc and ~/.zshrc, once. Files that
 * do not exist are skipped; so are files matching `skipRegex` (an ERE, e.g. an
 * installer's own edit). Runs as the target user ($HOME is the target home).
 */
export function addRcBlock(
  name: string,
  body: string,
  skipRegex?: string,
): string {
  assertName(name);
  // Same as `block=$(cat)` in bash: trailing newlines are dropped.
  const block = body.replace(/\n+$/, '');
  const lines = [
    'for f in "$HOME/.bashrc" "$HOME/.zshrc"; do',
    '  [ -f "$f" ] || continue',
    `  grep -qF ${shQuote(rcBlockStart(name))} "$f" && continue`,
  ];
  if (skipRegex)
    lines.push(`  grep -qE ${shQuote(skipRegex)} "$f" && continue`);
  lines.push(
    `  printf '\\n# >>> %s >>>\\n%s\\n# <<< %s <<<\\n' ${shQuote(name)} ${shQuote(block)} ${shQuote(name)} >> "$f"`,
    'done',
  );
  return lines.join('\n');
}

/**
 * Write /etc/profile.d/devtools-<name>.sh and hook profile.d into the
 * interactive bash and zsh rc files (once). Runs as root.
 */
export function writeProfile(name: string, body: string): string {
  assertName(name);
  const path = shQuote(profilePath(name));
  const content = body.replace(/\n+$/, '');
  return [
    'install -d /etc/profile.d',
    `printf '%s\\n' ${shQuote(content)} > ${path}`,
    `chmod 644 ${path}`,
    'for f in /etc/bash.bashrc /etc/zsh/zshrc; do',
    '  [ -f "$f" ] || continue',
    `  grep -qF ${shQuote(PROFILE_HOOK_MARKER)} "$f" && continue`,
    `  printf '%s\\n' ${shQuote(PROFILE_HOOK_MARKER)} ${shQuote(PROFILE_HOOK_LINE)} >> "$f"`,
    'done',
  ].join('\n');
}
