import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { shortDate } from '../lib/format';

/* Chart styling: recessive grid/axes, 2px lines, 4px rounded bar ends, text in ink tokens. */
const axis = { stroke: 'var(--tx-faint)', fontSize: 11, tickLine: false, axisLine: false } as const;

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted">
          {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 font-medium text-ink tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export function TrendChart({ data }: { data: { date: string; created: number; resolved: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="g-created" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="g-resolved" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--viz-2)" stopOpacity={0.16} />
            <stop offset="100%" stopColor="var(--viz-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="date" tickFormatter={(d: string) => shortDate(d)} minTickGap={24} {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        <Tooltip
          cursor={{ stroke: 'var(--tx-faint)', strokeDasharray: '3 3' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                title={shortDate(String(label))}
                rows={payload.map((p) => ({ label: String(p.name), value: p.value as number, color: p.color }))}
              />
            ) : null
          }
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--tx-muted)', paddingTop: 4 }} />
        <Area type="monotone" name="Created" dataKey="created" stroke="var(--viz-1)" strokeWidth={2} fill="url(#g-created)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--tx-surface)' }} />
        <Area type="monotone" name="Resolved" dataKey="resolved" stroke="var(--viz-2)" strokeWidth={2} fill="url(#g-resolved)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--tx-surface)' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Single-series vertical bars (one hue; categories are named on the axis). */
export function SimpleBars({ data, height = 220, onSelect }: { data: { label: string; value: number; id?: string }[]; height?: number; onSelect?: (id: string) => void }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, left: -18, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="label" {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        <Tooltip
          cursor={{ fill: 'var(--tx-surface-2)' }}
          content={({ active, payload }) =>
            active && payload?.length ? <TooltipBox title={String(payload[0].payload.label)} rows={[{ label: 'Open', value: payload[0].value as number }]} /> : null
          }
        />
        <Bar
          dataKey="value"
          radius={[4, 4, 0, 0]}
          fill="var(--viz-1)"
          label={{ position: 'top', fontSize: 11, fill: 'var(--tx-muted)' }}
          onClick={(bar) => {
            const id = (bar.payload as { id?: string } | undefined)?.id;
            if (id) onSelect?.(id);
          }}
          className={onSelect ? 'cursor-pointer' : undefined}
        >
          {data.map((d) => (
            <Cell key={d.label} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
