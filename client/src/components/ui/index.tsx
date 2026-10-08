import clsx from 'clsx';
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react';
import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

// ------------------------------------------------------------------ Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20 disabled:bg-brand-600/60',
  secondary: 'bg-surface-2 text-ink hover:bg-line/70',
  outline: 'border border-line bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};
const sizes: Record<Size, string> = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-9 px-4 text-sm gap-2', lg: 'h-11 px-6 text-sm gap-2' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ------------------------------------------------------------------ Form fields
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx('field', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx('field min-h-24 resize-y', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx('field cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ Layout bits
export function Card({ className, children, title, action, padded = true }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; padded?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className={clsx(padded && 'p-5')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ className, children, tone = 'neutral', dot }: { className?: string; children: ReactNode; tone?: 'neutral' | 'brand' | 'red' | 'orange' | 'amber' | 'green' | 'blue' | 'slate'; dot?: boolean }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted ring-line',
    brand: 'bg-brand-500/10 text-brand-700 ring-brand-500/20 dark:text-brand-300',
    red: 'bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300',
    orange: 'bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300',
    amber: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300',
    green: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
    blue: 'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300',
    slate: 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300',
  } as const;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-500', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-surface-2', className)} />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-faint">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10 text-red-500">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-ink">Could not load this</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {retry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx('card fade-in w-full max-h-[90vh] overflow-auto', wide ? 'max-w-3xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="rounded p-1 text-faint hover:bg-surface-2 hover:text-ink" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'green' | 'amber'; icon?: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
        {icon && <span className="text-faint">{icon}</span>}
      </div>
      <p
        className={clsx(
          'mt-2 text-3xl font-semibold tracking-tight tabular-nums',
          tone === 'red' && 'text-red-600 dark:text-red-400',
          tone === 'green' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'amber' && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const letters = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs')}
      style={{ background: `hsl(${hue} 55% 48%)` }}
      aria-hidden
    >
      {letters}
    </span>
  );
}
