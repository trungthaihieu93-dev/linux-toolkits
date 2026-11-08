import { useCallback, useState } from 'react';

/**
 * Ids of the fields that currently show an invalid value, fed by
 * `SchemaForm`/`SchemaField` `onValidityChange`. Pages disable saving while
 * the set is not empty.
 */
export function useInvalidFields(): {
  invalid: ReadonlySet<string>;
  onValidityChange: (id: string, invalid: boolean) => void;
} {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set());
  const onValidityChange = useCallback((id: string, bad: boolean) => {
    setInvalid((s) => {
      if (s.has(id) === bad) return s;
      const next = new Set(s);
      if (bad) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  return { invalid, onValidityChange };
}

/** SaveBar's disabled reason while fields are invalid. */
export const INVALID_FIELDS_REASON = 'Fix the invalid values above to save.';
