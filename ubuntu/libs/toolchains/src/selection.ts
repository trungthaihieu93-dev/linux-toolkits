import { catalog as defaultCatalog } from './catalog';
import { defaultsFor, mergeChoices } from './options';
import type { Choices, Probes, Toolchain } from './types';

export interface Selection {
  /** Selected ids in catalog order, no duplicates. */
  ids: string[];
  /** One line per auto-added component, explaining why. */
  notes: string[];
}

/**
 * Expand the user's selection with dependency rules:
 * - a chosen add-on listed in `addonImplies` selects its component
 *   (flutter `android-sdk` -> android, java `jenv` -> jenv);
 * - each `requires` target is added unless already selected or present
 *   (bun-tools -> nvm-bun unless ~/.bun/bin/bun; jenv -> java unless a JDK in /usr/lib/jvm).
 * Choices default per toolchain when `choicesById` has no entry.
 */
export async function resolveSelection(
  ids: readonly string[],
  choicesById: ReadonlyMap<string, Choices>,
  probes: Probes,
  catalog: readonly Toolchain[] = defaultCatalog,
): Promise<Selection> {
  const byId = new Map(catalog.map((t) => [t.id, t]));
  for (const id of ids) {
    if (!byId.has(id)) {
      throw new Error(
        `unknown component: ${id} (valid: ${catalog.map((t) => t.id).join(', ')})`,
      );
    }
  }

  const selected = new Set(ids);
  const notes: string[] = [];
  const presence = new Map<string, boolean>();
  const isPresent = async (t: Toolchain): Promise<boolean> => {
    if (!presence.has(t.id))
      presence.set(t.id, t.isPresent ? await t.isPresent(probes) : false);
    return presence.get(t.id) === true;
  };

  // Additions can cascade, so repeat until nothing changes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of catalog) {
      if (!selected.has(t.id)) continue;
      const addons = mergeChoices(defaultsFor(t), choicesById.get(t.id))[
        'addons'
      ];
      for (const [addon, target] of Object.entries(t.addonImplies ?? {})) {
        if (
          Array.isArray(addons) &&
          addons.includes(addon) &&
          !selected.has(target)
        ) {
          selected.add(target);
          notes.push(
            `adding ${target} (selected by the ${t.id} add-on ${addon})`,
          );
          changed = true;
        }
      }
      for (const req of t.requires ?? []) {
        const dep = byId.get(req);
        if (!dep) throw new Error(`${t.id} requires unknown component ${req}`);
        if (selected.has(req) || (await isPresent(dep))) continue;
        selected.add(req);
        notes.push(
          `adding ${req} (required by ${t.id}, not found for ${probes.ctx.user})`,
        );
        changed = true;
      }
    }
  }

  return {
    ids: catalog.map((t) => t.id).filter((id) => selected.has(id)),
    notes,
  };
}
