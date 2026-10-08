import clsx from 'clsx';
import { FlaskConical, Gauge, LifeBuoy, LogOut, Menu, Moon, PlusCircle, ShieldCheck, Sun, Timer, Users, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { isStaff, useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useTheme } from '../context/ThemeContext';
import { ErrorBoundary } from './ErrorBoundary';
import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';
import { Avatar, Button } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} className="rounded-lg p-2 text-muted transition hover:bg-surface-2 hover:text-ink" aria-label="Toggle theme">
      {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const { connected } = useRealtime();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const staff = isStaff(user);
  const main: NavItem[] = [
    { to: '/app', label: 'Dashboard', icon: <Gauge className="h-4 w-4" />, end: true },
    { to: '/app/incidents', label: staff ? 'Incidents' : 'My incidents', icon: <LifeBuoy className="h-4 w-4" /> },
    { to: '/app/incidents/new', label: 'Report incident', icon: <PlusCircle className="h-4 w-4" /> },
  ];
  if (staff) main.push({ to: '/app/model', label: 'Model card', icon: <FlaskConical className="h-4 w-4" /> });
  const admin: NavItem[] =
    user?.role === 'admin'
      ? [
          { to: '/app/admin/users', label: 'Users', icon: <Users className="h-4 w-4" /> },
          { to: '/app/admin/sla', label: 'SLA policies', icon: <Timer className="h-4 w-4" /> },
          { to: '/app/admin/audit', label: 'Audit trail', icon: <ShieldCheck className="h-4 w-4" /> },
        ]
      : [];

  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end ?? item.to === '/app/incidents'}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
          isActive ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2 hover:text-ink',
        )
      }
    >
      {item.icon}
      {item.label}
    </NavLink>
  );

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {main.map(link)}
        {admin.length > 0 && (
          <>
            <p className="px-3 pt-5 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">Admin</p>
            {admin.map(link)}
          </>
        )}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={user?.name ?? '?'} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted capitalize">{user?.role}</p>
          </div>
          <button
            className="rounded-lg p-2 text-faint hover:bg-surface-2 hover:text-ink"
            aria-label="Sign out"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full">
      <div className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">
        <aside className="sticky top-0 h-screen">{sidebar}</aside>
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="fade-in absolute inset-y-0 left-0 w-64 border-r border-line bg-surface">
            <button className="absolute top-4 right-3 rounded p-1 text-faint" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Logo withText={false} />
          </div>
          <div className="flex-1" />
          <span
            className={clsx('hidden items-center gap-1.5 text-xs sm:inline-flex', connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-faint')}
            title={connected ? 'Receiving live updates' : 'Live updates paused'}
          >
            <span className={clsx('h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-slate-400')} />
            {connected ? 'Live' : 'Offline'}
          </span>
          <Button size="sm" variant="outline" icon={<PlusCircle className="h-3.5 w-3.5" />} className="hidden sm:inline-flex" onClick={() => navigate('/app/incidents/new')}>
            New incident
          </Button>
          <ThemeToggle />
          <NotificationBell />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
