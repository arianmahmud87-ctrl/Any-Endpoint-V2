import { useState } from "react";
import { useAdminFlags, useAdminUsers, useRevokeAdminSession, useSetFlag } from "@/lib/api/hooks";
import type { AdminSession, FeatureKey } from "@/lib/api/types";
import { Btn, Empty, ErrorState, LoadingRows, Page, Table, Tag } from "@/components/kit";
import { Confirm } from "@/components/Dialogs";
import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { num, relTime } from "@/lib/format";

const FEATURES: { key: FeatureKey; label: string }[] = [
  { key: "playground", label: "Playground" },
  { key: "api_keys", label: "API Keys" },
  { key: "profiles", label: "Profiles" },
  { key: "proxy_access", label: "Proxy Access" },
  { key: "intelligent_switcher", label: "Intelligent Switcher" },
  { key: "tokens", label: "Token Counter" },
];

function Users() {
  const q = useAdminUsers();
  const revoke = useRevokeAdminSession();
  const [target, setTarget] = useState<AdminSession | null>(null);
  if (q.isLoading) return <LoadingRows n={5} />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!q.data?.length) return <Empty title="No users" />;
  return (
    <>
      <Table head={["User", "Role", "Sessions", "Keys / Credentials / Requests"]}>
        {q.data.map((u) => (
          <tr key={u.id} className="align-top">
            <td className="px-4 py-2.5">
              <div className="font-medium">{u.name}</div>
              <div className="text-[12px] text-muted-foreground">{u.email}</div>
            </td>
            <td className="px-4 py-2.5"><Tag>{u.role}</Tag></td>
            <td className="px-4 py-2.5">
              {u.sessions.length === 0 ? (
                <span className="text-[12px] text-muted-foreground">None</span>
              ) : (
                <div className="space-y-1.5">
                  {u.sessions.map((s) => (
                    <div key={s.id} className="flex items-center gap-3">
                      <span>
                        <span className="text-[12.5px]">{s.device}</span>
                        <span className="block text-[11.5px] text-muted-foreground">{s.ip} · {relTime(s.last_seen_at)}</span>
                      </span>
                      <Btn className="h-6 px-2 text-[11.5px]" onClick={() => setTarget(s)}>Revoke</Btn>
                    </div>
                  ))}
                </div>
              )}
            </td>
            <td className="mono whitespace-nowrap px-4 py-2.5 text-[12px] text-muted-foreground">
              {num(u.counts.api_keys)} / {num(u.counts.credentials)} / {num(u.counts.usage_logs)}
            </td>
          </tr>
        ))}
      </Table>
      <Confirm
        open={!!target}
        onOpenChange={(o) => { if (!o) setTarget(null); }}
        title="Revoke this session?"
        body={target ? `${target.device} · ${target.ip} will be signed out immediately.` : ""}
        confirmLabel="Revoke"
        busy={revoke.isPending}
        onConfirm={() => target && revoke.mutate(target.id, { onSettled: () => setTarget(null) })}
      />
    </>
  );
}

function FeatureLocks() {
  const q = useAdminFlags();
  const setFlag = useSetFlag();
  if (q.isLoading) return <LoadingRows n={4} />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const rows = new Map((q.data ?? []).map((f) => [f.key, f]));
  return (
    <div className="divide-y rounded-xl border text-[13px]">
      {FEATURES.map((f) => {
        const row = rows.get(f.key);
        const isLocked = row?.locked ?? false;
        const isHidden = row?.hidden ?? false;
        const busy = setFlag.isPending;
        return (
          <div key={f.key} className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="flex items-center gap-2.5">
              {f.label}
              <Tag>{isLocked ? "Locked" : "Unlocked"}</Tag>
              {isHidden && <Tag>Hidden</Tag>}
            </span>
            <span className="flex items-center gap-2">
              <Btn
                variant={isHidden ? "primary" : "outline"}
                disabled={busy}
                onClick={() => setFlag.mutate({ key: f.key, hidden: !isHidden })}
              >
                {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {isHidden ? "Show" : "Hide"}
              </Btn>
              <Btn
                variant={isLocked ? "danger" : "outline"}
                disabled={busy}
                onClick={() => setFlag.mutate({ key: f.key, locked: !isLocked })}
              >
                {isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {isLocked ? "Unlock" : "Lock"}
              </Btn>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Controller() {
  return (
    <Page title="Controller" subtitle="Organization administration. Visible to admins only.">
      <Tabs defaultValue="users">
        <TabsList className="mb-6 h-9 gap-1 rounded-lg border bg-background p-1">
          <TabsTrigger value="users" className="h-7 rounded-md px-3 text-[13px] font-normal text-muted-foreground shadow-none transition data-[state=active]:bg-secondary data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none">Users</TabsTrigger>
          <TabsTrigger value="flags" className="h-7 rounded-md px-3 text-[13px] font-normal text-muted-foreground shadow-none transition data-[state=active]:bg-secondary data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none">Feature Locks</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-0">
          <Users />
        </TabsContent>
        <TabsContent value="flags" className="mt-0">
          <p className="mb-3 text-[12.5px] text-muted-foreground">Locked features stay visible but show members a notice and block their use. Hidden features disappear from the navigation and their endpoints refuse requests.</p>
          <FeatureLocks />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
