import { ArrowRight, BrainCircuit, Clock3, GitBranch, Link2, Radio, Scale, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '../components/AppLayout';
import { PriorityBadge, SlaBadge, SlaBar, StatusBadge, ConfidenceBar } from '../components/badges';
import { Logo } from '../components/Logo';
import { Badge, Button } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <BrainCircuit className="h-5 w-5" />,
    title: 'AI triage with visible confidence',
    body: 'Every new ticket gets a suggested priority and category, an SLA-breach risk and similar past incidents. Each signal is shown, so agents can see why.',
  },
  {
    icon: <Clock3 className="h-5 w-5" />,
    title: 'SLA engine that acts',
    body: 'Per-priority targets, a background scanner that flags at-risk tickets, escalates breaches and pages the right people automatically.',
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: 'Tamper-evident audit trail',
    body: 'Every change is appended to a SHA-256 hash chain with signed checkpoints. One click verifies the history and points at the first altered entry.',
  },
  {
    icon: <Scale className="h-5 w-5" />,
    title: 'Load-aware assignment',
    body: 'A priority queue hands the most urgent work to the least-loaded agent, weighting a P1 eight times a P4.',
  },
  {
    icon: <Radio className="h-5 w-5" />,
    title: 'Live by default',
    body: 'Queues, dashboards, comments and the notification bell update over WebSockets the moment something changes.',
  },
  {
    icon: <GitBranch className="h-5 w-5" />,
    title: 'Grounded in real data',
    body: 'Risk models are trained on the public UCI incident event log (24,918 incidents) with leakage controls and published metrics.',
  },
];

function ChainVisual() {
  const blocks = [
    { seq: 41, action: 'incident.created', hash: '9f2c…e81a' },
    { seq: 42, action: 'incident.assign', hash: '3b7d…0c44' },
    { seq: 43, action: 'sla.breached', hash: 'c11e…7f9b' },
  ];
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      {blocks.map((b, i) => (
        <div key={b.seq} className="flex items-center gap-2 sm:flex-1">
          <div className="card flex-1 p-3 font-mono text-[11px]">
            <div className="flex justify-between text-faint">
              <span>#{b.seq}</span>
              <span>sha256</span>
            </div>
            <p className="mt-1 truncate text-ink">{b.action}</p>
            <p className="truncate text-brand-600 dark:text-brand-400">{b.hash}</p>
          </div>
          {i < blocks.length - 1 && <Link2 className="hidden h-4 w-4 shrink-0 text-faint sm:block" />}
        </div>
      ))}
    </div>
  );
}

function ProductPreview() {
  const rows = [
    { n: 'INC-00141', t: 'Checkout outage - payments failing', p: 1 as const, s: 'in_progress' as const, sla: 'at_risk' as const, prog: 82 },
    { n: 'INC-00139', t: 'VPN disconnects for Pune staff', p: 2 as const, s: 'assigned' as const, sla: 'on_track' as const, prog: 34 },
    { n: 'INC-00137', t: 'Replication lag on db-replica-02', p: 2 as const, s: 'new' as const, sla: 'breached' as const, prog: 100 },
  ];
  return (
    <div className="card overflow-hidden shadow-2xl shadow-brand-900/10">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 text-xs text-faint">triagex / incidents</span>
      </div>
      <div className="grid gap-0 md:grid-cols-[1fr_260px]">
        <div className="divide-y divide-line">
          {rows.map((r) => (
            <div key={r.n} className="flex items-center gap-3 px-4 py-3">
              <PriorityBadge priority={r.p} compact />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.t}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="font-mono text-[11px] text-faint">{r.n}</span>
                  <div className="w-24">
                    <SlaBar progress={r.prog} state={r.sla} />
                  </div>
                </div>
              </div>
              <div className="hidden flex-col items-end gap-1 sm:flex">
                <StatusBadge status={r.s} />
                <SlaBadge state={r.sla} />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-3 border-t border-line bg-surface-2/50 p-4 md:border-t-0 md:border-l">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">AI triage</p>
          <div className="flex items-center gap-2">
            <PriorityBadge priority={1} />
            <Badge tone="brand">software</Badge>
          </div>
          <ConfidenceBar value={0.87} label="Priority confidence" />
          <ConfidenceBar value={0.71} label="SLA breach risk" />
          <p className="text-[11px] text-faint">Signals: ITIL matrix, 4 similar incidents, keywords "outage", "payments failing".</p>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="ml-6 hidden gap-6 text-sm text-muted md:flex">
            <a href="#features" className="hover:text-ink">
              Features
            </a>
            <a href="#audit" className="hover:text-ink">
              Audit trail
            </a>
            <a href="#research" className="hover:text-ink">
              Research
            </a>
          </nav>
          <div className="flex-1" />
          <ThemeToggle />
          {user ? (
            <Link to="/app">
              <Button size="sm">Open app</Button>
            </Link>
          ) : (
            <>
              <Link to="/login" className="hidden text-sm font-medium text-muted hover:text-ink sm:block">
                Sign in
              </Link>
              <Link to="/login">
                <Button size="sm">Try the demo</Button>
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0 -z-10 opacity-60" />
        <div className="glow pointer-events-none absolute inset-0 -z-10" />
        <div className="mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <Badge tone="brand" className="mb-5">
              Incident management, with receipts
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Resolve incidents faster. <span className="text-brand-600 dark:text-brand-400">Prove</span> what happened.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted">
              TriageX triages new tickets with machine learning, enforces SLAs in the background and records every change in a hash-chained audit log anyone can verify.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to={user ? '/app' : '/login'}>
                <Button size="lg" icon={<ArrowRight className="h-4 w-4" />}>
                  {user ? 'Go to dashboard' : 'Explore the live demo'}
                </Button>
              </Link>
              <a href="https://github.com/Chetanareddy18/triagex" target="_blank" rel="noreferrer">
                <Button size="lg" variant="outline">
                  View source
                </Button>
              </a>
            </div>
            <p className="mt-4 text-xs text-faint">Demo accounts for admin, agent and reporter are one click away on the sign-in page.</p>
          </div>
          <div className="mx-auto mt-16 max-w-5xl">
            <ProductPreview />
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-semibold tracking-tight">Everything an on-call team needs, nothing it does not</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-muted">Built as a full stack: React and TypeScript on the front, Node, Express and MongoDB behind, a Python model service on the side.</p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6 transition hover:-translate-y-0.5 hover:shadow-lg">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">{f.icon}</div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="audit" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <Badge tone="green" className="mb-4">
              Integrity you can check
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight">An audit log that notices when it is edited</h2>
            <p className="mt-4 text-muted">
              Each entry stores the hash of the previous one: <code className="kbd">hash = SHA-256(prevHash + canonical(entry))</code>. Change a single field in the database and verification fails at exactly that entry.
              Signed checkpoints catch a full rewrite of the chain.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-muted">
              <li>- Append-only at the application layer</li>
              <li>- Admin "Verify integrity" pinpoints the first tampered sequence number</li>
              <li>- Head hash ready to anchor externally (for example on-chain)</li>
            </ul>
          </div>
          <ChainVisual />
        </div>
      </section>

      <section id="research" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="card grid gap-8 p-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Research-backed, honestly reported</h2>
            <p className="mt-3 text-muted">
              Models are trained on the UCI "Incident management process enriched event log" (141,712 events). Features come only from the first event of each ticket, the split is chronological, and every
              model is compared against simple baselines. The in-app model card shows the numbers and their limits.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            {[
              ['24,918', 'incidents'],
              ['3', 'prediction tasks'],
              ['80/20', 'time-based split'],
              ['0', 'post-open features'],
            ].map(([v, l]) => (
              <div key={l} className="rounded-lg bg-surface-2 p-4">
                <p className="text-2xl font-semibold tabular-nums">{v}</p>
                <p className="text-xs text-muted">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <Logo />
          <p>Built by Palla Chetana Reddy. MIT licensed.</p>
        </div>
      </footer>
    </div>
  );
}
