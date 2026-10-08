import clsx from 'clsx';

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-brand-600" />
        <path d="M9 10h14M16 10v13M11 17l5 6 5-6" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withText && (
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          Triage<span className="text-brand-600 dark:text-brand-400">X</span>
        </span>
      )}
    </span>
  );
}
