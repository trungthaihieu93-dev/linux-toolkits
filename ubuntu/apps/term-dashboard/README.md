# linux-term-dashboard (`td`)

A local web dashboard for terminal and shell configuration on Linux. Running
`td` starts a server on `127.0.0.1`, prints a one-time launch URL and opens it
in the browser. The dashboard edits:

- **Ghostty**: every key of the installed version (from
  `ghostty +show-config --default --docs`), with theme and font pickers. td
  edits `~/.config/ghostty/config.ghostty` and `~/.config/ghostty/config`
  (Ghostty loads them in that order, so the later one wins) and lists
  `config-file` includes read-only.
- **Ptyxis and GNOME Terminal**: global settings, shortcuts and profiles
  (create, duplicate, rename, set default, delete), generated from the
  installed gsettings schemas. GNOME Terminal appears only when its schema is
  installed.
- **bash and zsh**: a form for aliases, exports, PATH entries, history options
  and oh-my-zsh theme and plugins, which writes only inside td's managed
  blocks, and a full-file editor for every shell file.

Every command td runs (syntax checks, `gsettings`, `ghostty`) streams live to
an activity panel, and a Terminal page runs your login shell in a real PTY.

## Install

Requires Linux and Node.js 22.13 or newer (or Bun). Ghostty, Ptyxis, GNOME
Terminal and zsh are optional; pages for missing programs say so. The Terminal
page needs `script` and `setpriv` from util-linux.

The package is not on npm yet (see [Maintainer notes](#maintainer-notes)).
Once it is published:

```sh
npx linux-term-dashboard        # or: bunx linux-term-dashboard
npm install -g linux-term-dashboard && td
```

Until then, build and link it from this repository (see
[Local development](#local-development)).

## Usage

```sh
td                  # start (or reopen the running instance) and open the browser
td --no-open        # print the launch URL only
td --port 0         # pick a free port
td --help
```

| Flag            | Meaning                                                     |
| --------------- | ----------------------------------------------------------- |
| `--port <n>`    | Port on `127.0.0.1`; `0` picks a free port. Default: `4777` |
| `--no-open`     | Print the launch URL without opening a browser              |
| `-v, --version` | Print the td version                                        |
| `-h, --help`    | Show help                                                   |

The launch URL carries a single-use code that expires after 60 seconds. If it
expires, run `td` again: when td is already running, the second `td` asks it
for a new code, prints the URL, opens the browser and exits 0 without starting
another server. Without `DISPLAY` or `WAYLAND_DISPLAY`, or with `--no-open`,
td only prints the URL in your terminal.

Exit codes: `0` success, `1` error, `2` usage error, and `129`, `130` or `143`
after SIGHUP, SIGINT or SIGTERM. Stopping td by any of these signals ends every
terminal it opened, background jobs included, and closes the connections of
open dashboard tabs, so td exits at once even while a tab is open.

Settings (theme, the shell for the Terminal page) are kept in
`~/.config/term-dashboard/settings.json`.

## Safety model

td edits real dotfiles and terminal settings and offers a shell in the
browser, so it is built to be reachable only by you and to keep every change
reversible.

- **Loopback only.** The server binds `127.0.0.1` and nothing else. There is no
  option to listen on another interface.
- **Your connections only.** Loopback is shared by every user on the machine,
  so connections from other local users are refused by peer uid: for each
  accepted connection td looks up the owner of its client end in
  `/proc/net/tcp` and closes it, before reading anything, unless it is you.
  A connection whose owner cannot be found is refused too.
- **Session tokens.** Every API call and the terminal WebSocket need a
  256-bit session token. The browser gets one by redeeming the single-use
  launch code from the URL fragment (`#c=...`); every redemption gets its own
  token, and all tokens end when td stops. td prints one line on its terminal
  each time a code is used, so a session you did not start is visible; stop
  td with Ctrl+C if you see one.
- **Launch code.** The code in the launch URL is single-use and expires
  after 60 seconds. It is passed to `xdg-open` and the browser, so other
  local users may see it in the process list, but it is only useful to you:
  their connections are refused by the peer check. The session token itself
  never appears in a URL or in a process argument list.
- **Second start.** A second `td` reads a separate instance secret from
  `$XDG_RUNTIME_DIR/term-dashboard/instance.json` (mode 0600) to mint new
  codes. Before it sends the secret, the running instance must prove it knows
  that secret (an HMAC of a fresh challenge) and its pid must be one of your
  processes; otherwise the file is treated as stale and a new server starts.
- **Host and Origin checks.** Requests whose `Host` is not
  `127.0.0.1:<port>` or `localhost:<port>` get 403 (DNS rebinding), and so do
  cross-origin API calls and WebSocket upgrades. File saves are limited to
  1 MB, terminal messages to 64 KB, and at most 4 terminals run at once.
  Every response forbids framing (`X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'`).
- **Bounded memory.** When the browser cannot keep up with a terminal (for
  example `yes`), td stops reading its output until the browser catches up,
  so the program waits instead of td's memory growing.
- **No root.** td refuses to start its server as root.
- **Allowlisted files.** The browser names files by id, never by path. td
  writes only `~/.bashrc`, `~/.bash_profile`, `~/.bash_aliases`, `~/.profile`,
  `~/.zshrc`, `~/.zshenv`, `~/.zprofile` and the two Ghostty files, and refuses
  symlinks that lead outside your home or config folder.
- **Managed blocks.** The shell forms write only between
  `# >>> term-dashboard >>>` and `# <<< term-dashboard <<<` (and, for
  oh-my-zsh theme and plugins, a `term-dashboard-omz` block right above
  `source $ZSH/oh-my-zsh.sh`). Everything else in the file is kept as is.
- **Check, diff, backup, atomic write.** Each save shows a diff first. The
  candidate is checked with `bash -n`, `zsh -n`, `sh -n` (for `~/.profile`,
  which `/bin/sh` reads at login) or `ghostty +validate-config`, and a failed
  check writes nothing. Then the current file is copied to a timestamped
  backup, and the new content replaces it atomically with the same mode. A
  file changed on disk since it was loaded is never overwritten (the
  dashboard asks you to reload), and saves to the same file from two tabs
  run one after the other, so one of them is told to reload. This holds when
  two of the files are one file through a symlink (`~/.bash_profile` pointing
  at `.profile`, for example). A Ghostty save
  that touches both files checks both first; if writing the second fails, the
  first is put back from its backup.
- **Only UTF-8 is edited.** A file that is not valid UTF-8 is shown read-only
  with the reason, and td refuses to save it or restore a backup that is not
  UTF-8, so it never rewrites bytes it could not decode. A UTF-8 file keeps a
  leading byte order mark, so saving it unchanged writes the same bytes. Edit
  other files in a text editor.
- **gsettings, never dconf.** Terminal settings go through `gsettings` only.
  Before the first change of each run, and again right before every restore,
  td saves a JSON backup of every installed terminal's settings.
- **The activity panel shows what td ran.** It lists every command td runs
  with its output, including syntax-check messages, which can quote a line of
  your rc file. It stays in td's memory and in the authenticated browser
  only.

## Backups and restore

Backups live in `~/.local/state/term-dashboard/backups/` (or
`$XDG_STATE_HOME/term-dashboard/backups/`), one folder per save named
`YYYYMMDDTHHMMSSZ` (UTC). Folders are mode 0700 and files 0600.

- **In the dashboard:** the Backups page lists every file backup (newest
  first) and every gsettings backup. Restoring a file shows the diff and takes
  a new backup of the current content first. Restoring a gsettings backup
  first saves the current settings as a new backup (so the restore can be
  undone by restoring that one), then resets the terminal's settings to the
  saved values and removes profiles created after it. If some keys cannot be
  set, td sets the rest and lists the failed keys. The Ptyxis and GNOME
  Terminal pages also have "Restore backup".
- **By hand:** a file backup is a plain copy named after its file id, so
  restoring is a copy, for example:

  ```sh
  ls ~/.local/state/term-dashboard/backups/
  cp ~/.local/state/term-dashboard/backups/20261108T071500Z/zshrc ~/.zshrc
  ```

  gsettings backups are `gsettings.json` files with the non-default keys of
  each schema; restore them from the dashboard.

## Local development

From `ubuntu/` in the repository:

```sh
bun run dev:td        # td from source on 127.0.0.1:4777 plus Vite on http://localhost:5173
bun run link:td       # build, then `bun link` the package, so `td` runs the built bundle
bun run unlink:td     # remove the link
bun --bun nx test term-dashboard
bun --bun nx test term-config
bun --bun nx test term-dashboard-web
bun --bun nx e2e term-dashboard     # builds, then runs the bundle in a throwaway HOME
```

`dev:td` passes the hidden `--dev-origin http://localhost:5173` flag, so the
server accepts the Vite dev server as an origin; open the launch URL it prints.
After `link:td`, `td` resolves to `~/.bun/bin/td`.

## Testing without touching your machine

Point td at a throwaway home before you try changes by hand. td resolves every
path from these variables, and with the keyfile backend gsettings writes to a
file in the sandbox instead of your dconf database:

```sh
sandbox=$(mktemp -d)
mkdir -p "$sandbox/home" "$sandbox/run" && chmod 700 "$sandbox/run"
env -u DISPLAY -u WAYLAND_DISPLAY \
  HOME="$sandbox/home" \
  XDG_CONFIG_HOME="$sandbox/home/.config" \
  XDG_STATE_HOME="$sandbox/home/.local/state" \
  XDG_DATA_HOME="$sandbox/home/.local/share" \
  XDG_CACHE_HOME="$sandbox/home/.cache" \
  XDG_RUNTIME_DIR="$sandbox/run" \
  GSETTINGS_BACKEND=keyfile \
  td --no-open --port 0
```

The `dconf` command ignores `GSETTINGS_BACKEND`, which is why td never calls
it. Unsetting `DISPLAY` and `WAYLAND_DISPLAY` keeps td from opening a browser.
The unit, integration and e2e tests use the same setup.

## Maintainer notes

The package is `"private": true`, and the CI `release` job publishes only
`linux-toolchain`.

td's lint, unit tests, build and e2e tests run in the `checks` job with the
rest of the workspace, together with the zsh install they need. td shares
libraries with `linux-toolchain`, and CI covers every project, so `release`
depends on them: a failing td test, or a failed zsh install, holds back a
`linux-toolchain` publish.

Only the td packaging and runtime checks sit outside the release gate. The
`td` job packs the package (artifact `td-package`). `td-node-compat` runs
`td --version`, a health check, and a shutdown check on Node 22.13 and 24:
with an authenticated activity stream open, SIGTERM must stop td promptly
(exit 143) and remove its instance file. `td-smoke` runs the tarball with
`npx`. `release` does not need these three jobs.

Publishing td is a separate change that needs the maintainer's go-ahead:

1. Remove `"private": true` from `apps/term-dashboard/package.json`.
2. Add the `td-package` tarball to the `release` job, next to the
   `linux-toolchain` one, with its own "already on npm" check and tag.
3. Publish the first version once (a new package has no trusted publisher
   yet).
4. Configure trusted publishing for `linux-term-dashboard` on npmjs.com.
