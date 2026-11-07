# linux-toolchain

Interactive installer for common developer toolchains on Debian/Ubuntu Linux.
It is a TypeScript port of `install-toolchains.sh`. You pick toolchains,
then each one's sub-options and add-ons, review the plan, and the installers
run one after another.

```sh
npx linux-toolchain            # interactive
bunx linux-toolchain           # same, with bun
npx linux-toolchain --help
```

Requires Linux with apt (Debian, Ubuntu and derivatives) and Node.js 22.13 or
newer (or bun). The published package is a single bundled file with no runtime
dependencies.

## Usage

```text
linux-toolchain [install] [ids...]    install toolchains (default command)
  --all                 select every toolchain
  --only <ids>          comma-separated ids, same as the positional [ids...]
  --opt <key=value>     set a sub-option, repeatable: --opt java.jdk=17,21
  --defaults            accept defaults for every sub-option (no option prompts)
  --user <name>         target user (only when running as root)
  -y, --yes             skip confirmations, including the Android SDK licenses
  --dry-run             print the root/user scripts that would run; change nothing
linux-toolchain list [--json]         ids, labels, options and add-ons
linux-toolchain --version | --help
```

### Examples

```sh
# Interactive: pick toolchains, then each one's options and add-ons.
npx linux-toolchain

# Java 17 + 21 with Maven and Gradle, plus Go with its default add-ons. No prompts.
npx linux-toolchain --only java,go --opt java.jdk=17,21 --opt java.addons=maven,gradle -y

# Show every script the full install would run, without changing anything.
npx linux-toolchain --all --defaults --dry-run

# Machine-readable catalog (option keys, choices, defaults).
npx linux-toolchain list --json
```

### What is asked, and when

1. **Toolchains**: a checklist of the catalog, unless ids, `--only` or `--all`
   were given. Without ids and without a terminal the CLI stops with
   `no TTY for the menu; use --all or --only id,id`.
2. **Sub-options and add-ons**: for each selected toolchain (`Java (2/4)`),
   every option is asked with its default pre-selected and the recommended
   add-ons pre-checked. Options given with `--opt` are not asked again. The
   default JDK is only offered from the JDKs chosen just before. These prompts
   are skipped with `--defaults`, `-y`, or when stdin/stdout is not a terminal;
   defaults and `--opt` values apply instead.
3. **Dependencies**: some choices add toolchains, which are then asked about
   too. `bun-tools` adds `nvm-bun` when bun is missing, `jenv` adds `java`
   when no JDK is in `/usr/lib/jvm`, the `java` add-on `jenv` adds `jenv`, and
   the `flutter` add-on `android-sdk` adds `android`. `--opt` may target a
   toolchain added this way; an `--opt` for any other unselected toolchain is
   a usage error, and so is `bun-tools` with `--opt nvm-bun.bun=false`.
4. **Android SDK licenses**: when `android` is selected, the CLI asks
   `Accept the Android SDK licenses (https://developer.android.com/studio/terms)?`.
   Declining marks `android` as failed and the rest still install. `-y`
   accepts them. Without `-y` and without a terminal, `android` fails and
   asks for `-y`.
5. **Review**: a table of the toolchains and their choices, then `Proceed?`
   (skipped with `-y` or without a terminal).

The toolchains then install in catalog order. A failing toolchain is reported
and the next one still runs. The summary lists `ok`, `failed` and add-on
`warnings`. Open a new shell (or log out and back in) afterwards so PATH
changes and the docker group take effect.

## Sudo model

Run it as your normal user. User-level tools (nvm, bun, rustup, uv, Claude
Code, ...) install into your home directory. System steps (apt, `/usr/local`,
`/opt`, `/etc/profile.d`) go through `sudo`, which prompts once and is kept
fresh for the rest of the run. The CLI never reads or stores your password.

`sudo npx linux-toolchain` also works. Running as root, it installs user-level
tools for the invoking sudo user (`SUDO_USER`), or for `--user NAME`, through
`runuser`. `--user` is rejected when not running as root, except with
`--dry-run`, which only prints the scripts for that user.

`--dry-run` executes nothing and never calls `sudo`. It prints each step as a
`[root] <label>` or `[user] <label>` block followed by its script.

## Toolchains

Set any option with `--opt <id>.<key>=<value>`. Multi options take a comma
list (an empty value means none), yes/no options take `true`/`false`. Bold
values are the defaults.

| id          | Installs                                                               | Options (`--opt` key: values)                                                                                                                            |
| ----------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nvm-bun`   | latest nvm & bun, then Node via nvm                                    | `node`: **lts**, current, lts-prev · `bun`: **true** · `addons`: **pnpm**, yarn, **typescript**                                                          |
| `bun-tools` | global CLIs with bun (needs `nvm-bun`)                                 | `packages`: **nx**, **turbo**, **expo**, **@nestjs/cli**, **@angular/cli**, **opencode-ai**, **@openai/codex**, **cline**, **@kilocode/cli**             |
| `go`        | latest Go tarball -> `/usr/local/go`                                   | `version`: **latest** · `addons`: **gopls**, **golangci-lint**, delve                                                                                    |
| `rust`      | rustup + toolchain and components                                      | `toolchain`: **stable**, beta, nightly · `components`: **clippy**, **rustfmt**, **rust-analyzer** · `addons`: **cargo-nextest**, cargo-watch, cargo-edit |
| `python`    | python3, pip, venv, pipx, uv                                           | `uv`: **true** · `pipx`: **true** · `addons`: **ruff**, poetry, pre-commit                                                                               |
| `pyenv`     | pyenv + build deps, shell init in `~/.bashrc` and `~/.zshrc`           | `python`: none, **latest**, latest-1, latest-2 · `addons`: pyenv-virtualenv                                                                              |
| `java`      | OpenJDK (apt) -> `/usr/lib/jvm`                                        | `jdk`: 17, **21**, 25 (at least one) · `default`: 17, **21**, 25 · `addons`: **maven**, **gradle**, jenv (adds `jenv`)                                   |
| `jenv`      | jenv, registers the installed JDKs (needs a JDK)                       | `global`: 17, **21**, 25 · `addons`: **export**, maven, gradle                                                                                           |
| `flutter`   | Flutter -> `/opt/flutter` + Linux desktop build tools                  | `channel`: **stable**, beta · `addons`: android-sdk (adds `android`), web, **fvm**                                                                       |
| `android`   | JDK + cmdline-tools, platform-tools, build-tools -> `/opt/android-sdk` | `platforms`: **latest**, latest-and-previous · `build-tools`: **latest** · `addons`: emulator, ndk, cmake                                                |
| `cpp`       | C/C++ compilers, build systems, debuggers                              | `compilers`: **gcc**, **clang** · `build`: **cmake-ninja**, **meson**, **make** · `addons`: **cppcheck**, conan, vcpkg                                   |
| `docker`    | docker-ce, buildx, compose from Docker's apt repo                      | `group`: **true** (add the user to the docker group) · `addons`: **lazydocker**, dive, hadolint                                                          |
| `claude`    | Claude Code CLI, native installer                                      | none                                                                                                                                                     |

`npx linux-toolchain list` prints the same catalog from the installed version.

## Migrating from install-toolchains.sh

The ids are the same, and so are the base packages, the per-toolchain
isolation, the summary and the final note.

| `install-toolchains.sh`        | `linux-toolchain`                                                         |
| ------------------------------ | ------------------------------------------------------------------------- |
| `sudo ./install-toolchains.sh` | `npx linux-toolchain` (no sudo needed; prompts once when required)        |
| `--all`                        | `--all` (add `--defaults` for the script's fixed choices without prompts) |
| `--only id,id`                 | `--only id,id` or `linux-toolchain id id`                                 |
| `--user NAME`                  | `--user NAME` (only as root, e.g. `sudo npx linux-toolchain --user NAME`) |
| `-y`                           | `-y` / `--yes`                                                            |
| `--list`                       | `list` (or `list --json`)                                                 |
| `-h`                           | `-h` / `--help`                                                           |
| (none)                         | `--opt`, `--defaults`, `--dry-run`, `--version`                           |

The defaults differ from the script's fixed choices in places. For example,
`java` installs JDK 21 with Maven and Gradle by default where the script
installed 21 and 25. Use `--opt` (for example `--opt java.jdk=21,25`) to get
the old set, and `--dry-run` to compare.

## Exit codes

| Code | Meaning                                                                                                                                                                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Success, nothing selected, or the review was declined                                                                                                                                                                                                                                                 |
| 1    | A toolchain failed, apt-get update failed, unsupported platform, or the current or target user has no passwd entry or home directory                                                                                                                                                                  |
| 2    | Usage error: unknown flag or id, `--all` with ids, bad `--opt`, `--opt` for a toolchain that is not selected, `bun-tools` with `nvm-bun.bun=false` while bun is not installed, no TTY for the menu, no usable target user (`--user` without root, root without `SUDO_USER` or `--user`, unknown user) |
| 130  | Cancelled with Ctrl+C at a prompt                                                                                                                                                                                                                                                                     |

## License

MIT
