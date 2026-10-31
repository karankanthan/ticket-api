import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState } from './ui/Feedback'

export interface Datum {
  name: string
  value: number
  color: string
}

const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  boxShadow: '0 8px 24px -8px rgb(16 24 40 / 0.18)',
  fontSize: 12,
}

export function DonutChart({ data, centerLabel, height = 220 }: { data: Datum[]; centerLabel?: string; height?: number }) {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (!total) return <EmptyState title="No data yet" description="Nothing to chart for this view." />
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.filter((d) => d.value > 0)} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none" isAnimationActive={false}>
              {data.filter((d) => d.value > 0).map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl font-semibold text-slate-900">{total}</span>
          {centerLabel && <span className="text-xs text-slate-500">{centerLabel}</span>}
        </div>
      </div>
      <Legend data={data} total={total} />
    </div>
  )
}

export function Legend({ data, total }: { data: Datum[]; total: number }) {
  return (
    <ul className="w-full min-w-0 space-y-2">
      {data.map((d) => (
        <li key={d.name} className="flex items-center gap-2 text-sm">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
          <span className="flex-1 truncate text-slate-600">{d.name}</span>
          <span className="tabular font-medium text-slate-900">{d.value}</span>
          <span className="tabular w-10 text-right text-xs text-slate-400">{total ? Math.round((d.value / total) * 100) : 0}%</span>
        </li>
      ))}
    </ul>
  )
}

export function BarsChart({ data, height = 240, layout = 'vertical-bars' }: { data: Datum[]; height?: number; layout?: 'vertical-bars' | 'horizontal-bars' }) {
  if (!data.some((d) => d.value > 0)) return <EmptyState title="No data yet" description="Nothing to chart for this view." />
  const horizontal = layout === 'horizontal-bars'
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, bottom: 0, left: horizontal ? 8 : -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
            </>
          )}
          <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={tooltipStyle} />
          <Bar dataKey="value" name="Count" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
