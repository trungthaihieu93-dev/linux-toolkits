import {
  API_PATHS,
  type GSettingsSchemaView,
} from '@linux-toolchain/term-config';
import { RotateCwIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StatePanel } from '../../components/state-panel';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { describeError, useApi, useResource } from '../../lib/api';
import { SchemaForm } from '../schema-form/schema-form';
import { sameValue, type FieldValue } from '../schema-form/types';
import { gsettingsField } from './gsettings-fields';

/** Quiet time after the last edit of a key before it is written. */
export const GSETTINGS_WRITE_DELAY_MS = 500;

type WriteState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * A form over one gsettings schema (global, shortcuts or a profile). Each
 * key is written on its own after a short pause (gsettings has no file to
 * diff); every write shows up in the activity panel. Mount with
 * `key={path}` so a different schema starts fresh.
 */
export function GSettingsForm({
  path,
  label,
  palettes,
  onWritten,
}: {
  /** API path of the schema view (`API_PATHS.terminalGlobal(kind)`, ...). */
  path: string;
  label: string;
  /** Palette names for a Ptyxis profile (undefined: not a profile). */
  palettes?: string[] | null;
  onWritten?: (key: string) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const loaded = useResource((a) => a.get<GSettingsSchemaView>(path));
  const [view, setView] = useState<GSettingsSchemaView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FieldValue>>({});
  // Mirrors `drafts` for callbacks that run outside a render.
  const draftsRef = useRef<Record<string, FieldValue>>({});
  const updateDrafts = (
    change: (d: Record<string, FieldValue>) => Record<string, FieldValue>,
  ) => {
    draftsRef.current = change(draftsRef.current);
    setDrafts(draftsRef.current);
  };
  // Keys whose box shows text that is not a valid value: nothing is written
  // for them until the text is valid again.
  const invalid = useRef(new Set<string>());
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [writeState, setWriteState] = useState<WriteState>('idle');
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, () => void>());
  // Writes and resets run one at a time, in the order they were made: each
  // response then holds the whole schema after every earlier change, so an
  // older response can never land after a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (task: () => Promise<void>) => {
    queue.current = queue.current.then(() =>
      // `write` and `resetNow` report their own failures; this only keeps
      // an unexpected throw from stopping the queue.
      task().catch((e: unknown) => {
        setWriteState('error');
        toast({
          tone: 'error',
          title: `${label} was not changed`,
          description: e instanceof Error ? e.message : String(e),
        });
      }),
    );
  };

  const loadedView = loaded.status === 'ready' ? loaded.data : null;
  useEffect(() => {
    if (loadedView) setView(loadedView);
  }, [loadedView]);

  const fields = useMemo(
    () =>
      new Map(
        (view?.keys ?? []).map((k) => [
          k.name,
          gsettingsField(k, { palettes }),
        ]),
      ),
    [view, palettes],
  );

  const write = async (key: string, value: FieldValue) => {
    const f = fields.get(key);
    if (!f) return;
    if (f.field.validate?.(value)) return; // the field shows the message
    let text: string;
    try {
      text = f.encode(value);
    } catch (e) {
      setErrors((x) => ({
        ...x,
        [key]: e instanceof Error ? e.message : String(e),
      }));
      return;
    }
    setWriteState('saving');
    try {
      const next = await api.request<GSettingsSchemaView>('PUT', path, {
        key,
        value: text,
      });
      setView(next);
      setErrors((x) => ({ ...x, [key]: undefined }));
      // Keep a newer draft typed while this write was running.
      updateDrafts((d) => {
        if (!(key in d) || !sameValue(d[key], value)) return d;
        const rest = { ...d };
        delete rest[key];
        return rest;
      });
      setWriteState('saved');
      onWritten?.(key);
    } catch (e) {
      setWriteState('error');
      const message =
        e instanceof Error ? describeError(e, 'gsettings writes') : String(e);
      setErrors((x) => ({ ...x, [key]: message }));
      toast({
        tone: 'error',
        title: `${key} was not changed`,
        description: message,
      });
    }
  };
  const writeRef = useRef(write);
  writeRef.current = write;

  const cancel = (key: string) => {
    const t = timers.current.get(key);
    if (t) clearTimeout(t);
    timers.current.delete(key);
    pending.current.delete(key);
  };

  // Set while the form unmounts: the flush below is the last write, and a
  // field's unmount cleanup must not arm a timer nothing would clear.
  const unmounted = useRef(false);

  const schedule = (key: string, value: FieldValue) => {
    if (unmounted.current) return;
    updateDrafts((d) => ({ ...d, [key]: value }));
    cancel(key);
    if (invalid.current.has(key)) return;
    const run = () => {
      timers.current.delete(key);
      pending.current.delete(key);
      enqueue(() => writeRef.current(key, value));
    };
    pending.current.set(key, run);
    timers.current.set(key, setTimeout(run, GSETTINGS_WRITE_DELAY_MS));
  };

  // Leaving the page writes what is still waiting for its pause.
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      for (const t of timers.current.values()) clearTimeout(t);
      for (const run of pending.current.values()) run();
    };
  }, []);

  // A box turning invalid drops its waiting write (it would store the last
  // valid number, not what the box shows); turning valid writes the draft.
  const onValidityChange = (key: string, bad: boolean) => {
    // An unmounting field reports itself valid; its text is gone, not fixed.
    if (unmounted.current) return;
    if (bad) {
      invalid.current.add(key);
      cancel(key);
      return;
    }
    if (!invalid.current.delete(key)) return;
    const d = draftsRef.current;
    if (key in d) schedule(key, d[key]);
  };

  const reset = (key: string) => {
    cancel(key);
    // Remount the field so text typed into it goes, even when the reset
    // value equals the last valid one.
    invalid.current.delete(key);
    setRevisions((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 }));
    enqueue(() => resetNow(key));
  };

  const resetNow = async (key: string) => {
    setWriteState('saving');
    try {
      const next = await api.request<GSettingsSchemaView>(
        'POST',
        API_PATHS.terminalReset(path),
        { key },
      );
      setView(next);
      updateDrafts((d) => {
        const rest = { ...d };
        delete rest[key];
        return rest;
      });
      setErrors((x) => ({ ...x, [key]: undefined }));
      setWriteState('saved');
      onWritten?.(key);
    } catch (e) {
      setWriteState('error');
      toast({
        tone: 'error',
        title: `${key} was not reset`,
        description:
          e instanceof Error ? describeError(e, 'gsettings resets') : String(e),
      });
    }
  };

  if (!view) {
    if (loaded.status === 'error') {
      return (
        <StatePanel
          tone="error"
          title={`Could not read ${label}`}
          action={
            <Button variant="outline" size="sm" onClick={loaded.reload}>
              <RotateCwIcon aria-hidden />
              Retry
            </Button>
          }
        >
          {describeError(loaded.error, label)}
        </StatePanel>
      );
    }
    return <StatePanel tone="loading" title={`Reading ${label}…`} />;
  }

  const values: Record<string, FieldValue> = {};
  for (const [name, f] of fields)
    values[name] = name in drafts ? drafts[name] : f.value;
  const isDefault = new Map(view.keys.map((k) => [k.name, k.isDefault]));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p
        className="break-all font-mono text-xs text-muted-foreground"
        aria-live="polite"
      >
        gsettings {view.schema}
        {view.path ? `:${view.path}` : ''} · changes apply as you edit
        {writeState === 'saving' && ' · writing…'}
        {writeState === 'saved' && ' · saved'}
        {writeState === 'error' && ' · last write failed'}
      </p>
      <SchemaForm
        label={label}
        fields={[...fields.values()].map((f) => f.field)}
        values={values}
        isModified={(id) => id in drafts || isDefault.get(id) === false}
        onChange={schedule}
        onReset={reset}
        onValidityChange={onValidityChange}
        revisions={revisions}
        errors={errors}
      />
    </div>
  );
}
