import {
  ArchiveIcon,
  GhostIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  SquareTerminalIcon,
  TerminalIcon,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Shown only when the inventory reports it (GNOME Terminal, zsh). */
  requires?: 'gnome-terminal' | 'zsh';
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { items: [{ path: '/', label: 'Overview', icon: LayoutDashboardIcon }] },
  {
    label: 'Terminals',
    items: [
      { path: '/ghostty', label: 'Ghostty', icon: GhostIcon },
      { path: '/ptyxis', label: 'Ptyxis', icon: MonitorIcon },
      {
        path: '/gnome-terminal',
        label: 'GNOME Terminal',
        icon: MonitorIcon,
        requires: 'gnome-terminal',
      },
    ],
  },
  {
    label: 'Shells',
    items: [
      { path: '/shells/bash', label: 'bash', icon: SquareTerminalIcon },
      {
        path: '/shells/zsh',
        label: 'zsh',
        icon: SquareTerminalIcon,
        requires: 'zsh',
      },
    ],
  },
  {
    label: 'Tools',
    items: [
      { path: '/terminal', label: 'Terminal', icon: TerminalIcon },
      { path: '/backups', label: 'Backups', icon: ArchiveIcon },
    ],
  },
];

/** The nav item that owns `path` (exact match, or the longest prefix). */
export function findNavItem(path: string): NavItem | undefined {
  const items = NAV.flatMap((g) => g.items);
  return (
    items.find((i) => i.path === path) ??
    items
      .filter((i) => i.path !== '/' && path.startsWith(`${i.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0]
  );
}
