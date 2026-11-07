---
name: shell-scripting
description: Rules for writing and reviewing bash/zsh in this workspace. Use when editing any .sh file (including install-toolchains.sh), shell rc or profile files (.bashrc, .zshrc, .profile, .zprofile, /etc/profile.d), the snippet builders in libs/core/src/shell.ts, or the bash scripts that toolchain installers in libs/toolchains/src/toolchains/ pass to Runner.asRoot/asUser.
---

# Shell scripting

Scripts here run on real machines as root or as the user. Prefer boring,
idempotent, fully quoted bash. Verify with `bash -n` and shellcheck before
committing.

## Strict mode

- Standalone scripts: `set -euo pipefail` by default.
- When one failing step must not abort the rest (as in
  `install-toolchains.sh`): `set -uo pipefail` at the top, and run each step in
  its own subshell with `( set -e; step )`, then record its status.
- `set -e` is ignored inside a function called from `if`, `&&`, `||` or `!`.
  Do not rely on it there; check the status explicitly.
- Sourcing files that are not `-u`/`-e` safe (e.g. `nvm.sh`): wrap them, as in
  `set +e; . "$NVM_DIR/nvm.sh"; set -e`.
- In this repo, `rootScript`/`userScript` (`libs/core/src/runner.ts`) already
  prepend `set -e`; snippets must not assume `-u` or `pipefail`.

## Quoting

- Quote every expansion: `"$var"`, `"$@"`, `"$(cmd)"`. Use arrays for argument
  lists, never word-splitting of a string.
- TypeScript building bash: pass every interpolated value through `shQuote`
  (`libs/core/src/shell.ts`). It produces one single-quoted word, escaping `'`
  as `'\''`. Only hard-coded, reviewed literals may stay unquoted.
- `printf '%s\n' "$x"` instead of `echo "$x"` for arbitrary data.

## Heredocs

- `<<'EOF'`: body is literal; nothing expands. Use it for files that must
  contain `$VAR` text (rc blocks, profile.d scripts).
- `<<EOF`: body expands `$var`, `$(...)` and backticks; escape the ones meant
  for later as `\$HOME`, `\$(...)`.
- `<<-EOF` strips leading tabs only, not spaces.
- Writing a root-owned file as a user: `sudo tee /path >/dev/null <<'EOF'`, not
  `sudo cat > /path` (the redirection runs unprivileged).

## Idempotent rc and profile edits

- Never append blindly. Guard with a marker: `grep -qF "$marker" "$f" || ...`.
- Use the existing markers and builders so machines configured by
  `install-toolchains.sh` are recognised: `# >>> name >>>` / `# <<< name <<<`
  via `addRcBlock`, `/etc/profile.d/devtools-<name>.sh` via `writeProfile`,
  and `# devtools-profile-hook`. Markers must stay byte-identical.
- Skip rc files that do not exist rather than creating them.
- PATH additions: guard against duplicates with
  `case ":$PATH:" in *:/dir:*) ;; *) PATH="$PATH:/dir" ;; esac`.

## Startup files: bash vs zsh

| Shell | Login                                                                                                        | Interactive non-login           |
| ----- | ------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| bash  | `/etc/profile` (+ `/etc/profile.d/*.sh`), then the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` | `/etc/bash.bashrc`, `~/.bashrc` |
| zsh   | `/etc/zsh/zprofile`, `~/.zprofile`, then `zshrc` files                                                       | `/etc/zsh/zshrc`, `~/.zshrc`    |

- Terminal emulators usually start interactive non-login shells, which never
  read `/etc/profile.d`. That is why `writeProfile` appends the
  `devtools-profile-hook` line to `/etc/bash.bashrc` and `/etc/zsh/zshrc`.
- On Debian/Ubuntu, zsh does not read `/etc/profile` unless
  `/etc/zsh/zprofile` sources it.
- `bash -lc` (used by `Runner.asUser`) is a login, non-interactive shell: it
  reads `~/.profile` but not `~/.bashrc`, and Ubuntu's `~/.bashrc` returns
  early for non-interactive shells. Hence `USER_ENV` sets PATH and loads nvm
  explicitly.

## sudo, runuser, sudo -u

- `sudo cmd`: runs as root; `env_reset` drops most of the environment and
  `secure_path` replaces PATH, so tools in `~/.local/bin` or nvm are not found.
  `HOME` becomes root's on Ubuntu. Pass what you need explicitly
  (`sudo DEBIAN_FRONTEND=noninteractive apt-get ...` or export it inside the
  `bash -c` script, as `rootScript` does).
- `sudo -u user cmd`: needs sudo rights and a sudoers policy; same env reset.
  Add `-H` or `-i` for the target's HOME/login environment.
- `runuser -u user -- cmd`: root only, no PAM password prompt, no sudoers.
  Keeps the caller's environment, so set `HOME`, `USER`, `LOGNAME` with
  `env` (as `ProcessRunner.asUser` does).
- Redirections and pipes run in the calling shell: wrap them,
  `sudo bash -c '... > /etc/file'`.

## Downloads

- `curl -fsSL` always (fail on HTTP errors, follow redirects). For piping to a
  shell, add `--proto '=https' --tlsv1.2` and prefer download-then-run so a
  truncated transfer cannot execute half a script.
- Verify checksums when the publisher provides them:
  `printf '%s  %s\n' "$sha" "$file" | sha256sum -c -`. In TypeScript use
  `installGithubBinary` with `sha256Url` (`libs/toolchains/src/github-release.ts`).
- Download into `tmp=$(mktemp -d)` with `trap 'rm -rf "$tmp"' EXIT`.

## Verify before committing

```sh
bash -n path/to/script.sh
docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable path/to/script.sh
```

- Generated snippets: specs drive installers with `RecordingRunner`, assert
  the recorded `asRoot`/`asUser` calls, and pipe each script through
  `bash -n` (see `libs/toolchains/src/toolchains/go.spec.ts`).
- End to end: build, then run the bundle with `--dry-run`. Never run an
  installer for real on a development machine.
