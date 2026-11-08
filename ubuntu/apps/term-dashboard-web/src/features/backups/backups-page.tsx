import {
  API_PATHS,
  type BackupContent,
  type BackupRef,
  type BackupsView,
  type FileId,
  type GSettingsBackupRef,
  type GSettingsRestoreResult,
  type SavePreview,
  type SaveResult,
} from '@linux-toolchain/term-config';
import { EyeIcon, HistoryIcon, RotateCwIcon } from 'lucide-react';
import { useState } from 'react';
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
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { describeError, useApi, useResource } from '../../lib/api';
import { formatBackupTs, formatBytes } from '../../lib/format';
import { LazyCodeEditor } from '../monaco/lazy-editors';
import { PageBody, PageHeader } from '../page-header';
import { SaveReviewDialog } from '../save/save-review-dialog';
import { useSaveFlow } from '../save/use-save-flow';

/** Backups grouped by file id, newest first. */
export function groupBackups(files: BackupRef[]): [FileId, BackupRef[]][] {
  const groups = new Map<FileId, BackupRef[]>();
  for (const b of files) {
    const list = groups.get(b.fileId);
    if (list) list.push(b);
    else groups.set(b.fileId, [b]);
  }
  return [...groups.entries()]
    .map(([id, list]): [FileId, BackupRef[]] => [
      id,
      [...list].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)),
    ])
    .sort(([a], [b]) => a.localeCompare(b));
}

const languageOf = (id: FileId) =>
  id === 'ghostty' || id === 'ghostty-legacy' ? 'plaintext' : 'shell';

function ViewDialog({
  target,
  onClose,
}: {
  target: BackupRef | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {target
              ? `${target.fileId} backup, ${formatBackupTs(target.ts)}`
              : ''}
          </DialogTitle>
          <DialogDescription className="break-all">
            {target?.path}
          </DialogDescription>
        </DialogHeader>
        {target && <BackupViewer target={target} />}
      </DialogContent>
    </Dialog>
  );
}

function BackupViewer({ target }: { target: BackupRef }) {
  const content = useResource((api) =>
    api.get<BackupContent>(API_PATHS.backupFile(target.fileId, target.ts)),
  );
  if (content.status === 'loading') {
    return <StatePanel tone="loading" title="Reading the backup…" />;
  }
  if (content.status === 'error') {
    return (
      <StatePanel tone="error" title="Could not read the backup">
        {describeError(content.error, 'backups')}
      </StatePanel>
    );
  }
  return (
    <LazyCodeEditor
      value={content.data.content}
      readOnly
      language={languageOf(target.fileId)}
      height="60vh"
      ariaLabel={`Backup of ${target.fileId} (read only)`}
    />
  );
}

export function BackupsPage() {
  const api = useApi();
  const toast = useToast();
  const backups = useResource((a) => a.get<BackupsView>(API_PATHS.backups));
  const [viewing, setViewing] = useState<BackupRef | null>(null);
  const [gsTarget, setGsTarget] = useState<GSettingsBackupRef | null>(null);
  const flow = useSaveFlow();

  const restoreFile = (b: BackupRef) => {
    if (flow.previewing) return;
    void flow.start({
      title: `Restore ${b.fileId} from ${formatBackupTs(b.ts)}`,
      description:
        'The current file is backed up first, then replaced with this backup.',
      applyLabel: 'Restore',
      language: languageOf(b.fileId),
      preview: async () => ({
        previews: [
          await api.request<SavePreview>(
            'POST',
            API_PATHS.backupFileAction(b.fileId, b.ts, 'preview'),
          ),
        ],
      }),
      apply: async (previews) => {
        const result = await api.request<SaveResult>(
          'POST',
          API_PATHS.backupFileAction(b.fileId, b.ts, 'restore'),
          { baseMtimeMs: previews[0]?.baseMtimeMs ?? null },
        );
        toast({
          tone: 'success',
          title: `${b.fileId} restored`,
          description: result.backup
            ? `The replaced version is in ${result.backup.path}.`
            : undefined,
        });
        backups.reload();
      },
    });
  };

  const restoreGSettings = async (b: GSettingsBackupRef) => {
    try {
      const result = await api.request<GSettingsRestoreResult>(
        'POST',
        API_PATHS.gsettingsRestore(b.ts),
      );
      toast({
        tone: 'success',
        title: 'gsettings backup restored',
        description: `Restored: ${result.restored.join(', ') || 'nothing'}.`,
      });
    } catch (e) {
      toast({
        tone: 'error',
        title: 'Restore failed',
        description:
          e instanceof Error
            ? describeError(e, 'gsettings restore')
            : String(e),
      });
    }
  };

  return (
    <PageBody>
      <PageHeader
        title="Backups"
        description={
          backups.status === 'ready'
            ? `td copies a file here before every write: ${backups.data.dir}`
            : 'Copies td takes before every write.'
        }
        actions={
          <Button variant="outline" size="sm" onClick={backups.reload}>
            <RotateCwIcon aria-hidden />
            Refresh
          </Button>
        }
      />

      {backups.status === 'loading' && (
        <StatePanel tone="loading" title="Listing backups…" />
      )}
      {backups.status === 'error' && (
        <StatePanel tone="error" title="Could not list backups">
          {describeError(backups.error, 'backups')}
        </StatePanel>
      )}
      {backups.status === 'ready' && (
        <>
          <section aria-label="File backups" className="flex flex-col gap-3">
            <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Files
            </h2>
            {backups.data.files.length === 0 ? (
              <StatePanel tone="empty" title="No file backups yet">
                A backup appears here the first time td saves a file.
              </StatePanel>
            ) : (
              groupBackups(backups.data.files).map(([fileId, list]) => (
                <div key={fileId} className="rounded-lg border bg-card">
                  <h3 className="flex items-center gap-2 border-b px-4 py-2 font-mono text-sm font-semibold">
                    {fileId}
                    <Badge variant="muted">{list.length}</Badge>
                  </h3>
                  <ul className="flex flex-col divide-y">
                    {list.map((b) => (
                      <li
                        key={b.ts}
                        className="flex min-w-0 flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center"
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="font-mono text-sm">
                            {formatBackupTs(b.ts)}
                          </span>
                          <span className="break-all font-mono text-xs text-muted-foreground">
                            {b.ts} · {formatBytes(b.size)}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`View ${fileId} backup from ${formatBackupTs(b.ts)}`}
                            onClick={() => setViewing(b)}
                          >
                            <EyeIcon aria-hidden />
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-disabled={flow.previewing || undefined}
                            aria-label={`Restore ${fileId} from ${formatBackupTs(b.ts)}`}
                            onClick={() => restoreFile(b)}
                          >
                            <HistoryIcon aria-hidden />
                            Restore
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>

          <section
            aria-label="gsettings backups"
            className="flex flex-col gap-3"
          >
            <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
              gsettings (Ptyxis, GNOME Terminal)
            </h2>
            {backups.data.gsettings.length === 0 ? (
              <StatePanel tone="empty" title="No gsettings backups yet">
                td takes one before its first gsettings change in a run.
              </StatePanel>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border bg-card">
                {[...backups.data.gsettings]
                  .sort((a, b) => (a.ts < b.ts ? 1 : -1))
                  .map((b) => (
                    <li
                      key={b.ts}
                      className="flex min-w-0 flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="font-mono text-sm">
                          {formatBackupTs(b.ts)} · {b.kinds.join(', ')}
                        </span>
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {b.path}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Restore gsettings from ${formatBackupTs(b.ts)}`}
                        onClick={() => setGsTarget(b)}
                      >
                        <HistoryIcon aria-hidden />
                        Restore
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}

      <ViewDialog target={viewing} onClose={() => setViewing(null)} />
      <SaveReviewDialog {...flow.dialog} />
      <AlertDialog
        open={gsTarget !== null}
        onOpenChange={(o) => !o && setGsTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore gsettings from{' '}
              {gsTarget ? formatBackupTs(gsTarget.ts) : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Settings of {gsTarget?.kinds.join(', ')} go back to this backup,
              and profiles created after it are removed. gsettings has no file
              to diff, so there is no preview.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (gsTarget) void restoreGSettings(gsTarget);
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageBody>
  );
}
