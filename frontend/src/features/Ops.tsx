import { useState } from "react";
import { useSessions, useUsage, useAction } from "@/lib/api/hooks";
import { useSession } from "@/auth/session";
import { Btn, Dot, Empty, ErrorState, LoadingRows, Page, Table, Tag } from "@/components/kit";
import { Confirm } from "@/components/Dialogs";
import { cn } from "@/lib/utils";
import { relTime } from "@/lib/format";
import { SwitcherControl } from "./Codex";

export function Usage() {
  const q = useUsage(100);
  const [errorsOnly, setErrorsOnly] = useState<boolean>(false);
  const rows = (q.data ?? []).filter((r) => !errorsOnly || r.status_code >= 400);
  return (
    <Page title="Usage" subtitle="Request metadata only. Prompts and responses are never recorded here.">
      <div className="mb-4 flex gap-1">
        {[["All", false], ["Errors", true]].map(([l, v]) => (
          <button key={String(l)} onClick={() => setErrorsOnly(v as boolean)} className={cn("h-7 rounded-lg px-2.5 text-[13px] text-muted-foreground", errorsOnly === v && "bg-secondary font-medium text-foreground")}>{l}</button>
        ))}
      </div>
      {q.isLoading ? <LoadingRows n={8} /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : !rows.length ? <Empty title="No requests yet" /> : (
        <Table head={["Time", "Route", "Model", "Status", "Latency", "Profile", "Key"]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{relTime(r.created_at)}</td>
              <td className="mono whitespace-nowrap px-4 py-2.5 text-[12px]">{r.route}</td>
              <td className="px-4 py-2.5"><Tag>{r.model}</Tag></td>
              <td className={cn("mono px-4 py-2.5 text-[12px]", r.status_code >= 400 && "text-destructive")}>{r.status_code}</td>
              <td className="whitespace-nowrap px-4 py-2.5">{r.latency_ms} ms</td>
              <td className="whitespace-nowrap px-4 py-2.5">{r.profile_label}</td>
              <td className="mono px-4 py-2.5 text-[12px] text-muted-foreground">{r.key_prefix ? `${r.key_prefix}…` : "session"}</td>
            </tr>
          ))}
        </Table>
      )}
    </Page>
  );
}

export function SettingsPage() {
  const { me, logout } = useSession();
  const s = useSessions();
  const [confirm, setConfirm] = useState<boolean>(false);
  const revokeOne = useAction<string>((id) => `/api/auth/sessions/${id}/revoke`, [["sessions"]], { success: "Session ended" });
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="mb-10"><h2 className="mb-3 text-[13px] font-medium text-muted-foreground">{title}</h2><div className="divide-y rounded-xl border text-[13px]">{children}</div></section>
  );
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex items-center justify-between px-4 py-3"><span className="text-muted-foreground">{k}</span><span>{v}</span></div>;
  return (
    <Page title="Settings">
      <section className="mb-10">
        <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">Request routing</h2>
        <SwitcherControl />
      </section>
      <Section title="Account">
        <Row k="Name" v={me?.user.name} />
        <Row k="Email" v={me?.user.email} />
        <Row k="Sign-in" v="Google" />
      </Section>
      <Section title="Organization">
        <Row k="Name" v={me?.organization.name} />
        <Row k="Your role" v={<Tag>{me?.role}</Tag>} />
      </Section>
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-muted-foreground">Active sessions</h2>
          <Btn variant="danger" onClick={() => setConfirm(true)}>Log out all sessions</Btn>
        </div>
        {s.isLoading ? <LoadingRows n={2} /> : s.isError ? <ErrorState error={s.error} retry={s.refetch} /> : (
          <div className="divide-y rounded-xl border text-[13px]">
            {s.data!.map((x) => (
              <div key={x.id} className="flex items-center justify-between px-4 py-3">
                <div><div className="font-medium">{x.device}{x.current && <span className="ml-2 text-[11.5px] font-normal text-muted-foreground">This device</span>}</div><div className="text-[12px] text-muted-foreground">{x.ip} · {relTime(x.last_seen)}</div></div>
                {!x.current && <Btn onClick={() => revokeOne.mutate(x.id)}>End</Btn>}
              </div>
            ))}
          </div>
        )}
      </section>
      <Section title="Security & environment">
        <Row k="Environment" v={<Tag>{me?.environment}</Tag>} />
        <Row k="Session storage" v="HttpOnly cookie" />
        <Row k="Prompt retention" v="Not stored in browser" />
      </Section>
      <Confirm open={confirm} onOpenChange={setConfirm} title="Log out everywhere?" body="Every session, including this one, will be signed out." confirmLabel="Log out all" onConfirm={() => { setConfirm(false); logout(true); }} />
    </Page>
  );
}
