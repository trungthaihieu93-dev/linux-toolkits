import { readdir, readFile, readlink } from 'node:fs/promises';

/**
 * Read-only `/proc` probes for the PTY: find the shell `script` started, its
 * tty, and every process of a session. No processes are spawned, so they
 * also work while td shuts down on a signal.
 */

export interface ProcStat {
  pid: number;
  ppid: number;
  pgrp: number;
  session: number;
}

/** Parse `/proc/<pid>/stat` (the command name may contain spaces and parentheses). */
export function parseProcStat(text: string): ProcStat | null {
  const close = text.lastIndexOf(')');
  if (close === -1) return null;
  const pid = Number(text.slice(0, text.indexOf(' ')));
  const fields = text
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  const [ppid, pgrp, session] = [fields[1], fields[2], fields[3]].map(Number);
  if (![pid, ppid, pgrp, session].every(Number.isInteger)) return null;
  return { pid, ppid, pgrp, session };
}

export async function procStat(pid: number | 'self'): Promise<ProcStat | null> {
  try {
    return parseProcStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return null;
  }
}

/** Pids of every live process whose session id is `sid`. */
export async function sessionPids(sid: number): Promise<number[]> {
  const out: number[] = [];
  let names: string[];
  try {
    names = await readdir('/proc');
  } catch {
    return out;
  }
  await Promise.all(
    names
      .filter((n) => /^\d+$/.test(n))
      .map(async (n) => {
        const st = await procStat(Number(n));
        if (st && st.session === sid) out.push(st.pid);
      }),
  );
  return out;
}

/** Children of `pid` (from every thread's `children` file). */
export async function childPids(pid: number): Promise<number[]> {
  const out = new Set<number>();
  let tasks: string[];
  try {
    tasks = await readdir(`/proc/${pid}/task`);
  } catch {
    return [];
  }
  for (const task of tasks) {
    try {
      const text = await readFile(`/proc/${pid}/task/${task}/children`, 'utf8');
      for (const c of text.trim().split(/\s+/))
        if (/^\d+$/.test(c)) out.add(Number(c));
    } catch {
      // The thread exited.
    }
  }
  return [...out];
}

/** The tty on fd 0 of `pid` (`/dev/pts/N`), or null. */
export async function ttyOf(pid: number): Promise<string | null> {
  try {
    const target = await readlink(`/proc/${pid}/fd/0`);
    return /^\/dev\/pts\/\d+$/.test(target) ? target : null;
  } catch {
    return null;
  }
}

/** Send `signal` to every process of session `sid`; returns how many were signalled. */
export async function signalSession(
  sid: number,
  signal: NodeJS.Signals,
): Promise<number> {
  const own = await procStat('self');
  // sid 0/1 or td's own session would hit unrelated processes.
  if (sid <= 1 || sid === own?.session) return 0;
  let count = 0;
  for (const pid of await sessionPids(sid)) {
    try {
      process.kill(pid, signal);
      count++;
    } catch {
      // Already gone.
    }
  }
  return count;
}
