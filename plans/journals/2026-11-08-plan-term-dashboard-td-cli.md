---
title: Plan term-dashboard td CLI
date: 2026-11-08
summary: "Planned the td local dashboard for Ghostty, Ptyxis/GNOME Terminal and bash/zsh configs; red-team fixed 2 blockers."
---

# Plan term-dashboard td CLI

## What happened
Wrote `plans/261108-0744-term-dashboard/` (plan.md plus six phases) for a new `ubuntu/` CLI app, `td`. It is a Hono server on 127.0.0.1 serving a Vite/React dashboard that manages Ghostty, Ptyxis/GNOME Terminal and bash/zsh configs, streams every command it runs, and embeds a PTY terminal.

Probes on Ubuntu 26.04 changed the design. Ptyxis is the native terminal and GNOME Terminal isn't installed. Ghostty 1.4 exposes 629 documented keys through `+show-config --default --docs`. Under Node, `script -qfec` provides a PTY, and `stty -F /dev/pts/N` resizes it (SIGWINCH is delivered). `GSETTINGS_BACKEND=memory` returns schema defaults.

## Decision
- The user chose an npm Node bundle (no native PTY), both streaming modes, Ptyxis plus GNOME Terminal, a managed block for Config mode, and the package name `linux-term-dashboard` (kept private).
- Red-team accepted fixes:
  - Use `gsettings` only. The `dconf` CLI ignores `GSETTINGS_BACKEND`, so sandboxed tests would have hit the real dconf.
  - Add a second oh-my-zsh block above `source $ZSH/oh-my-zsh.sh`, because theme and plugins set later have no effect.
  - Put a single-use launch code in the URL instead of the token, because argv is readable by other users.
  - Use an instance file for port reuse.
  - Use pdeathsig, a session kill and SIGHUP handling for terminal cleanup.
  - Read schema metadata from XML to avoid hundreds of `gsettings` calls per page load.
  - Leave the release job unchanged.

## Next steps
- Run `/ak-cook plans/261108-0744-term-dashboard/plan.md`.
- Phase 1 must probe `@hono/node-ws` on Bun, Nx `continuous` targets and Monaco 0.57 worker paths.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
