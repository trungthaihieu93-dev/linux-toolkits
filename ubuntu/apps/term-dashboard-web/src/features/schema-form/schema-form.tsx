import { SearchIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { SchemaField } from './schema-field';
import type { FieldDescriptor, FieldValue } from './types';
import { WindowedList } from './windowed-list';

export interface SchemaFormProps {
  /** Accessible name of the form region, e.g. "Ghostty settings". */
  label: string;
  fields: FieldDescriptor[];
  values: Record<string, FieldValue>;
  isModified: (id: string) => boolean;
  onChange: (id: string, value: FieldValue) => void;
  onReset?: (id: string) => void;
  errors?: Record<string, string | undefined>;
  notes?: (id: string) => ReactNode;
  disabled?: boolean;
  /** See `SchemaFieldProps.onValidityChange`. */
  onValidityChange?: (id: string, invalid: boolean) => void;
  /**
   * Bumping a field's revision mounts it afresh, which drops text typed into
   * it (used after a reset or discard, when the value may not change).
   */
  revisions?: Record<string, number>;
  /** Lists longer than this are windowed. */
  windowThreshold?: number;
}

type Row =
  | { type: 'group'; key: string; label: string; count: number }
  | { type: 'field'; key: string; field: FieldDescriptor };

function matches(field: FieldDescriptor, q: string): boolean {
  if (!q) return true;
  return [field.id, field.label, field.summary ?? '', field.doc ?? ''].some(
    (t) => t.toLowerCase().includes(q),
  );
}

/**
 * A schema-driven settings form: search, grouping, a "modified only"
 * filter, and plain windowing for long schemas (Ghostty has 211 keys).
 */
export function SchemaForm({
  label,
  fields,
  values,
  isModified,
  onChange,
  onReset,
  errors,
  notes,
  disabled,
  onValidityChange,
  revisions,
  windowThreshold = 40,
}: SchemaFormProps) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const q = query.trim().toLowerCase();

  const visible = fields.filter(
    (f) => matches(f, q) && (!modifiedOnly || isModified(f.id)),
  );

  const rows = ((): Row[] => {
    const groups = new Map<string, FieldDescriptor[]>();
    for (const f of visible) {
      const g = f.group ?? '';
      const list = groups.get(g);
      if (list) list.push(f);
      else groups.set(g, [f]);
    }
    const out: Row[] = [];
    for (const [g, list] of groups) {
      if (g)
        out.push({
          type: 'group',
          key: `group:${g}`,
          label: g,
          count: list.length,
        });
      for (const f of list)
        out.push({
          type: 'field',
          key: `field:${f.id}:${revisions?.[f.id] ?? 0}`,
          field: f,
        });
    }
    return out;
  })();

  const renderRow = (row: Row) =>
    row.type === 'group' ? (
      <h3 className="mt-4 border-b pb-1 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {row.label}
        <span className="ml-2 normal-case tracking-normal">({row.count})</span>
      </h3>
    ) : (
      <SchemaField
        field={row.field}
        value={values[row.field.id]}
        modified={isModified(row.field.id)}
        onChange={(v) => onChange(row.field.id, v)}
        onReset={onReset ? () => onReset(row.field.id) : undefined}
        error={errors?.[row.field.id]}
        note={notes?.(row.field.id)}
        disabled={disabled}
        onValidityChange={
          onValidityChange
            ? (invalid) => onValidityChange(row.field.id, invalid)
            : undefined
        }
      />
    );

  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={searchId}
            type="search"
            aria-label={`Search ${label}`}
            placeholder={`Search ${fields.length} settings`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 font-mono text-sm">
          <Switch checked={modifiedOnly} onCheckedChange={setModifiedOnly} />
          Modified only
        </label>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {visible.length === fields.length
          ? `${fields.length} settings`
          : `${visible.length} of ${fields.length} settings`}
      </p>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {modifiedOnly && !q
            ? 'Nothing is modified from its default.'
            : 'No setting matches the search.'}
        </p>
      ) : rows.length > windowThreshold ? (
        <WindowedList
          items={rows}
          getKey={(r) => r.key}
          renderItem={renderRow}
          className="divide-y"
        />
      ) : (
        <div className="divide-y">
          {rows.map((r) => (
            <div key={r.key}>{renderRow(r)}</div>
          ))}
        </div>
      )}
    </section>
  );
}
