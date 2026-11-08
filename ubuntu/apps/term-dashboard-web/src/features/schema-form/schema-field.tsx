import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Slider } from '../../components/ui/slider';
import { Switch } from '../../components/ui/switch';
import { cn } from '../../lib/utils';
import { MultiSelect, SearchableSelect } from './searchable-list';
import { HEX_COLOR, type FieldDescriptor, type FieldValue } from './types';

/** Radix Select items cannot have an empty value. */
const EMPTY = '\u0000empty';

function asString(v: FieldValue): string {
  return typeof v === 'string' ? v : String(v);
}
function asStrings(v: FieldValue): string[] {
  return Array.isArray(v)
    ? v.map((x) => (Array.isArray(x) ? x.join('=') : String(x)))
    : [];
}
function asPairs(v: FieldValue): [string, string][] {
  return Array.isArray(v)
    ? v.map((x) =>
        Array.isArray(x) ? [String(x[0]), String(x[1] ?? '')] : [String(x), ''],
      )
    : [];
}
function asNumber(v: FieldValue): number {
  return typeof v === 'number' ? v : Number(v);
}

interface NumberInputProps {
  id?: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  label: string;
  disabled?: boolean;
  className?: string;
  describedBy?: string;
}

/** A number box that keeps what is typed and reports only valid numbers. */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  integer,
  label,
  disabled,
  className,
  describedBy,
}: NumberInputProps) {
  const [text, setText] = useState(() => String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);
  const n = Number(text);
  const invalid =
    text.trim() === '' ||
    !Number.isFinite(n) ||
    (integer && !Number.isInteger(n)) ||
    (min !== undefined && n < min) ||
    (max !== undefined && n > max);
  return (
    <Input
      id={id}
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      min={min}
      max={max}
      step={step ?? (integer ? 1 : 'any')}
      value={text}
      disabled={disabled}
      className={className}
      onChange={(e) => {
        setText(e.target.value);
        const next = Number(e.target.value);
        const ok =
          e.target.value.trim() !== '' &&
          Number.isFinite(next) &&
          (!integer || Number.isInteger(next)) &&
          (min === undefined || next >= min) &&
          (max === undefined || next <= max);
        if (ok) onChange(next);
      }}
    />
  );
}

function RowButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Rows of strings: add, remove and reorder. */
function ListControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldDescriptor;
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {field.options && field.options.length > 0 && (
        <datalist id={listId}>
          {field.options.slice(0, 500).map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">No entries.</p>
      )}
      <ol className="flex min-w-0 flex-col gap-1.5">
        {value.map((item, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            <Input
              aria-label={`${field.label} entry ${i + 1}`}
              value={item}
              list={field.options ? listId : undefined}
              placeholder={field.placeholder}
              disabled={disabled}
              onChange={(e) =>
                onChange(value.map((v, j) => (j === i ? e.target.value : v)))
              }
            />
            <RowButton
              label={`Move ${field.label} entry ${i + 1} up`}
              disabled={disabled || i === 0}
              onClick={() => onChange(move(value, i, i - 1))}
            >
              <ArrowUpIcon aria-hidden />
            </RowButton>
            <RowButton
              label={`Move ${field.label} entry ${i + 1} down`}
              disabled={disabled || i === value.length - 1}
              onClick={() => onChange(move(value, i, i + 1))}
            >
              <ArrowDownIcon aria-hidden />
            </RowButton>
            <RowButton
              label={`Remove ${field.label} entry ${i + 1}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2Icon aria-hidden />
            </RowButton>
          </li>
        ))}
      </ol>
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={disabled}
        onClick={() => onChange([...value, ''])}
      >
        <PlusIcon aria-hidden />
        Add {field.label} entry
      </Button>
    </div>
  );
}

/** Key/value rows (`a(ss)`, aliases, environment variables). */
function PairsControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldDescriptor;
  value: [string, string][];
  onChange: (v: [string, string][]) => void;
  disabled?: boolean;
}) {
  const [first, second] = field.partLabels ?? ['Key', 'Value'];
  const set = (i: number, part: 0 | 1, text: string) =>
    onChange(
      value.map((row, j) =>
        j === i ? (part === 0 ? [text, row[1]] : [row[0], text]) : row,
      ),
    );
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">No entries.</p>
      )}
      {value.length > 0 && (
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)_2rem] gap-1 font-mono text-xs uppercase tracking-wide text-muted-foreground sm:grid"
        >
          <span>{first}</span>
          <span>{second}</span>
        </div>
      )}
      <ol className="flex min-w-0 flex-col gap-2 sm:gap-1.5">
        {value.map((row, i) => (
          <li
            key={i}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_2rem]"
          >
            <Input
              aria-label={`${first} ${i + 1}`}
              value={row[0]}
              disabled={disabled}
              onChange={(e) => set(i, 0, e.target.value)}
            />
            <Input
              aria-label={`${second} ${i + 1}`}
              value={row[1]}
              disabled={disabled}
              className="col-start-1 sm:col-start-auto"
              onChange={(e) => set(i, 1, e.target.value)}
            />
            <div className="col-start-2 row-span-2 row-start-1 flex items-start sm:col-start-3 sm:row-span-1">
              <RowButton
                label={`Remove ${row[0] || `${first.toLowerCase()} ${i + 1}`}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <Trash2Icon aria-hidden />
              </RowButton>
            </div>
          </li>
        ))}
      </ol>
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={disabled}
        onClick={() => onChange([...value, ['', '']])}
      >
        <PlusIcon aria-hidden />
        Add {field.label.toLowerCase()}
      </Button>
    </div>
  );
}

function ColorControl({
  id,
  field,
  value,
  onChange,
  disabled,
  describedBy,
}: {
  id: string;
  field: FieldDescriptor;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = text === '' || HEX_COLOR.test(text);
  const hex = HEX_COLOR.test(text)
    ? `#${text.replace(/^#/, '').toLowerCase()}`
    : null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        type="color"
        aria-label={`${field.label} colour picker`}
        value={hex ?? '#000000'}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <Input
        id={id}
        aria-label={`${field.label} hex value`}
        aria-invalid={!valid || undefined}
        aria-describedby={describedBy}
        placeholder="#rrggbb"
        value={text}
        disabled={disabled}
        className="max-w-40"
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === '' || HEX_COLOR.test(e.target.value)) {
            onChange(e.target.value);
          }
        }}
      />
      {!valid && <span className="text-xs text-destructive">Use #rrggbb</span>}
    </div>
  );
}

export interface SchemaFieldProps {
  field: FieldDescriptor;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  /** Differs from the default: shows the badge and enables reset. */
  modified?: boolean;
  onReset?: () => void;
  disabled?: boolean;
  /** Error from the server or the page (validation runs here too). */
  error?: string | null;
  /** Extra content under the control (e.g. "set in config"). */
  note?: ReactNode;
}

/** One setting: label, help, the control for its kind, badge and reset. */
export function SchemaField({
  field,
  value,
  onChange,
  modified = false,
  onReset,
  disabled,
  error,
  note,
}: SchemaFieldProps) {
  const baseId = useId();
  const controlId = `${baseId}-control`;
  const helpId = `${baseId}-help`;
  const errorId = `${baseId}-error`;
  const ownError = field.validate?.(value) ?? null;
  const shownError = error ?? ownError;
  const describedBy =
    [field.summary ? helpId : null, shownError ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;
  const labelledInline = field.kind === 'bool';

  let control: ReactNode;
  switch (field.kind) {
    case 'bool':
      control = (
        <Switch
          id={controlId}
          checked={value === true}
          disabled={disabled}
          aria-describedby={describedBy}
          onCheckedChange={(on) => onChange(on)}
        />
      );
      break;
    case 'enum': {
      const current = asString(value);
      const options = field.options ?? [];
      const all =
        options.includes(current) || current === ''
          ? options
          : [current, ...options];
      control = (
        <Select
          value={current === '' ? EMPTY : current}
          disabled={disabled}
          onValueChange={(v) => onChange(v === EMPTY ? '' : v)}
        >
          <SelectTrigger
            id={controlId}
            aria-label={field.label}
            aria-describedby={describedBy}
            className="sm:max-w-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {current === '' && !options.includes('') && (
              <SelectItem value={EMPTY}>(unset)</SelectItem>
            )}
            {all.map((o) => (
              <SelectItem key={o || EMPTY} value={o === '' ? EMPTY : o}>
                {o === '' ? '(empty)' : o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    }
    case 'range': {
      const n = asNumber(value);
      const min = field.min ?? 0;
      const max = field.max ?? 100;
      const step = field.step ?? (field.integer ? 1 : (max - min) / 100);
      control = (
        <div className="flex min-w-0 items-center gap-3">
          <Slider
            aria-label={field.label}
            min={min}
            max={max}
            step={step}
            value={[Number.isFinite(n) ? n : min]}
            disabled={disabled}
            onValueChange={([v]) =>
              onChange(field.integer ? Math.round(v) : Number(v.toFixed(6)))
            }
            className="max-w-xs"
          />
          <NumberInput
            id={controlId}
            label={`${field.label} value`}
            value={n}
            min={min}
            max={max}
            step={step}
            integer={field.integer}
            disabled={disabled}
            describedBy={describedBy}
            onChange={onChange}
            className="w-28"
          />
        </div>
      );
      break;
    }
    case 'number':
      control = (
        <NumberInput
          id={controlId}
          label={field.label}
          value={asNumber(value)}
          min={field.min}
          max={field.max}
          step={field.step}
          integer={field.integer}
          disabled={disabled}
          describedBy={describedBy}
          onChange={onChange}
          className="sm:max-w-40"
        />
      );
      break;
    case 'color':
      control = (
        <ColorControl
          id={controlId}
          field={field}
          value={asString(value)}
          disabled={disabled}
          describedBy={describedBy}
          onChange={onChange}
        />
      );
      break;
    case 'list':
      control = (
        <ListControl
          field={field}
          value={asStrings(value)}
          disabled={disabled}
          onChange={onChange}
        />
      );
      break;
    case 'multi':
      control = (
        <MultiSelect
          id={controlId}
          label={field.label}
          value={asStrings(value)}
          options={field.options ?? []}
          disabled={disabled}
          describedBy={describedBy}
          onChange={onChange}
        />
      );
      break;
    case 'pairs':
      control = (
        <PairsControl
          field={field}
          value={asPairs(value)}
          disabled={disabled}
          onChange={onChange}
        />
      );
      break;
    case 'tuple': {
      const pair = Array.isArray(value) ? value : [0, 0];
      const [a, b] = [Number(pair[0]), Number(pair[1])];
      const [la, lb] = field.partLabels ?? ['First', 'Second'];
      control = (
        <div className="flex flex-wrap items-center gap-2">
          <NumberInput
            id={controlId}
            label={`${field.label} ${la}`}
            value={a}
            integer={field.integer}
            min={field.min}
            max={field.max}
            disabled={disabled}
            describedBy={describedBy}
            onChange={(n) => onChange([n, b])}
            className="w-28"
          />
          <span aria-hidden className="text-muted-foreground">
            ×
          </span>
          <NumberInput
            label={`${field.label} ${lb}`}
            value={b}
            integer={field.integer}
            min={field.min}
            max={field.max}
            disabled={disabled}
            onChange={(n) => onChange([a, n])}
            className="w-28"
          />
        </div>
      );
      break;
    }
    case 'theme':
    case 'font':
      control = (
        <SearchableSelect
          id={controlId}
          label={field.label}
          value={asString(value)}
          options={field.options ?? []}
          preview={field.kind}
          allowCustom={field.allowCustom}
          disabled={disabled}
          invalid={Boolean(shownError)}
          describedBy={describedBy}
          onChange={onChange}
        />
      );
      break;
    case 'text':
      control = (
        <Input
          id={controlId}
          value={asString(value)}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-invalid={Boolean(shownError) || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
  }

  const labelEl =
    field.kind === 'list' || field.kind === 'pairs' ? (
      <span className="font-mono text-sm font-medium break-all">
        {field.label}
      </span>
    ) : (
      <label
        htmlFor={controlId}
        className="font-mono text-sm font-medium break-all"
      >
        {field.label}
      </label>
    );

  return (
    <div
      data-field={field.id}
      role={
        field.kind === 'list' || field.kind === 'pairs' ? 'group' : undefined
      }
      aria-label={
        field.kind === 'list' || field.kind === 'pairs'
          ? field.label
          : undefined
      }
      className="flex min-w-0 flex-col gap-2 py-3"
    >
      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center gap-2',
          labelledInline && 'justify-between',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {labelEl}
          {modified && <Badge variant="warn">modified</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {labelledInline && control}
          {onReset && modified && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`Reset ${field.label} to default`}
              title="Reset to default"
              onClick={onReset}
            >
              <RotateCcwIcon aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {field.summary && (
        <p id={helpId} className="text-sm text-muted-foreground">
          {field.summary}
        </p>
      )}
      {field.doc && field.doc !== field.summary && (
        <details className="group text-sm">
          <summary className="w-fit cursor-pointer rounded-sm font-mono text-xs text-link focus-visible:outline-2 focus-visible:outline-ring">
            Help
          </summary>
          <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-2 text-muted-foreground">
            {field.doc}
          </p>
        </details>
      )}
      {!labelledInline && control}
      {shownError && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {shownError}
        </p>
      )}
      {note}
    </div>
  );
}
