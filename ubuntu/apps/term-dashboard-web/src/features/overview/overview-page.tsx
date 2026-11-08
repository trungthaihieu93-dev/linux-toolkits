import type {
  ConfigFileRef,
  GSettingsTerminalInfo,
  ShellInfo,
  TerminalInventory,
} from '@linux-toolchain/term-config';
import { ArrowRightIcon, RotateCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatePanel } from '../../components/state-panel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Link } from '../../app/router';
import { useInventory } from '../../app/shell-data';
import { describeError } from '../../lib/api';
import { formatBackupTs, formatClock, formatDuration } from '../../lib/format';
import { StatusBadge } from '../activity/activity-list';
import { useActivityCommands } from '../activity/activity-provider';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-28 shrink-0 font-mono text-xs uppercase tracking-wide text-muted-foreground sm:pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0 break-words font-mono text-sm">{children}</dd>
    </div>
  );
}

function Installed({ yes, label }: { yes: boolean; label?: string }) {
  return yes ? (
    <Badge variant="run">{label ?? 'installed'}</Badge>
  ) : (
    <Badge variant="muted">not installed</Badge>
  );
}

function Files({ files }: { files: ConfigFileRef[] }) {
  if (files.length === 0)
    return <span className="text-muted-foreground">none</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {files.map((f) => (
        <li key={f.id} className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 break-all">{f.path}</span>
          {!f.exists && (
            <span className="shrink-0 text-xs text-muted-foreground">
              (missing)
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function CardLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-md px-2 font-mono text-xs text-link transition-colors duration-150 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
    >
      {label}
      <ArrowRightIcon className="size-3.5" aria-hidden />
    </Link>
  );
}

function GhosttyCard({ inv }: { inv: TerminalInventory }) {
  const g = inv.ghostty;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <CardTitle>Ghostty</CardTitle>
        <Installed yes={g.installed} />
        {g.installed && <CardLink to="/ghostty" label="Configure" />}
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2">
          <Field label="Version">{g.version ?? '—'}</Field>
          <Field label="Config">
            <Files files={g.files} />
          </Field>
        </dl>
      </CardContent>
    </Card>
  );
}

const TERMINAL_PATH: Record<GSettingsTerminalInfo['kind'], string> = {
  ptyxis: '/ptyxis',
  'gnome-terminal': '/gnome-terminal',
};

function GSettingsCard({ term }: { term: GSettingsTerminalInfo }) {
  const ready = term.installed && term.schemas !== null;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <CardTitle>{term.label}</CardTitle>
        <Installed yes={term.installed} />
        {ready && <CardLink to={TERMINAL_PATH[term.kind]} label="Configure" />}
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2">
          <Field label="Version">{term.version ?? '—'}</Field>
          <Field label="Config">
            {term.schemas ? (
              <>
                gsettings {term.schemas.global.schema}
                {term.schemas.global.path ? `:${term.schemas.global.path}` : ''}
              </>
            ) : (
              <span className="text-muted-foreground">
                schemas not installed
              </span>
            )}
          </Field>
        </dl>
      </CardContent>
    </Card>
  );
}

function ShellCard({ shell }: { shell: ShellInfo }) {
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-2">
        <CardTitle>{shell.shell}</CardTitle>
        <Installed yes={shell.installed} />
        {shell.isLoginShell && <Badge variant="outline">login shell</Badge>}
        {shell.installed && (
          <CardLink to={`/shells/${shell.shell}`} label="Configure" />
        )}
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2">
          <Field label="Binary">{shell.binary ?? '—'}</Field>
          <Field label="Managed block">
            {shell.managedBlock ? (
              <span className="text-run">present</span>
            ) : (
              <span className="text-muted-foreground">not added yet</span>
            )}
          </Field>
          {shell.shell === 'zsh' && (
            <Field label="oh-my-zsh">{shell.ohMyZsh ? 'detected' : 'no'}</Field>
          )}
          <Field label="Last backup">
            {shell.lastBackup ? (
              formatBackupTs(shell.lastBackup)
            ) : (
              <span className="text-muted-foreground">none</span>
            )}
          </Field>
        </dl>
      </CardContent>
    </Card>
  );
}

function RecentActivity() {
  const commands = useActivityCommands();
  const recent = commands.slice(-10).reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      {recent.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No commands yet. Commands td runs show up here and in the activity
            panel.
          </p>
        </CardContent>
      ) : (
        <ul aria-label="Last 10 commands">
          {recent.map((cmd) => (
            <li
              key={cmd.id}
              className="flex min-h-10 items-center gap-3 border-b px-4 py-1.5 last:border-b-0"
            >
              <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]">
                {cmd.argv.join(' ')}
              </code>
              <StatusBadge cmd={cmd} />
              <span className="hidden w-16 text-right font-mono text-xs tabular-nums text-muted-foreground sm:inline">
                {cmd.durationMs !== null ? formatDuration(cmd.durationMs) : '…'}
              </span>
              <time
                dateTime={new Date(cmd.startedAt).toISOString()}
                className="font-mono text-xs tabular-nums text-muted-foreground"
              >
                {formatClock(cmd.startedAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function OverviewPage() {
  const inventory = useInventory();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-3 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-mono text-xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Terminals and shells td found on this machine
          {inventory.status === 'ready' ? ` (home ${inventory.data.home})` : ''}
          .
        </p>
      </div>

      {inventory.status === 'loading' && (
        <StatePanel tone="loading" title="Reading the inventory…" />
      )}
      {inventory.status === 'error' && (
        <StatePanel
          tone="error"
          title="Could not read the inventory"
          action={
            <Button variant="outline" size="sm" onClick={inventory.reload}>
              <RotateCwIcon aria-hidden />
              Retry
            </Button>
          }
        >
          {describeError(inventory.error, 'the terminal and shell inventory')}
        </StatePanel>
      )}
      {inventory.status === 'ready' && (
        <>
          <Section title="Terminals">
            <div className="grid gap-3 lg:grid-cols-2">
              <GhosttyCard inv={inventory.data} />
              {inventory.data.terminals
                .filter((t) => t.kind === 'ptyxis' || t.installed)
                .map((t) => (
                  <GSettingsCard key={t.kind} term={t} />
                ))}
            </div>
          </Section>
          <Section title="Shells">
            <p className="-mt-1 text-sm text-muted-foreground">
              Login shell:{' '}
              <code className="font-mono text-foreground">
                {inventory.data.loginShell ?? 'unknown'}
              </code>
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              {inventory.data.shells.map((s) => (
                <ShellCard key={s.shell} shell={s} />
              ))}
            </div>
          </Section>
        </>
      )}

      <Section title="Activity">
        <RecentActivity />
      </Section>
    </div>
  );
}
