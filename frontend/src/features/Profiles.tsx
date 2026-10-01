import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Btn, Page } from "@/components/kit";
import { AddCodexProfile, CodexProfiles, SwitcherControl } from "./Codex";

export default function Profiles() {
  const [sp, setSp] = useSearchParams();
  const [adding, setAdding] = useState<boolean>(false);
  const firstSetup = sp.get("first_setup") === "true";
  useEffect(() => {
    if (sp.get("codex") || sp.get("new")) setAdding(true);
    if (sp.get("codex") || sp.get("new")) setSp({}, { replace: true });
  }, [sp, setSp]);
  return (
    <Page title="Profiles" subtitle="Named Codex accounts used for routing. Claude and workers are not part of this workspace." actions={<Btn variant="primary" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" />Add Codex profile</Btn>}>
      {firstSetup && <div className="mb-6 rounded-xl border bg-[hsl(var(--canvas))] p-4 text-[13px]"><span className="font-medium">Welcome.</span> Add a named Codex profile to start routing.</div>}
      <div className="mb-6"><SwitcherControl /></div>
      <CodexProfiles onAdd={() => setAdding(true)} />
      <AddCodexProfile open={adding} onOpenChange={setAdding} />
    </Page>
  );
}

export function ProfileDetail() {
  return <Navigate to="/app/profiles" replace />;
}
