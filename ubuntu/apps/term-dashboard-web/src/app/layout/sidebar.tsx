import { NAV, type NavItem } from '../nav';
import { Link, useRouter } from '../router';
import { cn } from '../../lib/utils';

export interface SidebarFeatures {
  gnomeTerminal: boolean;
  zsh: boolean;
}

interface SidebarNavProps {
  features: SidebarFeatures;
  /** Called after a link is followed (closes the mobile sheet). */
  onNavigate?: () => void;
}

function visible(item: NavItem, features: SidebarFeatures): boolean {
  if (item.requires === 'gnome-terminal') return features.gnomeTerminal;
  if (item.requires === 'zsh') return features.zsh;
  return true;
}

/** The navigation list, shared by the desktop sidebar and the mobile sheet. */
export function SidebarNav({ features, onNavigate }: SidebarNavProps) {
  const { path } = useRouter();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4 px-2 py-3">
      {NAV.map((group, gi) => {
        const items = group.items.filter((i) => visible(i, features));
        if (items.length === 0) return null;
        return (
          <div key={group.label ?? gi} className="flex flex-col gap-0.5">
            {group.label && (
              <p className="px-2 pb-1 font-mono text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active =
                  item.path === '/'
                    ? path === '/'
                    : path === item.path || path.startsWith(`${item.path}/`);
                const Icon = item.icon;
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex min-h-9 items-center gap-2.5 rounded-md px-2 font-mono text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring',
                        active
                          ? 'bg-accent text-link'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'absolute inset-y-1.5 left-0 w-0.5 rounded-full',
                          active ? 'bg-primary' : 'bg-transparent',
                        )}
                      />
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function Brand() {
  return (
    <div className="flex h-12 items-center gap-2 border-b px-4">
      <span
        aria-hidden
        className="inline-flex size-6 items-center justify-center rounded-sm bg-primary font-mono text-xs font-bold text-primary-foreground"
      >
        td
      </span>
      <span className="font-mono text-sm font-semibold">term dashboard</span>
    </div>
  );
}

/** Fixed left sidebar from 768px up; below that the top bar opens a sheet. */
export function Sidebar({ features }: { features: SidebarFeatures }) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-card md:flex">
      <Brand />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav features={features} />
      </div>
    </aside>
  );
}
