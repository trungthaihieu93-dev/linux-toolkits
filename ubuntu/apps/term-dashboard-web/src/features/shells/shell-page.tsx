import {
  API_PATHS,
  CONFIG_MODE_FILE_IDS,
  emptyShellModel,
  SHELL_FILE_IDS,
  validateShellModel,
  type FileId,
  type OhMyZshCatalog,
  type SavePreview,
  type SaveResult,
  type ShellBlockModel,
  type ShellFileView,
  type ShellName,
} from '@linux-toolchain/term-config';
import { RotateCwIcon, TriangleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useInventory } from '../../app/shell-data';
import { StatePanel } from '../../components/state-panel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useToast } from '../../components/ui/toast';
import { describeError, useApi, useResource } from '../../lib/api';
import { LazyCodeEditor } from '../monaco/lazy-editors';
import { PageBody, PageHeader } from '../page-header';
import { SaveBar } from '../save/save-bar';
import { SaveReviewDialog } from '../save/save-review-dialog';
import { useUnsavedChangesGuard } from '../save/unsaved-changes';
import { useSaveFlow } from '../save/use-save-flow';
import {
  INVALID_FIELDS_REASON,
  useInvalidFields,
} from '../schema-form/use-invalid-fields';
import { ShellConfigForm } from './shell-config-form';

export type ShellMode = 'config' | 'monaco';

const FILE_NAMES: Record<FileId, string> = {
  bashrc: '.bashrc',
  bash_profile: '.bash_profile',
  bash_aliases: '.bash_aliases',
  profile: '.profile',
  zshrc: '.zshrc',
  zshenv: '.zshenv',
  zprofile: '.zprofile',
  ghostty: 'config.ghostty',
  'ghostty-legacy': 'config',
};

/** Drop an oh-my-zsh part that sets nothing, so it compares equal to "absent". */
export function normalizeModel(model: ShellBlockModel): ShellBlockModel {
  const omz = model.ohMyZsh;
  if (!omz) return model;
  const clean = {
    ...(omz.theme !== undefined ? { theme: omz.theme } : {}),
    ...(omz.plugins !== undefined ? { plugins: omz.plugins } : {}),
    ...(omz.extra?.length ? { extra: omz.extra } : {}),
  };
  const next = { ...model };
  if (Object.keys(clean).length === 0) delete next.ohMyZsh;
  else next.ohMyZsh = clean;
  return next;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; view: ShellFileView }
  | { status: 'error'; error: Error };

function useShellFile(shell: ShellName, fileId: FileId) {
  const api = useApi();
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState((s) =>
      s.status === 'ready' && s.view.fileId === fileId
        ? s
        : { status: 'loading' },
    );
    api.get<ShellFileView>(API_PATHS.shellFile(shell, fileId)).then(
      (view) => active && setState({ status: 'ready', view }),
      (error: unknown) =>
        active &&
        setState({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        }),
    );
    return () => {
      active = false;
    };
  }, [api, shell, fileId, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}

/** bash and zsh files: Config mode (managed blocks) and Monaco mode (whole file). */
export function ShellPage({ shell }: { shell: ShellName }) {
  const api = useApi();
  const toast = useToast();
  const inventory = useInventory();
  const info =
    inventory.status === 'ready'
      ? inventory.data.shells.find((s) => s.shell === shell)
      : undefined;

  const [fileId, setFileId] = useState<FileId>(SHELL_FILE_IDS[shell][0]);
  const [mode, setMode] = useState<ShellMode>('config');
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | null>(
    null,
  );
  const { state, reload } = useShellFile(shell, fileId);
  const view = state.status === 'ready' ? state.view : null;

  const [model, setModel] = useState<ShellBlockModel | null>(null);
  const [raw, setRaw] = useState<string>('');

  // A freshly loaded file resets both drafts.
  useEffect(() => {
    if (!view) return;
    setModel(view.model ? normalizeModel(view.model) : null);
    setRaw(view.content);
  }, [view]);

  const catalog = useResource((a) =>
    shell === 'zsh'
      ? a.get<OhMyZshCatalog>(API_PATHS.ohMyZsh(shell))
      : Promise.resolve(null),
  );

  const configCapable = CONFIG_MODE_FILE_IDS.includes(fileId);
  const effectiveMode: ShellMode =
    configCapable && view?.model ? mode : 'monaco';
  const saved = view?.model ? normalizeModel(view.model) : emptyShellModel();
  const configDirty = Boolean(view && model && !same(model, saved));
  const rawDirty = Boolean(view && raw !== view.content);
  const dirty = effectiveMode === 'config' ? configDirty : rawDirty;
  const guard = useUnsavedChangesGuard(dirty);
  const flow = useSaveFlow();

  const resetDrafts = () => {
    if (!view) return;
    setModel(view.model ? normalizeModel(view.model) : null);
    setRaw(view.content);
  };

  const switchMode = (next: ShellMode) => {
    if (next === effectiveMode) return;
    guard.confirmDiscard(() => {
      resetDrafts();
      setMode(next);
    });
  };

  const switchFile = (next: FileId) => {
    if (next === fileId) return;
    guard.confirmDiscard(() => {
      setFileId(next);
      setReveal(null);
    });
  };

  const editAtLine = (line: number) =>
    guard.confirmDiscard(() => {
      resetDrafts();
      setMode('monaco');
      setReveal({ line, nonce: Date.now() });
    });

  const problems =
    model && effectiveMode === 'config' ? validateShellModel(model, shell) : [];
  // Fields report invalid text only while Config mode shows them.
  const { invalid, onValidityChange } = useInvalidFields();
  const blocked = problems.length > 0 || invalid.size > 0;

  const afterSave = (result: SaveResult) => {
    toast({
      tone: 'success',
      title: `${FILE_NAMES[result.fileId]} saved`,
      description: result.backup
        ? `Backup: ${result.backup.path}. Open a new shell to load it.`
        : 'Open a new shell to load it.',
    });
    reload();
  };

  const review = () => {
    if (!view) return;
    const base = { fileId, baseMtimeMs: view.mtimeMs };
    if (effectiveMode === 'config' && model) {
      const body = { ...base, model };
      void flow.start({
        title: `Save ${FILE_NAMES[fileId]} (Config mode)`,
        description:
          'Only the term-dashboard blocks change. Review the diff before applying.',
        preview: async () => ({
          previews: [
            await api.request<SavePreview>(
              'POST',
              API_PATHS.shellConfig(shell, 'preview'),
              body,
            ),
          ],
        }),
        apply: async () =>
          afterSave(
            await api.request<SaveResult>(
              'POST',
              API_PATHS.shellConfig(shell, 'save'),
              body,
            ),
          ),
      });
    } else {
      const body = { ...base, content: raw };
      void flow.start({
        title: `Save ${FILE_NAMES[fileId]}`,
        preview: async () => ({
          previews: [
            await api.request<SavePreview>(
              'POST',
              API_PATHS.shellRaw(shell, 'preview'),
              body,
            ),
          ],
        }),
        apply: async () =>
          afterSave(
            await api.request<SaveResult>(
              'POST',
              API_PATHS.shellRaw(shell, 'save'),
              body,
            ),
          ),
      });
    }
  };

  if (inventory.status === 'ready' && !info?.installed) {
    return (
      <PageBody>
        <PageHeader title={shell} />
        <StatePanel tone="empty" title={`${shell} is not installed`}>
          td did not find {shell} on PATH.
        </StatePanel>
      </PageBody>
    );
  }

  const fileRef = info?.files.find((f) => f.id === fileId);

  return (
    <PageBody>
      <PageHeader
        title={shell}
        description={
          <>
            {fileRef?.path ?? FILE_NAMES[fileId]}
            {view && !view.exists && ' (does not exist yet; saving creates it)'}
            {info?.isLoginShell && (
              <Badge variant="run" className="ml-2 align-middle">
                login shell
              </Badge>
            )}
          </>
        }
      />

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={fileId} onValueChange={(v) => switchFile(v as FileId)}>
          <SelectTrigger aria-label="File" className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHELL_FILE_IDS[shell].map((id) => (
              <SelectItem key={id} value={id}>
                {FILE_NAMES[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Manual activation: focus returning to a tab after the discard
            prompt must not switch modes (and prompt) again. */}
        <Tabs
          value={effectiveMode}
          onValueChange={(v) => switchMode(v as ShellMode)}
          activationMode="manual"
        >
          <TabsList aria-label="Editing mode">
            <TabsTrigger
              value="config"
              disabled={!configCapable || !view?.model}
            >
              Config
            </TabsTrigger>
            <TabsTrigger value="monaco">Monaco</TabsTrigger>
          </TabsList>
        </Tabs>
        {!configCapable && (
          <p className="text-sm text-muted-foreground">
            Config mode edits {FILE_NAMES[SHELL_FILE_IDS[shell][0]]} only.
          </p>
        )}
      </div>

      {state.status === 'loading' && (
        <StatePanel tone="loading" title="Reading the file…" />
      )}
      {state.status === 'error' && (
        <StatePanel
          tone="error"
          title="Could not read the file"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              <RotateCwIcon aria-hidden />
              Retry
            </Button>
          }
        >
          {describeError(state.error, 'shell files')}
        </StatePanel>
      )}

      {view && configCapable && view.modelError && (
        <div
          role="note"
          className="flex items-start gap-3 rounded-md border border-warn/40 p-3"
        >
          <TriangleAlertIcon
            className="mt-0.5 size-4 shrink-0 text-warn"
            aria-hidden
          />
          <p className="min-w-0 text-sm">
            Config mode is off for this file: {view.modelError}. Fix the markers
            in Monaco mode.
          </p>
        </div>
      )}

      {view && effectiveMode === 'config' && model && (
        <ShellConfigForm
          view={view}
          saved={saved}
          model={model}
          onChange={(m) => setModel(normalizeModel(m))}
          catalog={catalog.status === 'ready' ? catalog.data : null}
          onEditAtLine={editAtLine}
          onValidityChange={onValidityChange}
        />
      )}

      {view && effectiveMode === 'monaco' && (
        <div className="flex min-w-0 flex-col gap-2">
          <LazyCodeEditor
            value={raw}
            onChange={setRaw}
            height="60vh"
            ariaLabel={`${FILE_NAMES[fileId]} editor`}
            reveal={reveal}
          />
          <p className="text-xs text-muted-foreground">
            Tab indents inside the editor. Press{' '}
            <kbd className="rounded-sm border px-1 font-mono">Ctrl+M</kbd> to
            make Tab move focus instead.
          </p>
        </div>
      )}

      {problems.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-destructive/50 p-3 text-sm text-destructive"
        >
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <SaveBar
        count={dirty ? 1 : 0}
        label="file with unsaved changes"
        busy={flow.previewing}
        disabled={blocked}
        disabledReason={
          problems.length > 0
            ? 'Fix the problems above to save.'
            : invalid.size > 0
              ? INVALID_FIELDS_REASON
              : undefined
        }
        onDiscard={() => guard.confirmDiscard(resetDrafts)}
        onReview={review}
      />
      <SaveReviewDialog {...flow.dialog} />
      {guard.dialog}
    </PageBody>
  );
}
