import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Database, FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Card, ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import { api } from '../lib/api';

type ModelScores = Record<string, Record<string, number>>;
interface FeatureSet {
  features: string[];
  models: ModelScores;
  selected_on_validation?: string;
}
interface Metrics {
  generated_at: string;
  dataset: { name: string; events: number; incidents: number; opened_range: [string, string] };
  split: { method: string; train: number; test: number; test_starts_at: string };
  leakage_controls: { feature_source: string; target_source: string; excluded_columns: Record<string, string> };
  tasks: {
    priority: { features: string[]; models: ModelScores; itil_matrix_lookup_accuracy: number; label_distribution_test: Record<string, number> };
    sla_breach: { positive_rate_test: number; feature_sets: Record<string, FeatureSet> };
    resolution_time: { n_test: number; test_median_hours: number; feature_sets: Record<string, FeatureSet> };
  };
  deployed_models: Record<string, string>;
  environment: { python: string; scikit_learn: string; seed: number };
}

const NAMES: Record<string, string> = {
  majority: 'Majority class',
  median: 'Median',
  logistic_regression: 'Logistic regression',
  ridge_regression: 'Ridge regression',
  gradient_boosting: 'Gradient boosting',
};

function ScoreTable({ models, columns, best, lowerIsBetter, selected }: { models: ModelScores; columns: [string, string][]; best: string; lowerIsBetter?: boolean; selected?: string }) {
  const values = Object.values(models).map((m) => m[best]);
  const top = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-faint uppercase">
            <th className="py-2 pr-4 font-medium">Model</th>
            {columns.map(([, label]) => (
              <th key={label} className="py-2 pr-4 text-right font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {Object.entries(models).map(([name, scores]) => (
            <tr key={name}>
              <td className="py-2 pr-4">
                {NAMES[name] ?? name}
                {selected === name && (
                  <Badge tone="brand" className="ml-2">
                    deployed
                  </Badge>
                )}
              </td>
              {columns.map(([key]) => (
                <td key={key} className={`py-2 pr-4 text-right tabular-nums ${key === best && scores[key] === top ? 'font-semibold text-ink' : 'text-muted'}`}>
                  {scores[key]?.toFixed(key.includes('hours') ? 1 : 3) ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
      }
    >
      {children}
    </Card>
  );
}

export default function ModelCard() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['ml-metrics'], queryFn: () => api<Metrics>('/api/ml/metrics'), staleTime: Infinity });
  return (
    <div className="fade-in">
      <PageHeader title="Model card" description="How the triage models were trained and how well they do. Numbers are read live from the ML service's metrics.json." />
      {isLoading ? (
        <LoadingBlock rows={8} />
      ) : error || !data ? (
        <Card>
          <ErrorState error={error ?? new Error('No metrics')} retry={refetch} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            {[
              ['Events', data.dataset.events.toLocaleString()],
              ['Incidents', data.dataset.incidents.toLocaleString()],
              ['Train / test', `${data.split.train.toLocaleString()} / ${data.split.test.toLocaleString()}`],
              ['Trained', new Date(data.generated_at).toLocaleDateString()],
            ].map(([l, v]) => (
              <div key={l} className="card p-4">
                <p className="text-xs text-muted uppercase">{l}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>

          <Section title="Data and leakage controls" icon={<Database className="h-4 w-4 text-faint" />}>
            <div className="grid gap-6 text-sm md:grid-cols-2">
              <div className="space-y-2 text-muted">
                <p>
                  <span className="font-medium text-ink">{data.dataset.name}.</span> Opened between {data.dataset.opened_range[0].slice(0, 10)} and {data.dataset.opened_range[1].slice(0, 10)}.
                </p>
                <p>Split: {data.split.method}; test window starts {data.split.test_starts_at.slice(0, 10)}.</p>
                <p>Features: {data.leakage_controls.feature_source}. Targets: {data.leakage_controls.target_source}.</p>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-faint uppercase">Columns never used as features</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(data.leakage_controls.excluded_columns).map(([c, why]) => (
                    <span key={c} title={why}>
                      <Badge>{c}</Badge>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="SLA breach prediction (ROC-AUC)" icon={<FlaskConical className="h-4 w-4 text-faint" />}>
              <p className="mb-4 text-sm text-muted">Breach rate in the test window: {(data.tasks.sla_breach.positive_rate_test * 100).toFixed(1)}%.</p>
              {Object.entries(data.tasks.sla_breach.feature_sets).map(([set, fs]) => (
                <div key={set} className="mb-5 last:mb-0">
                  <p className="mb-1 text-xs font-medium text-faint uppercase">{set === 'full' ? 'Full open-time features' : 'App-compatible features (deployed)'}</p>
                  <ScoreTable models={fs.models} best="roc_auc" columns={[['roc_auc', 'AUC'], ['brier', 'Brier'], ['f1_at_0_5', 'F1@0.5']]} selected={set === 'app_compatible' ? fs.selected_on_validation : undefined} />
                </div>
              ))}
            </Section>

            <Section title="Resolution time (MAE, hours)" icon={<FlaskConical className="h-4 w-4 text-faint" />}>
              <p className="mb-4 text-sm text-muted">
                Median resolution time in the test window: {data.tasks.resolution_time.test_median_hours} h ({data.tasks.resolution_time.n_test.toLocaleString()} resolved incidents). Heavy-tailed target.
              </p>
              {Object.entries(data.tasks.resolution_time.feature_sets).map(([set, fs]) => (
                <div key={set} className="mb-5 last:mb-0">
                  <p className="mb-1 text-xs font-medium text-faint uppercase">{set === 'full' ? 'Full open-time features' : 'App-compatible features (deployed)'}</p>
                  <ScoreTable models={fs.models} best="mae_hours" lowerIsBetter columns={[['mae_hours', 'MAE'], ['median_ae_hours', 'Median AE']]} selected={set === 'app_compatible' ? fs.selected_on_validation : undefined} />
                </div>
              ))}
            </Section>
          </div>

          <Section title="Priority classification (macro-F1)" icon={<FlaskConical className="h-4 w-4 text-faint" />}>
            <div className="grid gap-6 md:grid-cols-[1fr_320px]">
              <ScoreTable models={data.tasks.priority.models} best="macro_f1" columns={[['macro_f1', 'Macro-F1'], ['accuracy', 'Accuracy']]} />
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p>
                  In this dataset priority is a fixed function of impact and urgency (the ITIL matrix reproduces it with {(data.tasks.priority.itil_matrix_lookup_accuracy * 100).toFixed(1)}% accuracy), so those two fields are
                  excluded here. Accuracy is misleading because {((data.tasks.priority.label_distribution_test['3 - Moderate'] ?? 0) * 100).toFixed(0)}% of tickets are P3 - macro-F1 is the headline metric. In the app,
                  priority suggestions combine the ITIL matrix, similar-incident votes and keywords instead.
                </p>
              </div>
            </div>
          </Section>

          <p className="text-xs text-faint">
            scikit-learn {data.environment.scikit_learn}, Python {data.environment.python}, seed {data.environment.seed}. Full write-up in docs/RESEARCH.md.
          </p>
        </div>
      )}
    </div>
  );
}
