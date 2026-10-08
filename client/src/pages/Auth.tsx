import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ThemeToggle } from '../components/AppLayout';
import { Logo } from '../components/Logo';
import { Button, Field, Input } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';

const DEMO = [
  { role: 'Admin', email: 'admin@triagex.dev' },
  { role: 'Agent', email: 'agent@triagex.dev' },
  { role: 'Reporter', email: 'reporter@triagex.dev' },
];
export const DEMO_PASSWORD = 'Demo@1234';

function Shell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div className="glow pointer-events-none absolute inset-0 -z-10" />
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Link to="/" className="mb-8">
        <Logo />
      </Link>
      <div className="card w-full max-w-sm p-7">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
      <div className="mt-6 text-sm text-muted">{footer}</div>
    </div>
  );
}

export function Login() {
  const { login, user, ready } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  if (ready && user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent, override?: { email: string; password: string }) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(override?.email ?? email, override?.password ?? password);
      toast.success(`Welcome back, ${u.name.split(' ')[0]}`);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Sign in"
      subtitle="Access your incident workspace."
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Create an account
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <div className="mt-6 border-t border-line pt-5">
        <p className="mb-2 text-xs font-medium tracking-wide text-faint uppercase">Try a demo account</p>
        <div className="grid grid-cols-3 gap-2">
          {DEMO.map((d) => (
            <Button
              key={d.email}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={(e) => {
                setEmail(d.email);
                setPassword(DEMO_PASSWORD);
                void submit(e as unknown as FormEvent, { email: d.email, password: DEMO_PASSWORD });
              }}
            >
              {d.role}
            </Button>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function Register() {
  const { register, user, ready } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (ready && user) return <Navigate to="/app" replace />;

  const passwordOk = form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /\d/.test(form.password);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form.name, form.email, form.password);
      toast.success('Account created');
      navigate('/app/incidents/new');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      title="Create your account"
      subtitle="Report incidents and follow them to resolution."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Full name" htmlFor="name">
          <Input id="name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
        </Field>
        <Field label="Work email" htmlFor="remail">
          <Input id="remail" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>
        <Field label="Password" htmlFor="rpass" hint="At least 8 characters with a letter and a digit.">
          <Input id="rpass" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <Button type="submit" className="w-full" loading={busy} disabled={!passwordOk || !form.name || !form.email} icon={<ArrowRight className="h-4 w-4" />}>
          Create account
        </Button>
      </form>
    </Shell>
  );
}
