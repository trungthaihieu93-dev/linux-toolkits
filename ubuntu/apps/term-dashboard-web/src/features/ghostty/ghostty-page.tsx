import {
  API_PATHS,
  type GhosttyConfigView,
  type GhosttyEdit,
  type GhosttyFileView,
  type GhosttySavePreview,
  type GhosttySaveRequest,
  type GhosttySaveResult,
  type GhosttySchema,
  type NameList,
} from '@linux-toolchain/term-config';
import { InfoIcon, RotateCwIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useInventory } from '../../app/shell-data';
import { StatePanel } from '../../components/state-panel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs';
import { useToast } from '../../components/ui/toast';
import {
  ApiRequestError,
  describeError,
  useApi,
  useResource,
} from '../../lib/api';
import { PageBody, PageHeader } from '../page-header';
import { SaveBar } from '../save/save-bar';
import { SaveReviewDialog } from '../save/save-review-dialog';
import { useUnsavedChangesGuard } from '../save/unsaved-changes';
import { useSaveFlow } from '../save/use-save-flow';
import { SchemaForm } from '../schema-form/schema-form';
import {
  INVALID_FIELDS_REASON,
  useInvalidFields,
} from '../schema-form/use-invalid-fields';
import {
  ghosttyFields,
  ghosttyFormState,
  rawNumberErrors,
  rawNumberKeys,
  stageChange,
  stageReset,
  withSavedMtimes,
} from './ghostty-fields';

/** Ghostty's default `reload_config` binding on Linux. */
const RELOAD_SHORTCUT = 'ctrl+shift+,';

const FILE_LABEL: Record<GhosttyFileView['id'], string> = {
  ghostty: 'config.ghostty',
  'ghostty-legacy': 'config',
};

function FileTab({ file }: { file: GhosttyFileView }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 font-mono text-sm">
        <span className="min-w-0 break-all">{file.path}</span>
        {file.exists ? (
          <Badge variant="run">exists</Badge>
        ) : (
          <Badge variant="muted">missing</Badge>
        )}
        {file.readOnly && <Badge variant="muted">read-only</Badge>}
      </p>
      {file.includes.length > 0 && (
        <div className="rounded-md border p-3">
          <h3 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Includes (read-only)
          </h3>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-sm">
            {file.includes.map((inc) => (
              <li key={`${inc.line}:${inc.path}`} className="break-all">
                <span className="text-muted-foreground">L{inc.line}</span>{' '}
                config-file = {inc.optional ? '?' : ''}
                {inc.path}
              </li>
            ))}
          </ul>
        </div>
      )}
      {file.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {file.exists
            ? 'This file sets no keys.'
            : 'This file does not exist.'}
        </p>
      ) : (
        <ol
          aria-label={`Keys set in ${FILE_LABEL[file.id]}`}
          className="flex flex-col divide-y rounded-md border font-mono text-sm"
        >
          {file.entries.map((e) => (
            <li
              key={`${e.line}:${e.key}`}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 px-3 py-1.5 sm:grid-cols-[3.5rem_minmax(0,16rem)_minmax(0,1fr)]"
            >
              <span className="text-muted-foreground">L{e.line}</span>
              <span className="break-all">{e.key}</span>
              <span className="col-start-2 break-all text-muted-foreground sm:col-start-auto">
                {e.value}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GhosttyEditor({
  schema,
  initialConfig,
  themes,
  fonts,
}: {
  schema: GhosttySchema;
  initialConfig: GhosttyConfigView;
  themes: string[];
  fonts: string[];
}) {
  const api = useApi();
  const toast = useToast();
  const [config, setConfig] = useState(initialConfig);
  const [staged, setStaged] = useState<Map<string, GhosttyEdit>>(new Map());
  const [saved, setSaved] = useState<GhosttySaveResult | null>(null);
  const flow = useSaveFlow();
  const guard = useUnsavedChangesGuard(staged.size > 0);
  const { invalid, onValidityChange } = useInvalidFields();
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  // Remount fields so text typed into them goes with the edit.
  const remount = (ids: Iterable<string>) =>
    setRevisions((r) => {
      const next = { ...r };
      for (const id of ids) next[id] = (next[id] ?? 0) + 1;
      return next;
    });

  const rawNumbers = useMemo(
    () => rawNumberKeys(schema, config),
    [schema, config],
  );
  const fields = useMemo(
    () => ghosttyFields(schema, themes, fonts, rawNumbers),
    [schema, themes, fonts, rawNumbers],
  );
  const keys = useMemo(
    () => new Map(schema.keys.map((k) => [k.key, k])),
    [schema],
  );
  const state = useMemo(
    () => ghosttyFormState(schema, config, staged),
    [schema, config, staged],
  );

  // An edit may write either file (or move lines between them), so one file
  // td will not write (not UTF-8) makes the whole form read-only.
  const readOnly = config.files.filter((f) => f.readOnly);

  const request = (): GhosttySaveRequest => ({
    edits: [...staged.values()],
    baseMtimes: Object.fromEntries(config.files.map((f) => [f.id, f.mtimeMs])),
  });

  const review = () => {
    if (readOnly.length > 0) return;
    const body = request();
    void flow.start({
      title: 'Save Ghostty config',
      language: 'plaintext',
      preview: async () => {
        const p = await api.request<GhosttySavePreview>(
          'POST',
          API_PATHS.ghosttyPreview,
          body,
        );
        return { previews: p.previews, warnings: p.warnings };
      },
      apply: async () => {
        const result = await api.request<GhosttySaveResult>(
          'POST',
          API_PATHS.ghosttySave,
          body,
        );
        setSaved(result);
        // Read the files again before dropping the staged edits, so the form
        // never shows the values from before the save.
        let next: GhosttyConfigView;
        try {
          next = await api.get<GhosttyConfigView>(API_PATHS.ghosttyConfig);
        } catch (e) {
          // The new mtimes still let the next save go through.
          next = withSavedMtimes(config, result);
          toast({
            tone: 'error',
            title: 'Saved, but the config could not be read again',
            description:
              `The form shows the values from before the save; reload the page to see the files. ${
                e instanceof Error ? describeError(e, 'the Ghostty config') : ''
              }`.trim(),
          });
        }
        setConfig(next);
        setStaged(new Map());
        toast({
          tone: 'success',
          title: 'Ghostty config saved',
          description: `Reload it in Ghostty with ${RELOAD_SHORTCUT}.`,
        });
      },
    });
  };

  return (
    <>
      {readOnly.length > 0 && (
        <div
          role="note"
          aria-label="Read-only"
          className="flex items-start gap-3 rounded-md border border-warn/40 p-3"
        >
          <TriangleAlertIcon
            className="mt-0.5 size-4 shrink-0 text-warn"
            aria-hidden
          />
          <div className="min-w-0 text-sm">
            <p className="font-mono font-medium">Read-only</p>
            {readOnly.map((f) => (
              <p key={f.id} className="break-words text-muted-foreground">
                {f.readOnly}
              </p>
            ))}
            <p className="text-muted-foreground">
              td shows the settings but will not save them until the file is
              valid UTF-8.
            </p>
          </div>
        </div>
      )}

      {config.conflicts.length > 0 && (
        <div
          role="note"
          className="flex items-start gap-3 rounded-md border border-warn/40 p-3"
        >
          <TriangleAlertIcon
            className="mt-0.5 size-4 shrink-0 text-warn"
            aria-hidden
          />
          <div className="min-w-0 text-sm">
            <p className="font-mono font-medium">
              Both files set {config.conflicts.length} key
              {config.conflicts.length === 1 ? '' : 's'}
            </p>
            <p className="text-muted-foreground">
              Ghostty loads config.ghostty, then config, so the later file wins.
              td edits the winning file:{' '}
              <span className="break-words font-mono">
                {config.conflicts
                  .map((c) => `${c.key} (${FILE_LABEL[c.winner]})`)
                  .join(', ')}
              </span>
            </p>
          </div>
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-run/40 p-3"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-run" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="font-mono font-medium">Saved</p>
            <p className="text-muted-foreground">
              Ghostty does not reload by itself. Press{' '}
              <kbd className="rounded-sm border px-1 font-mono text-foreground">
                {RELOAD_SHORTCUT}
              </kbd>{' '}
              in a Ghostty window (reload_config) or restart it.
              {saved.results.some((r) => r.backup) &&
                ` Backups: ${saved.results
                  .map((r) => r.backup?.path)
                  .filter(Boolean)
                  .join(', ')}.`}
            </p>
            {saved.warnings.map((w) => (
              <p key={w} className="mt-1 break-words text-warn">
                {w}
              </p>
            ))}
          </div>
        </div>
      )}

      <Tabs defaultValue="settings">
        <TabsList aria-label="Ghostty views">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          {config.files.map((f) => (
            <TabsTrigger key={f.id} value={f.id}>
              {FILE_LABEL[f.id]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="settings">
          <SchemaForm
            label="Ghostty settings"
            fields={fields}
            values={state.values}
            isModified={(id) => state.modified.has(id)}
            onChange={(id, v) => {
              const k = keys.get(id);
              if (k) setStaged((s) => stageChange(s, k, v, config));
            }}
            onReset={(id) => {
              setStaged((s) => stageReset(s, id, config));
              remount([id]);
            }}
            onValidityChange={onValidityChange}
            revisions={revisions}
            disabled={readOnly.length > 0}
            errors={rawNumberErrors(rawNumbers, staged)}
            notes={(id) =>
              staged.has(id) ? (
                <span className="font-mono text-xs text-link">
                  {staged.get(id)?.op === 'unset'
                    ? 'will be removed from the config'
                    : 'unsaved'}
                </span>
              ) : null
            }
          />
        </TabsContent>
        {config.files.map((f) => (
          <TabsContent key={f.id} value={f.id}>
            <FileTab file={f} />
          </TabsContent>
        ))}
      </Tabs>

      <SaveBar
        count={staged.size}
        busy={flow.previewing}
        disabled={readOnly.length > 0 || invalid.size > 0}
        disabledReason={
          readOnly.length > 0
            ? 'td will not save the Ghostty config (see the note above).'
            : invalid.size > 0
              ? INVALID_FIELDS_REASON
              : undefined
        }
        onDiscard={() =>
          guard.confirmDiscard(() => {
            setStaged(new Map());
            remount(invalid);
          })
        }
        onReview={review}
      />
      <SaveReviewDialog {...flow.dialog} />
      {guard.dialog}
    </>
  );
}

export function GhosttyPage() {
  const inventory = useInventory();
  const data = useResource(async (api) => {
    const [schema, config] = await Promise.all([
      api.get<GhosttySchema>(API_PATHS.ghosttySchema),
      api.get<GhosttyConfigView>(API_PATHS.ghosttyConfig),
    ]);
    return { schema, config };
  });
  // Pickers fall back to typed values when these lists fail.
  const themes = useResource((api) =>
    api.get<NameList>(API_PATHS.ghosttyThemes),
  );
  const fonts = useResource((api) => api.get<NameList>(API_PATHS.ghosttyFonts));

  const ghostty = inventory.status === 'ready' ? inventory.data.ghostty : null;
  const notInstalled =
    ghostty?.installed === false ||
    (data.status === 'error' &&
      data.error instanceof ApiRequestError &&
      data.error.status === 503);

  return (
    <PageBody>
      <PageHeader
        title="Ghostty"
        description={
          ghostty?.installed
            ? `Version ${ghostty.version ?? 'unknown'}. Edits are checked with ghostty +validate-config before the file is replaced.`
            : 'Ghostty terminal configuration.'
        }
      />
      {notInstalled ? (
        <StatePanel tone="empty" title="Ghostty is not installed">
          Install Ghostty to edit its configuration here. td looks for the{' '}
          <code className="font-mono text-foreground">ghostty</code> command on
          PATH.
        </StatePanel>
      ) : data.status === 'loading' ? (
        <StatePanel
          tone="loading"
          title="Reading the Ghostty schema and config…"
        />
      ) : data.status === 'error' ? (
        <StatePanel
          tone="error"
          title="Could not read the Ghostty config"
          action={
            <Button variant="outline" size="sm" onClick={data.reload}>
              <RotateCwIcon aria-hidden />
              Retry
            </Button>
          }
        >
          {describeError(data.error, 'the Ghostty config')}
        </StatePanel>
      ) : (
        <GhosttyEditor
          schema={data.data.schema}
          initialConfig={data.data.config}
          themes={themes.status === 'ready' ? themes.data.names : []}
          fonts={fonts.status === 'ready' ? fonts.data.names : []}
        />
      )}
    </PageBody>
  );
}
