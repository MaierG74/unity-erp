import { useState, type ReactNode } from 'react';
import { DraftingCompass, Menu, X } from 'lucide-react';

interface AppShellProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function AppShell({ sidebar, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden rounded-lg border bg-background shadow-sm">
      {/* Mobile hamburger */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute left-3 top-3 z-50 inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } absolute z-40 h-full w-80 shrink-0 border-r bg-card shadow-sm transition-transform duration-200 md:relative md:translate-x-0`}
      >
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <DraftingCompass className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">RoomCraft</h1>
            <p className="truncate text-xs text-muted-foreground">Room layout workspace</p>
          </div>
        </div>
        <div className="min-h-0 p-4" style={{ height: 'calc(100% - 3.5rem)' }}>
          {sidebar}
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="absolute inset-0 z-30 bg-black/20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main canvas area */}
      <main className="relative flex-1 overflow-hidden bg-muted/20">
        {children}
      </main>
    </div>
  );
}

