import type {
  OhMyZshCatalog,
  OutsideLine,
  ShellBlockModel,
  ShellFileView,
  ShellHistory,
} from '@linux-toolchain/term-config';
import { FileCodeIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { SchemaField } from '../schema-form/schema-field';
import type { FieldDescriptor, FieldValue } from '../schema-form/types';

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const HISTORY_COUNT = /^\d{0,9}$/;

const validateCount = (v: FieldValue) =>
  HISTORY_COUNT.test(String(v)) ? null : 'Use a whole number, or leave empty.';

/** `plugins=(git docker)` → ['git', 'docker'] (outside-block line). */
export function parsePluginsLine(text: string): string[] | null {
  const m = /plugins=\(([^)]*)\)/.exec(text);
  if (!m) return null;
  return m[1]
    .split(/\s+/)
    .map((p) => p.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/** `ZSH_THEME="robbyrussell"` → 'robbyrussell' (outside-block line). */
export function parseThemeLine(text: string): string | null {
  const m = /ZSH_THEME=(?:"([^"]*)"|'([^']*)'|(\S*))/.exec(text);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function lastOutside(outside: OutsideLine[], kind: OutsideLine['kind']) {
  return outside.filter((o) => o.kind === kind).at(-1) ?? null;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col rounded-lg border bg-card px-4 py-3"
    >
      <h2 className="font-mono text-sm font-semibold">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="flex min-w-0 flex-col divide-y">{children}</div>
    </section>
  );
}

const FIELDS = {
  aliases: {
    id: 'aliases',
    label: 'Aliases',
    kind: 'pairs',
    partLabels: ['Name', 'Command'],
  },
  exports: {
    id: 'exports',
    label: 'Variables',
    kind: 'pairs',
    partLabels: ['Name', 'Value'],
  },
  prepend: {
    id: 'path-prepend',
    label: 'Before $PATH',
    kind: 'list',
    placeholder: '~/.local/bin',
    summary: 'Searched first. Entries starting with ~/ expand to $HOME.',
  },
  append: {
    id: 'path-append',
    label: 'After $PATH',
    kind: 'list',
    placeholder: '/opt/tools/bin',
    summary: 'Searched last.',
  },
} satisfies Record<string, FieldDescriptor>;

function historyFields(shell: ShellFileView['shell']): FieldDescriptor[] {
  const bash = shell === 'bash';
  return [
    {
      id: 'size',
      label: 'History size',
      kind: 'text',
      placeholder: 'not set',
      summary: 'Commands kept in memory (HISTSIZE).',
      validate: validateCount,
    },
    {
      id: 'fileSize',
      label: 'History file size',
      kind: 'text',
      placeholder: 'not set',
      summary: bash
        ? 'Lines kept in the history file (HISTFILESIZE).'
        : 'Commands saved to the history file (SAVEHIST).',
      validate: validateCount,
    },
    {
      id: 'ignoreDups',
      label: 'Ignore duplicates',
      kind: 'bool',
      summary: bash ? 'HISTCONTROL=ignoredups' : 'setopt HIST_IGNORE_DUPS',
    },
    {
      id: 'share',
      label: bash
        ? 'Append to the history file'
        : 'Share history between sessions',
      kind: 'bool',
      summary: bash ? 'shopt -s histappend' : 'setopt SHARE_HISTORY',
    },
  ];
}

function historyValue(h: ShellHistory, id: string): FieldValue {
  if (id === 'size' || id === 'fileSize') {
    const n = h[id];
    return n === undefined ? '' : String(n);
  }
  return h[id as 'ignoreDups' | 'share'] === true;
}

function withHistory(h: ShellHistory, id: string, v: FieldValue): ShellHistory {
  const next = { ...h };
  if (id === 'size' || id === 'fileSize') {
    const text = String(v).trim();
    if (text === '') delete next[id];
    else if (HISTORY_COUNT.test(text)) next[id] = Number(text);
  } else {
    next[id as 'ignoreDups' | 'share'] = v === true;
  }
  return next;
}

function revertHistory(
  h: ShellHistory,
  saved: ShellHistory,
  id: string,
): ShellHistory {
  const next = { ...h };
  const key = id as keyof ShellHistory;
  if (saved[key] === undefined) delete next[key];
  else (next as Record<string, unknown>)[key] = saved[key];
  return next;
}

export interface ShellConfigFormProps {
  view: ShellFileView;
  saved: ShellBlockModel;
  model: ShellBlockModel;
  onChange: (model: ShellBlockModel) => void;
  catalog: OhMyZshCatalog | null;
  onEditAtLine: (line: number) => void;
}

/**
 * Config mode: the parts of the managed blocks as form sections, plus the
 * read-only list of related lines outside the blocks.
 */
export function ShellConfigForm({
  view,
  saved,
  model,
  onChange,
  catalog,
  onEditAtLine,
}: ShellConfigFormProps) {
  const set = (patch: Partial<ShellBlockModel>) =>
    onChange({ ...model, ...patch });
  const omz = view.ohMyZsh;
  const outsideTheme = lastOutside(view.outside, 'zsh-theme');
  const outsidePlugins = lastOutside(view.outside, 'plugins');
  const themeValue =
    model.ohMyZsh?.theme ??
    (outsideTheme ? (parseThemeLine(outsideTheme.text) ?? '') : '');
  const pluginValue =
    model.ohMyZsh?.plugins ??
    (outsidePlugins ? (parsePluginsLine(outsidePlugins.text) ?? []) : []);
  const omzDisabled = !omz?.editable;

  const aliases: [string, string][] = model.aliases.map((a) => [
    a.name,
    a.command,
  ]);
  const exports: [string, string][] = model.exports.map((e) => [
    e.name,
    e.value,
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Section
        title="Aliases"
        description="Written to the term-dashboard block of this file."
      >
        <SchemaField
          field={FIELDS.aliases}
          value={aliases}
          modified={!same(model.aliases, saved.aliases)}
          onReset={() => set({ aliases: saved.aliases })}
          onChange={(v) =>
            set({
              aliases: (v as [string, string][]).map(([name, command]) => ({
                name,
                command,
              })),
            })
          }
        />
      </Section>

      <Section
        title="Environment"
        description="Exported variables (export NAME=value)."
      >
        <SchemaField
          field={FIELDS.exports}
          value={exports}
          modified={!same(model.exports, saved.exports)}
          onReset={() => set({ exports: saved.exports })}
          onChange={(v) =>
            set({
              exports: (v as [string, string][]).map(([name, value]) => ({
                name,
                value,
              })),
            })
          }
        />
      </Section>

      <Section title="PATH">
        <SchemaField
          field={FIELDS.prepend}
          value={model.path.prepend}
          modified={!same(model.path.prepend, saved.path.prepend)}
          onReset={() =>
            set({ path: { ...model.path, prepend: saved.path.prepend } })
          }
          onChange={(v) =>
            set({ path: { ...model.path, prepend: v as string[] } })
          }
        />
        <SchemaField
          field={FIELDS.append}
          value={model.path.append}
          modified={!same(model.path.append, saved.path.append)}
          onReset={() =>
            set({ path: { ...model.path, append: saved.path.append } })
          }
          onChange={(v) =>
            set({ path: { ...model.path, append: v as string[] } })
          }
        />
      </Section>

      <Section title="History">
        {historyFields(view.shell).map((f) => (
          <SchemaField
            key={f.id}
            field={f}
            value={historyValue(model.history, f.id)}
            modified={
              model.history[f.id as keyof ShellHistory] !==
              saved.history[f.id as keyof ShellHistory]
            }
            onReset={() =>
              set({
                history: revertHistory(model.history, saved.history, f.id),
              })
            }
            onChange={(v) =>
              set({ history: withHistory(model.history, f.id, v) })
            }
          />
        ))}
      </Section>

      {view.shell === 'zsh' && (
        <Section
          title="oh-my-zsh"
          description={
            omz?.detected
              ? omzDisabled
                ? (omz.disabledReason ??
                  'Theme and plugins cannot be edited in this file.')
                : `Written to a second block right above the source line (line ${omz.sourceLine}), so it takes effect.`
              : 'This file does not source oh-my-zsh.'
          }
        >
          {omz?.detected && (
            <>
              <SchemaField
                field={{
                  id: 'omz-theme',
                  label: 'Theme',
                  kind: 'theme',
                  options: catalog?.themes ?? [],
                  allowCustom: true,
                  summary: outsideTheme
                    ? `Set outside td on line ${outsideTheme.line}; the block overrides it.`
                    : undefined,
                }}
                value={themeValue}
                disabled={omzDisabled}
                modified={model.ohMyZsh?.theme !== saved.ohMyZsh?.theme}
                onReset={() =>
                  set({
                    ohMyZsh: { ...model.ohMyZsh, theme: saved.ohMyZsh?.theme },
                  })
                }
                onChange={(v) =>
                  set({ ohMyZsh: { ...model.ohMyZsh, theme: String(v) } })
                }
              />
              <SchemaField
                field={{
                  id: 'omz-plugins',
                  label: 'Plugins',
                  kind: 'multi',
                  options: catalog?.plugins ?? [],
                  summary: outsidePlugins
                    ? `plugins=(…) is also set outside td on line ${outsidePlugins.line}; the block overrides it.`
                    : undefined,
                }}
                value={pluginValue}
                disabled={omzDisabled}
                modified={
                  !same(
                    model.ohMyZsh?.plugins ?? null,
                    saved.ohMyZsh?.plugins ?? null,
                  )
                }
                onReset={() =>
                  set({
                    ohMyZsh: {
                      ...model.ohMyZsh,
                      plugins: saved.ohMyZsh?.plugins,
                    },
                  })
                }
                onChange={(v) =>
                  set({ ohMyZsh: { ...model.ohMyZsh, plugins: v as string[] } })
                }
              />
            </>
          )}
        </Section>
      )}

      <Section
        title="Defined outside td"
        description="Lines outside the managed blocks that set the same things. td never edits them; change them in Monaco mode."
      >
        {view.outside.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">None found.</p>
        ) : (
          <ul className="flex min-w-0 flex-col divide-y">
            {view.outside.map((o) => (
              <li
                key={`${o.line}:${o.kind}`}
                className="flex min-w-0 flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="w-24 shrink-0 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  L{o.line} · {o.kind}
                </span>
                <code className="min-w-0 flex-1 break-all font-mono text-sm">
                  {o.text}
                </code>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto w-fit px-0"
                  onClick={() => onEditAtLine(o.line)}
                >
                  <FileCodeIcon aria-hidden />
                  Edit in Monaco at line {o.line}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
