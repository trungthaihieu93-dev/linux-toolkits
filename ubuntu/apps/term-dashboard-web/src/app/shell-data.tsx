import type { Health, TerminalInventory } from '@linux-toolchain/term-config';
import { createContext, useContext, type ReactNode } from 'react';
import { useResource, type Resource } from '../lib/api';

type Loaded<T> = Resource<T> & { reload: () => void };

interface ShellData {
  health: Loaded<Health>;
  inventory: Loaded<TerminalInventory>;
}

const ShellDataContext = createContext<ShellData | null>(null);

/** Health (td version) and inventory, loaded once and shared by the frame. */
export function ShellDataProvider({ children }: { children: ReactNode }) {
  const health = useResource((api) => api.health());
  const inventory = useResource((api) => api.inventory());
  return (
    <ShellDataContext.Provider value={{ health, inventory }}>
      {children}
    </ShellDataContext.Provider>
  );
}

export function useShellData(): ShellData {
  const ctx = useContext(ShellDataContext);
  if (!ctx) throw new Error('missing <ShellDataProvider>');
  return ctx;
}

export function useInventory(): Loaded<TerminalInventory> {
  return useShellData().inventory;
}
