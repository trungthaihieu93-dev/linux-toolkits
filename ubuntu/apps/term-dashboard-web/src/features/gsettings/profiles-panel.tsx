import {
  API_PATHS,
  formatGVariant,
  type GSettingsTerminalSchemas,
  type ProfileCreated,
  type TerminalKind,
  type TerminalProfileSummary,
  type TerminalProfilesView,
} from '@linux-toolchain/term-config';
import {
  CopyIcon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { StatePanel } from '../../components/state-panel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { describeError, useApi, useResource } from '../../lib/api';
import { cn } from '../../lib/utils';
import { GSettingsForm } from './gsettings-form';

const MAX_LABEL = 256;

function NameDialog({
  open,
  title,
  description,
  initial,
  submitLabel,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  initial: string;
  submitLabel: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  const trimmed = name.trim();
  const invalid =
    trimmed === '' || trimmed.length > MAX_LABEL || /[\n\r\t]/.test(name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch {
      // The caller reported the failure; keep the dialog open to retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 font-mono text-sm">
            Profile name
            <Input
              value={name}
              maxLength={MAX_LABEL}
              aria-invalid={(name !== '' && invalid) || undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || invalid}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Dialogs =
  | { type: 'create' }
  | { type: 'rename'; profile: TerminalProfileSummary }
  | { type: 'delete'; profile: TerminalProfileSummary }
  | null;

/**
 * Profiles of a gsettings terminal: list with the default marker, create,
 * duplicate, rename, set default, delete (never the default), and the
 * selected profile's settings.
 */
export function ProfilesPanel({
  kind,
  schemas,
  palettes,
}: {
  kind: TerminalKind;
  schemas: GSettingsTerminalSchemas;
  palettes?: string[] | null;
}) {
  const api = useApi();
  const toast = useToast();
  const profiles = useResource((a) =>
    a.get<TerminalProfilesView>(API_PATHS.terminalProfiles(kind)),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);

  const view = profiles.status === 'ready' ? profiles.data : null;
  const current =
    view?.profiles.find((p) => p.uuid === selected) ??
    view?.profiles.find((p) => p.isDefault) ??
    view?.profiles[0] ??
    null;

  // Buttons stay focusable while a change runs (aria-disabled); this guard
  // ignores clicks until it finishes.
  const running = useRef(false);
  const run = async (what: string, action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
      profiles.reload();
    } catch (e) {
      toast({
        tone: 'error',
        title: `Could not ${what}`,
        description:
          e instanceof Error ? describeError(e, 'profiles') : String(e),
      });
      throw e;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const create = (label: string) =>
    run('create the profile', async () => {
      const { uuid } = await api.request<ProfileCreated>(
        'POST',
        API_PATHS.terminalProfiles(kind),
        { label },
      );
      setSelected(uuid);
      toast({ tone: 'success', title: `Profile “${label}” created` });
    });

  const rename = (p: TerminalProfileSummary, label: string) =>
    run('rename the profile', async () => {
      await api.request('PUT', API_PATHS.terminalProfile(kind, p.uuid), {
        key: schemas.labelKey,
        value: formatGVariant(label, 's'),
      });
      toast({ tone: 'success', title: `Renamed to “${label}”` });
    });

  const duplicate = (p: TerminalProfileSummary) =>
    run('duplicate the profile', async () => {
      const { uuid } = await api.request<ProfileCreated>(
        'POST',
        API_PATHS.terminalProfileDuplicate(kind, p.uuid),
        {},
      );
      setSelected(uuid);
      toast({ tone: 'success', title: `Duplicated “${p.label}”` });
    }).catch(() => undefined);

  const makeDefault = (p: TerminalProfileSummary) =>
    run('set the default profile', async () => {
      await api.request('PUT', API_PATHS.terminalProfileDefault(kind, p.uuid));
      toast({ tone: 'success', title: `“${p.label}” is now the default` });
    }).catch(() => undefined);

  const remove = (p: TerminalProfileSummary) =>
    run('delete the profile', async () => {
      await api.request('DELETE', API_PATHS.terminalProfile(kind, p.uuid));
      if (selected === p.uuid) setSelected(null);
      toast({ tone: 'success', title: `Profile “${p.label}” deleted` });
    }).catch(() => undefined);

  if (profiles.status === 'loading') {
    return <StatePanel tone="loading" title="Reading profiles…" />;
  }
  if (profiles.status === 'error') {
    return (
      <StatePanel
        tone="error"
        title="Could not read the profiles"
        action={
          <Button variant="outline" size="sm" onClick={profiles.reload}>
            <RotateCwIcon aria-hidden />
            Retry
          </Button>
        }
      >
        {describeError(profiles.error, 'profiles')}
      </StatePanel>
    );
  }

  const list = profiles.data.profiles;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-sm font-medium">
          {list.length} profile{list.length === 1 ? '' : 's'}
        </h2>
        <Button
          size="sm"
          onClick={() => setDialog({ type: 'create' })}
          aria-disabled={busy || undefined}
        >
          <PlusIcon aria-hidden />
          New profile
        </Button>
      </div>

      {list.length === 0 ? (
        <StatePanel tone="empty" title="No profiles yet">
          Create one; it becomes available in the terminal right away.
        </StatePanel>
      ) : (
        <ul
          aria-label="Profiles"
          className="flex flex-col divide-y rounded-md border"
        >
          {list.map((p) => {
            const isCurrent = current?.uuid === p.uuid;
            return (
              <li
                key={p.uuid}
                className={cn(
                  'flex min-w-0 flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center',
                  isCurrent && 'bg-accent/60',
                )}
              >
                <button
                  type="button"
                  aria-pressed={isCurrent}
                  onClick={() => setSelected(p.uuid)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left font-mono text-sm focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0 truncate">
                    {p.label || '(unnamed)'}
                  </span>
                  {p.isDefault && <Badge variant="run">default</Badge>}
                  <span className="sr-only">
                    {isCurrent
                      ? '(showing its settings)'
                      : '(show its settings)'}
                  </span>
                </button>
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-disabled={busy || undefined}
                    aria-label={`Rename ${p.label}`}
                    onClick={() => setDialog({ type: 'rename', profile: p })}
                  >
                    <PencilIcon aria-hidden />
                    <span className="hidden md:inline">Rename</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-disabled={busy || undefined}
                    aria-label={`Duplicate ${p.label}`}
                    onClick={() => void duplicate(p)}
                  >
                    <CopyIcon aria-hidden />
                    <span className="hidden md:inline">Duplicate</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={p.isDefault}
                    aria-disabled={busy || undefined}
                    aria-label={`Set ${p.label} as default`}
                    onClick={() => void makeDefault(p)}
                  >
                    <StarIcon aria-hidden />
                    <span className="hidden md:inline">Set default</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={p.isDefault}
                    aria-disabled={busy || undefined}
                    title={
                      p.isDefault
                        ? 'The default profile cannot be deleted'
                        : undefined
                    }
                    aria-label={`Delete ${p.label}`}
                    className="text-destructive"
                    onClick={() => setDialog({ type: 'delete', profile: p })}
                  >
                    <Trash2Icon aria-hidden />
                    <span className="hidden md:inline">Delete</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {current && (
        <section
          aria-label={`Settings of ${current.label}`}
          className="flex min-w-0 flex-col gap-2"
        >
          <h2 className="font-mono text-sm font-medium">
            Settings of “{current.label || '(unnamed)'}”
          </h2>
          <GSettingsForm
            key={current.uuid}
            path={API_PATHS.terminalProfile(kind, current.uuid)}
            label={`${current.label} profile settings`}
            palettes={palettes}
            onWritten={(key) => key === schemas.labelKey && profiles.reload()}
          />
        </section>
      )}

      <NameDialog
        open={dialog?.type === 'create'}
        title="New profile"
        description="The profile starts with the default settings."
        initial=""
        submitLabel="Create"
        onOpenChange={(o) => !o && setDialog(null)}
        onSubmit={create}
      />
      <NameDialog
        open={dialog?.type === 'rename'}
        title="Rename profile"
        description={`Current name: ${dialog?.type === 'rename' ? dialog.profile.label : ''}`}
        initial={dialog?.type === 'rename' ? dialog.profile.label : ''}
        submitLabel="Rename"
        onOpenChange={(o) => !o && setDialog(null)}
        onSubmit={(label) =>
          dialog?.type === 'rename'
            ? rename(dialog.profile, label)
            : Promise.resolve()
        }
      />
      <AlertDialog
        open={dialog?.type === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete profile “
              {dialog?.type === 'delete' ? dialog.profile.label : ''}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its settings are reset and it is removed from the profile list.
              The gsettings backup taken before td's first change of this run
              can bring it back (Restore backup).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (dialog?.type === 'delete') void remove(dialog.profile);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
