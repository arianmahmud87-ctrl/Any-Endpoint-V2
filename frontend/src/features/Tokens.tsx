import { Navigate } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFlags, useTokenTotals } from "@/lib/api/hooks";
import type { TokenTotals } from "@/lib/api/types";
import { Empty, ErrorState, LoadingRows, LockedNotice, Page } from "@/components/kit";
import { num } from "@/lib/format";

const INPUT = "#52525b"; // zinc-600
const OUTPUT = "#c7c7cd"; // zinc-300-ish

const axisStyle = { fontSize: 11.5, fill: "#71717a" } as const;

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-[12px] shadow-md">
      {label && <div className="mb-1 font-medium">{label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-muted-foreground">
          <span>{p.name}</span>
          <span className="mono text-foreground">{num(Number(p.value) || 0)}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between gap-4 border-t pt-1 font-medium">
        <span>Total</span>
        <span className="mono">{num(total)}</span>
      </div>
    </div>
  );
}

function DailyChart({ data }: { data: TokenTotals["perDay"] }) {
  const rows = [...data].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="mb-8 rounded-xl border p-4">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
          <XAxis dataKey="date" tick={axisStyle} tickLine={false} axisLine={{ stroke: "#e4e4e7" }} minTickGap={24} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
          <Tooltip content={<ChartTip />} cursor={{ stroke: "#d4d4d8" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={7} />
          <Area type="monotone" dataKey="input" name="Input" stackId="t" stroke={INPUT} fill={INPUT} fillOpacity={0.25} strokeWidth={1.8} animationDuration={800} animationEasing="ease-out" />
          <Area type="monotone" dataKey="output" name="Output" stackId="t" stroke={OUTPUT} fill={OUTPUT} fillOpacity={0.5} strokeWidth={1.8} animationDuration={800} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ModelChart({ data }: { data: TokenTotals["perModel"] }) {
  return (
    <div className="rounded-xl border p-4">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
          <XAxis dataKey="model" tick={{ ...axisStyle, fontFamily: "monospace" }} tickLine={false} axisLine={{ stroke: "#e4e4e7" }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
          <Tooltip content={<ChartTip />} cursor={{ fill: "#f4f4f5" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={7} />
          <Bar dataKey="input" name="Input" fill={INPUT} radius={[4, 4, 0, 0]} barSize={18} animationDuration={700} animationEasing="ease-out" />
          <Bar dataKey="output" name="Output" fill={OUTPUT} radius={[4, 4, 0, 0]} barSize={18} animationDuration={700} animationEasing="ease-out" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Tokens() {
  const q = useTokenTotals();
  const flags = useFlags();
  const data = q.data;
  const hidden = flags.data?.hidden.includes("tokens") || flags.data?.hidden.includes("proxy_access");
  const locked = flags.data?.locked.includes("tokens") || flags.data?.locked.includes("proxy_access");
  if (hidden) return <Navigate to="/app/overview" replace />;
  if (locked) return (
    <Page title="Token Counter">
      <LockedNotice feature="Token Counter" />
    </Page>
  );
  const stats = data
    ? [
        ["Input tokens", num(data.total.input)],
        ["Output tokens", num(data.total.output)],
        ["Combined", num(data.total.input + data.total.output)],
      ]
    : [];
  return (
    <Page title="Token Counter" subtitle="Tokens consumed through the proxy, by day and by model.">
      {q.isLoading ? <LoadingRows n={8} /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : data && (
        <>
          <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
            {stats.map(([k, v]) => (
              <div key={k} className="bg-background p-4">
                <div className="text-[12px] text-muted-foreground">{k}</div>
                <div className="mt-1.5 text-[22px] font-semibold tracking-tight">{v}</div>
              </div>
            ))}
          </div>
          <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">Per day</h2>
          {data.perDay.length === 0 ? <div className="mb-8"><Empty title="No token usage yet" /></div> : <DailyChart data={data.perDay} />}
          <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">Per model</h2>
          {data.perModel.length === 0 ? <Empty title="No token usage yet" /> : <ModelChart data={data.perModel} />}
        </>
      )}
    </Page>
  );
}
