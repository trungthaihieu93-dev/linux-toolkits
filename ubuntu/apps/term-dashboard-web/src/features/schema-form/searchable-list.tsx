import { PaletteIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';

/** Options rendered at once; the search narrows the rest. */
const MAX_SHOWN = 100;

function filterOptions(options: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.toLowerCase().includes(q));
}

interface SearchableSelectProps {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  preview: 'theme' | 'font';
  allowCustom?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * A searchable single choice (Ghostty themes and fonts, Ptyxis palettes):
 * a combobox input over an inline listbox, driven by arrow keys and Enter,
 * with a preview chip of the current value.
 */
export function SearchableSelect({
  id,
  label,
  value,
  options,
  onChange,
  preview,
  allowCustom = false,
  disabled,
  invalid,
  describedBy,
}: SearchableSelectProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);

  const choices = useMemo(() => {
    const matches = filterOptions(options, query);
    const q = query.trim();
    const custom =
      allowCustom && q && !options.includes(q)
        ? [{ custom: true, name: q }]
        : [];
    return [
      ...custom,
      ...matches.slice(0, MAX_SHOWN).map((name) => ({ custom: false, name })),
    ];
  }, [options, query, allowCustom]);
  const hidden = Math.max(0, filterOptions(options, query).length - MAX_SHOWN);

  const choose = (name: string) => {
    onChange(name);
    setQuery('');
    setExpanded(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setExpanded(true);
      setActive((i) => Math.min(i + 1, choices.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const c = choices[active];
      if (expanded && c) {
        e.preventDefault();
        choose(c.name);
      }
    } else if (e.key === 'Escape' && expanded) {
      // Close the list, not the dialog around it.
      e.stopPropagation();
      setExpanded(false);
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;

  // Keep the highlighted option visible in the scrolling list.
  useEffect(() => {
    if (!expanded) return;
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, active, listId]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {preview === 'theme' ? (
          <Badge variant="outline" className="max-w-full">
            <PaletteIcon aria-hidden />
            <span className="truncate">{value || 'default'}</span>
          </Badge>
        ) : (
          <span
            className="max-w-full truncate rounded-sm border px-2 py-0.5 text-sm"
            style={value ? { fontFamily: `"${value}", monospace` } : undefined}
          >
            {value ? `${value}: AaBb 0O1l {}` : 'default font'}
          </span>
        )}
      </div>
      <Input
        id={id}
        role="combobox"
        type="search"
        aria-label={`Search ${label}`}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          expanded && choices[active] ? optionId(active) : undefined
        }
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={
          value ? `Current: ${value}` : `Search ${options.length} names`
        }
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setExpanded(true);
        }}
        onFocus={() => setExpanded(true)}
        onBlur={() => setExpanded(false)}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="max-h-48 overflow-y-auto rounded-md border bg-popover p-1"
        >
          {choices.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              No match.
            </li>
          )}
          {choices.map((c, i) => (
            <li
              key={`${c.custom ? 'custom:' : ''}${c.name}`}
              id={optionId(i)}
              role="option"
              aria-selected={c.name === value}
              // Keep focus in the input while choosing with the mouse.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c.name)}
              className={cn(
                'cursor-pointer truncate rounded-sm px-2 py-1.5 font-mono text-sm',
                i === active && 'bg-accent text-accent-foreground',
                c.name === value && 'text-link',
              )}
            >
              {c.custom ? `Use “${c.name}”` : c.name}
            </li>
          ))}
          {hidden > 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              {hidden} more. Type to narrow the list.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

interface MultiSelectProps {
  id: string;
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  describedBy?: string;
}

/** Several choices from a long list (oh-my-zsh plugins, gsettings flags). */
export function MultiSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  describedBy,
}: MultiSelectProps) {
  const [query, setQuery] = useState('');
  const all = useMemo(
    () => [...value.filter((v) => !options.includes(v)), ...options],
    [options, value],
  );
  const matches = filterOptions(all, query);
  const shown = matches.slice(0, MAX_SHOWN);
  const toggle = (name: string, on: boolean) =>
    onChange(on ? [...value, name] : value.filter((v) => v !== name));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {value.length > 0 && (
        <ul aria-label={`Selected ${label}`} className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <li key={v}>
              <Badge variant="secondary" className="gap-1 py-0 pr-0">
                {v}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(v, false)}
                  className="inline-flex size-6 cursor-pointer items-center justify-center rounded-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <XIcon aria-hidden />
                  <span className="sr-only">Remove {v}</span>
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        type="search"
        aria-label={`Search ${label}`}
        aria-describedby={describedBy}
        placeholder={`Search ${all.length} names`}
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
      />
      <fieldset
        disabled={disabled}
        className="max-h-48 overflow-y-auto rounded-md border p-1"
      >
        <legend className="sr-only">{label}</legend>
        {shown.map((name) => (
          <label
            key={name}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 font-mono text-sm hover:bg-accent"
          >
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={value.includes(name)}
              onChange={(e) => toggle(name, e.target.checked)}
            />
            <span className="min-w-0 truncate">{name}</span>
          </label>
        ))}
        {matches.length > shown.length && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {matches.length - shown.length} more. Type to narrow the list.
          </p>
        )}
        {matches.length === 0 && (
          <p className="px-2 py-1 text-sm text-muted-foreground">No match.</p>
        )}
      </fieldset>
    </div>
  );
}
