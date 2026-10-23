import { useState } from "react";
import { useSessions, useAction } from "@/lib/api/hooks";
import { useSession } from "@/auth/session";
import { Btn, ErrorState, LoadingRows, Page } from "@/components/kit";
import { Confirm } from "@/components/Dialogs";
import { relTime } from "@/lib/format";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-10"><h2 className="mb-3 text-[13px] font-medium text-muted-foreground">{title}</h2><div className="divide-y rounded-xl border text-[13px]">{children}</div></section>
);
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex items-center justify-between px-4 py-3"><span className="text-muted-foreground">{k}</span><span>{v}</span></div>;

export function SettingsPage() {
  const { me, logout } = useSession();
  const s = useSessions();
  const [confirm, setConfirm] = useState<boolean>(false);
  const revokeOne = useAction<string>((id) => `/api/auth/sessions/${id}/revoke`, [["sessions"]], { success: "Session ended" });
  return (
    <Page title="Settings">
      <Section title="Account">
        <Row k="Name" v={me?.user.name} />
        <Row k="Email" v={me?.user.email} />
        <Row k="Sign-in" v="Google" />
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
      <Confirm open={confirm} onOpenChange={setConfirm} title="Log out everywhere?" body="Every session, including this one, will be signed out." confirmLabel="Log out all" onConfirm={() => { setConfirm(false); logout(true); }} />
    </Page>
  );
}
