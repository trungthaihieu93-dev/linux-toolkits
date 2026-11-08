import {
  API_PATHS,
  type BackupsView,
  type GSettingsBackupRef,
  type GSettingsRestoreResult,
  type NameList,
  type TerminalKind,
} from '@linux-toolchain/term-config';
import { HistoryIcon } from 'lucide-react';
import { useState } from 'react';
import { useInventory } from '../../app/shell-data';
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
import { Button } from '../../components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs';
import { useToast } from '../../components/ui/toast';
import { describeError, useApi, useResource } from '../../lib/api';
import { formatBackupTs } from '../../lib/format';
import { PageBody, PageHeader } from '../page-header';
import { GSettingsForm } from './gsettings-form';
import { describeGSettingsRestore } from './gsettings-restore';
import { ProfilesPanel } from './profiles-panel';

/** Newest gsettings backup that covers `kind` (backups list newest first or last). */
export function latestBackupFor(
  backups: GSettingsBackupRef[],
  kind: TerminalKind,
): GSettingsBackupRef | null {
  const matching = backups.filter((b) => b.kinds.includes(kind));
  if (matching.length === 0) return null;
  return matching.reduce((a, b) => (b.ts > a.ts ? b : a));
}

function RestoreBackupButton({
  kind,
  label,
  onRestored,
}: {
  kind: TerminalKind;
  label: string;
  onRestored: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [target, setTarget] = useState<GSettingsBackupRef | null>(null);
  const [looking, setLooking] = useState(false);

  const find = async () => {
    setLooking(true);
    try {
      const view = await api.get<BackupsView>(API_PATHS.backups);
      const latest = latestBackupFor(view.gsettings, kind);
      if (!latest) {
        toast({
          title: 'No gsettings backup yet',
          description: `td backs up ${label} settings before its first change in a run.`,
        });
      } else {
        setTarget(latest);
      }
    } catch (e) {
      toast({
        tone: 'error',
        title: 'Could not list backups',
        description:
          e instanceof Error ? describeError(e, 'backups') : String(e),
      });
    } finally {
      setLooking(false);
    }
  };

  const restore = async (ref: GSettingsBackupRef) => {
    try {
      const result = await api.request<GSettingsRestoreResult>(
        'POST',
        API_PATHS.gsettingsRestore(ref.ts),
      );
      toast({
        tone: 'success',
        title: 'gsettings backup restored',
        description: describeGSettingsRestore(result),
      });
      onRestored();
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
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void find()}
        disabled={looking}
      >
        <HistoryIcon aria-hidden />
        Restore backup
      </Button>
      <AlertDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore the gsettings backup from{' '}
              {target ? formatBackupTs(target.ts) : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every saved setting of {target?.kinds.join(', ')} goes back to how
              it was when td took this backup, and profiles created after it are
              removed. File: {target?.path}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (target) void restore(target);
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Palette names for the Ptyxis profile `palette` key; null when unavailable. */
function usePalettes(kind: TerminalKind): string[] | null | undefined {
  const palettes = useResource((api) =>
    kind === 'ptyxis'
      ? api.get<NameList>(API_PATHS.terminalPalettes(kind))
      : Promise.resolve(null),
  );
  if (kind !== 'ptyxis') return undefined;
  if (palettes.status === 'ready') return palettes.data?.names ?? null;
  return null;
}

/** Ptyxis and GNOME Terminal settings (one component keyed by `kind`). */
export function TerminalSettingsPage({ kind }: { kind: TerminalKind }) {
  const inventory = useInventory();
  const palettes = usePalettes(kind);
  // Bumped after a restore so every form reads the restored values.
  const [generation, setGeneration] = useState(0);
  const term =
    inventory.status === 'ready'
      ? inventory.data.terminals.find((t) => t.kind === kind)
      : undefined;
  const label =
    term?.label ?? (kind === 'ptyxis' ? 'Ptyxis' : 'GNOME Terminal');

  let body;
  if (inventory.status === 'loading') {
    body = <StatePanel tone="loading" title="Reading the inventory…" />;
  } else if (inventory.status === 'error') {
    body = (
      <StatePanel tone="error" title="Could not read the inventory">
        {describeError(inventory.error, 'the inventory')}
      </StatePanel>
    );
  } else if (!term || !term.schemas) {
    body = (
      <StatePanel tone="empty" title={`${label} is not installed`}>
        td edits {label} through its gsettings schemas, which are not installed
        on this machine.
      </StatePanel>
    );
  } else {
    const schemas = term.schemas;
    body = (
      <Tabs key={generation} defaultValue="general">
        <TabsList aria-label={`${label} settings`}>
          <TabsTrigger value="general">General</TabsTrigger>
          {schemas.shortcuts && (
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
          )}
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GSettingsForm
            path={API_PATHS.terminalGlobal(kind)}
            label={`${label} general settings`}
          />
        </TabsContent>
        {schemas.shortcuts && (
          <TabsContent value="shortcuts">
            <GSettingsForm
              path={API_PATHS.terminalShortcuts(kind)}
              label={`${label} shortcuts`}
            />
          </TabsContent>
        )}
        <TabsContent value="profiles">
          <ProfilesPanel kind={kind} schemas={schemas} palettes={palettes} />
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <PageBody>
      <PageHeader
        title={label}
        description={
          term?.installed
            ? `Version ${term.version ?? 'unknown'}. Changes apply to running terminals right away; td backs up these settings before its first change in a run.`
            : undefined
        }
        actions={
          term?.schemas ? (
            <RestoreBackupButton
              kind={kind}
              label={label}
              onRestored={() => setGeneration((g) => g + 1)}
            />
          ) : undefined
        }
      />
      {body}
    </PageBody>
  );
}
