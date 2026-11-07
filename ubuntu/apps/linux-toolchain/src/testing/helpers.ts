import {
  createLogger,
  RecordingRunner,
  type Context,
  type TextSink,
} from '@linux-toolchain/core';
import {
  catalog,
  type Choices,
  type Toolchain,
} from '@linux-toolchain/toolchains';
import type { InstallDeps } from '../cli/install';
import type { ProgramDeps } from '../cli/program';
import type { PromptChoice, PromptFns } from '../cli/prompts';

export class BufferSink implements TextSink {
  text = '';
  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}

export const testCtx: Context = {
  isRoot: false,
  user: 'dev',
  home: '/home/dev',
};

export interface PromptCall {
  kind: 'checkbox' | 'select' | 'confirm';
  message: string;
  choices?: PromptChoice[];
  default?: string | boolean;
}

/**
 * Scripted prompts: each message has a queue of answers, consumed in order.
 * A message without a queued answer gets the prompt's default (pre-checked
 * values, the select default, the confirm default).
 */
export class ScriptedPrompts implements PromptFns {
  readonly calls: PromptCall[] = [];
  private readonly answers = new Map<string, unknown[]>();

  answer(message: string, ...values: unknown[]): this {
    this.answers.set(message, [
      ...(this.answers.get(message) ?? []),
      ...values,
    ]);
    return this;
  }

  private next<T>(message: string, fallback: T): T {
    const queue = this.answers.get(message);
    return queue && queue.length > 0 ? (queue.shift() as T) : fallback;
  }

  async checkbox(config: Parameters<PromptFns['checkbox']>[0]) {
    this.calls.push({
      kind: 'checkbox',
      message: config.message,
      choices: config.choices,
    });
    const answer = this.next(
      config.message,
      config.choices.filter((c) => c.checked).map((c) => c.value),
    );
    const verdict = config.validate?.(answer.map((value) => ({ value })));
    if (typeof verdict === 'string') throw new Error(verdict);
    return answer;
  }

  async select(config: Parameters<PromptFns['select']>[0]) {
    this.calls.push({
      kind: 'select',
      message: config.message,
      choices: config.choices,
      default: config.default,
    });
    return this.next(
      config.message,
      config.default ?? (config.choices[0] as PromptChoice).value,
    );
  }

  async confirm(config: Parameters<PromptFns['confirm']>[0]) {
    this.calls.push({
      kind: 'confirm',
      message: config.message,
      default: config.default,
    });
    return this.next(config.message, config.default ?? false);
  }
}

export interface InstallCall {
  choices: Choices;
  yes: boolean;
}

/** Real catalog whose installers only record the choices (and `yes`) they were given. */
export function spyCatalog(): {
  catalog: Toolchain[];
  installed: Map<string, InstallCall>;
} {
  const installed = new Map<string, InstallCall>();
  return {
    installed,
    catalog: catalog.map((t) => ({
      ...t,
      install: async (ic, choices) => {
        installed.set(t.id, { choices, yes: ic.yes });
      },
    })),
  };
}

/** Deps with no real I/O: RecordingRunner, scripted prompts, apt present, no network. */
export function testDeps(overrides: Partial<ProgramDeps> = {}): ProgramDeps & {
  out: BufferSink;
  err: BufferSink;
  runner: RecordingRunner;
  prompts: ScriptedPrompts;
} {
  const out = new BufferSink();
  const err = new BufferSink();
  const runner = new RecordingRunner();
  const prompts = new ScriptedPrompts();
  const base: InstallDeps & { err: BufferSink } = {
    catalog,
    platform: 'linux',
    tty: false,
    prompts,
    out,
    err,
    logger: createLogger(out, err),
    resolveContext: () => testCtx,
    hasApt: () => true,
    hasCurl: () => true,
    createRunner: () => runner,
    fetch: async () => {
      throw new Error('offline');
    },
    exists: (path) => path === '/usr/bin/apt-get',
    listDir: () => [],
  };
  return { ...base, runner, prompts, out, err, ...overrides } as ReturnType<
    typeof testDeps
  >;
}
