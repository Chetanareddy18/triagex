import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-brand-600 dark:text-brand-400">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-muted">The page you are looking for does not exist or was moved.</p>
      <Link to="/app" className="mt-6">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}
