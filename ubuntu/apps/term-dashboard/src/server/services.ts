import { userInfo } from 'node:os';
import { createActivityBus, type ActivityBus } from '../exec/activity-bus';
import {
  ProcessCommandRunner,
  type CommandRunner,
} from '../exec/command-runner';
import { FileStore } from '../files/file-store';
import { GhosttyService } from '../ghostty/ghostty-service';
import { GSettingsService } from '../gsettings/gsettings-service';
import { PtyManager } from '../pty/pty-manager';
import { SettingsStore } from '../settings/settings-store';
import { ShellService } from '../shell/shell-service';
import { resolveDirs, type Dirs, type Env } from '../system/environment';

/** Everything the API routes use. */
export interface Services {
  env: Env;
  dirs: Dirs;
  bus: ActivityBus;
  runner: CommandRunner;
  files: FileStore;
  settings: SettingsStore;
  shells: ShellService;
  gsettings: GSettingsService;
  ghostty: GhosttyService;
  pty: PtyManager;
  /** Login shell from the passwd database (NSS), or null. */
  loginShell: () => string | null;
  /** Ends every PTY session. */
  close(): Promise<void>;
}

export interface ServicesOptions {
  env: Env;
  home: string;
  bus?: ActivityBus;
  runner?: CommandRunner;
  loginShell?: () => string | null;
}

export function passwdShell(): string | null {
  try {
    const shell = userInfo().shell;
    return shell && shell.startsWith('/') ? shell : null;
  } catch {
    return null;
  }
}

export function createServices(opts: ServicesOptions): Services {
  const env = opts.env;
  const dirs = resolveDirs(env, opts.home);
  const bus = opts.bus ?? createActivityBus();
  const runner = opts.runner ?? new ProcessCommandRunner(bus, env);
  const files = new FileStore(dirs, runner);
  const settings = new SettingsStore(dirs.configHome);
  const loginShell = opts.loginShell ?? passwdShell;
  const pty = new PtyManager({
    runner,
    env,
    home: dirs.home,
    shell: async () =>
      (await settings.read()).terminalShell ??
      loginShell() ??
      (env['SHELL']?.startsWith('/') ? env['SHELL'] : '/bin/sh'),
  });
  return {
    env,
    dirs,
    bus,
    runner,
    files,
    settings,
    shells: new ShellService(files, env, dirs.home),
    gsettings: new GSettingsService(runner, files, dirs, env),
    ghostty: new GhosttyService(runner, files),
    pty,
    loginShell,
    close: () => pty.closeAll(),
  };
}
