import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { useCodexCredentials, useSettings, useSummary, useUsage } from "@/lib/api/hooks";
import { SwitcherControl } from "./Codex";
import { ErrorState, LoadingRows, Page, Tag } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";
import { num, relTime } from "@/lib/format";

export default function Overview() {
  const s = useSummary();
  const u = useUsage(8);
  const codex = useCodexCredentials();
  const settings = useSettings();
  const creds = codex.data ?? [];
  const routing = [
    ["Codex profiles", String(creds.length)],
    ["Active", String(creds.filter((c) => c.status === "active").length)],
    ["Disabled", String(creds.filter((c) => c.status === "disabled").length)],
    ["Intelligent Switcher", settings.data ? (settings.data.intelligent_switcher ? "ON" : "OFF") : "…"],
  ];
  const stats = s.data
    ? [
        ["Active key", s.data.active_keys ? "Ready" : "Missing"],
        ["Requests 24h", num(s.data.requests_24h)],
        ["Failures 24h", num(s.data.failures_24h)],
      ]
    : [];
  return (
    <Page
      title="Overview"
      subtitle="System health at a glance."
      actions={[["Open Playground", "/app/playground"], ["Add Codex profile", "/app/profiles?codex=1"], ["API key", "/app/keys"]].map(([l, to]) => (
        <Link key={to} to={to} className="inline-flex h-8 items-center gap-1 rounded-lg bg-secondary px-3 text-[13px] font-medium hover:bg-accent">{l}<ArrowUpRight className="h-3 w-3" /></Link>
      ))}
    >
      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
        {routing.map(([k, v]) => (
          <div key={k} className="bg-background p-4">
            <div className="text-[12px] text-muted-foreground">{k}</div>
            <div className="mt-1.5 text-[22px] font-semibold tracking-tight">{codex.isLoading || settings.isLoading ? "…" : v}</div>
          </div>
        ))}
      </div>
      <div className="mb-8"><SwitcherControl /></div>
      {s.isError ? <ErrorState error={s.error} retry={s.refetch} /> : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
          {(s.isLoading ? Array.from({ length: 4 }, () => ["", ""]) : stats).map(([k, v], i) => (
            <div key={i} className="bg-background p-4">
              {s.isLoading ? <Skeleton className="h-12" /> : <>
                <div className="text-[12px] text-muted-foreground">{k}</div>
                <div className="mt-1.5 text-[22px] font-semibold tracking-tight">{v}</div>
              </>}
            </div>
          ))}
        </div>
      )}
      <h2 className="mb-3 mt-10 text-[13px] font-medium text-muted-foreground">Recent requests</h2>
      {u.isLoading ? <LoadingRows n={4} /> : u.isError ? <ErrorState error={u.error} retry={u.refetch} /> : (
        <div className="divide-y rounded-xl border">
          {u.data!.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className={r.status_code >= 400 ? "mono text-destructive" : "mono text-muted-foreground"}>{r.status_code}</span>
              <span className="mono flex-1 truncate">{r.route}</span>
              <Tag>{r.model}</Tag>
              <span className="w-16 text-right text-muted-foreground">{r.latency_ms}ms</span>
              <span className="hidden w-16 text-right text-muted-foreground sm:block">{relTime(r.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
