import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { LockedNotice, Page } from "@/components/kit";
import { useFlags } from "@/lib/api/hooks";
import { AddCodexProfile, CodexProfiles, SwitcherControl } from "./Codex";

export default function Profiles() {
  const [sp, setSp] = useSearchParams();
  const [adding, setAdding] = useState<boolean>(false);
  const flags = useFlags();
  const locked = flags.data?.locked.includes("profiles") ?? false;
  const hidden = flags.data?.hidden.includes("profiles") ?? false;
  const firstSetup = sp.get("first_setup") === "true";
  useEffect(() => {
    if (sp.get("codex") || sp.get("new")) setAdding(true);
    if (sp.get("codex") || sp.get("new")) setSp({}, { replace: true });
  }, [sp, setSp]);
  if (hidden) return <Navigate to="/app/overview" replace />;
  return (
    <Page title="Profiles">
      {locked ? <LockedNotice feature="Profiles" /> : (<>
      {firstSetup && <div className="mb-6 rounded-xl border bg-[hsl(var(--canvas))] p-4 text-[13px]"><span className="font-medium">Welcome.</span> Add a profile to start routing.</div>}
      <div className="mb-6"><SwitcherControl /></div>
      <CodexProfiles onAdd={() => setAdding(true)} />
      <AddCodexProfile open={adding} onOpenChange={setAdding} />
      </>)}
    </Page>
  );
}

export function ProfileDetail() {
  return <Navigate to="/app/profiles" replace />;
}
