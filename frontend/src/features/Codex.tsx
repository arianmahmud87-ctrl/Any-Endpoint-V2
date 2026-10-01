import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { useAction, useCodexCredentials, useSettings } from "@/lib/api/hooks";
import { ApiError, type CodexCredential } from "@/lib/api/types";
import { Btn, Dot, Empty, ErrorState, Field, inputCls, LoadingRows } from "@/components/kit";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { relTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const LABEL_LIMIT = 64;
const AUTH_LIMIT = 256_000;
const INV = [["codex"], ["summary"]];

/** Client check before the file ever leaves the form. The server repeats it. */
function validateAuth(text: string): string | null {
  if (!text.trim()) return "Upload auth.json or paste its contents.";
  if (text.length > AUTH_LIMIT) return "File must be 256 KB or smaller.";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "File must be valid JSON.";
  }
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const tokens = obj?.tokens && typeof obj.tokens === "object" ? (obj.tokens as Record<string, unknown>) : null;
  const refresh = tokens?.refresh_token;
  const access = tokens?.access_token ?? obj?.access_token;
  if (typeof refresh !== "string" || !refresh.trim() || typeof access !== "string" || !access.trim()) {
    return "Missing tokens.refresh_token and tokens.access_token.";
  }
  return null;
}

function useSwitcher() {
  const q = useSettings();
  const set = useAction<boolean>(() => "/api/user/settings/intelligent-switcher", [["settings"]], {
    method: "PATCH",
    body: (enabled) => ({ enabled }),
  });
  const on = q.data?.intelligent_switcher ?? false;
  const toggle = () => set.mutate(!on, { onSuccess: () => toast(on ? "Failover turned off" : "Failover enabled") });
  return { q, set, on, toggle };
}

/** Pressable failover control. The knob slides; the label updates in place. */
export function SwitcherButton({ compact = false }: { compact?: boolean }) {
  const { q, set, on, toggle } = useSwitcher();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={q.isLoading || set.isPending}
      onClick={toggle}
      className={cn(
        "group relative flex items-center rounded-full border bg-background shadow-sm transition active:scale-[0.97] disabled:opacity-50",
        compact ? "h-9 w-[92px] px-1" : "h-11 w-[148px] px-1.5",
        on && "border-foreground bg-foreground text-background",
      )}
    >
      <span className={cn("absolute top-1 h-7 w-7 rounded-full bg-foreground transition-all duration-300 ease-out group-active:scale-90", compact ? "top-1" : "top-1.5 h-8 w-8", on ? (compact ? "left-[58px] bg-background" : "left-[108px] bg-background") : "left-1.5")} />
      <span className={cn("relative z-10 w-full text-center text-[12px] font-medium", on ? (compact ? "pr-6" : "pr-8") : (compact ? "pl-6" : "pl-8"))}>
        {set.isPending ? "…" : on ? "Failover" : "Off"}
      </span>
    </button>
  );
}

export function SwitcherControl() {
  const { on } = useSwitcher();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-4">
      <div className="min-w-0">
        <p className="font-medium">Intelligent Switcher</p>
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {on
            ? "Failover enabled. A retry-safe failure tries the next active profile."
            : "Requests stay on the selected profile. A failure is returned without switching."}
        </p>
      </div>
      <SwitcherButton />
    </div>
  );
}

export function AddCodexProfile({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [ack, setAck] = useState<boolean>(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  const clearSecrets = () => {
    setContent("");
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    clearSecrets();
    setLabel("");
    setAck(false);
    setFields({});
    onOpenChange(false);
  };

  const importCred = useMutation({
    mutationFn: (body: { label: string; content: string }) => api<CodexCredential>("/api/codex/credentials/import", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INV[0] });
      toast("Codex profile added");
      close();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else toast.error(errorMessage(e));
    },
    onSettled: () => clearSecrets(),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > AUTH_LIMIT) {
      setFields((f) => ({ ...f, content: "File must be 256 KB or smaller." }));
      clearSecrets();
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setContent(text);
    setFields((f) => ({ ...f, content: "" }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (importCred.isPending) return;
    const next: Record<string, string> = {};
    const name = label.trim();
    if (!name) next.label = "Profile name is required.";
    else if (name.length > LABEL_LIMIT) next.label = `Use ${LABEL_LIMIT} characters or fewer.`;
    const contentError = validateAuth(content);
    if (contentError) next.content = contentError;
    if (!ack) next.ack = "Confirm that you understand this file is sensitive.";
    setFields(next);
    if (Object.keys(next).length) return;
    importCred.mutate({ label: name, content });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Add Codex profile</DialogTitle>
          <DialogDescription className="text-[13px]">Name the account yourself. A name is never generated for you.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="flex items-start gap-2 rounded-lg bg-[hsl(var(--warn)/.1)] p-3 text-[12.5px] leading-relaxed">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>auth.json contains login credentials. It is sent once over your session, then cleared from this page. It is never saved in the browser.</span>
          </div>
          <Field label="Profile name">
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={LABEL_LIMIT} placeholder="Work account" autoComplete="off" required />
            {fields.label && <p className="mt-1.5 text-[12px] text-destructive">{fields.label}</p>}
          </Field>
          <Field label="auth.json">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="block w-full text-[13px] file:mr-3 file:h-8 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:text-[13px] file:font-medium"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {fileName && <p className="mt-1.5 text-[12px] text-muted-foreground">{fileName} selected. The file contents are not shown.</p>}
          </Field>
          <Field label="Or paste auth.json">
            <textarea
              value={content && fileName ? "" : content}
              onChange={(e) => { setFileName(""); setContent(e.target.value); }}
              placeholder="Optional. Paste only if you are not uploading a file."
              rows={4}
              autoComplete="off"
              spellCheck={false}
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-[13px] outline-none focus:border-foreground/30"
            />
            {fields.content && <p className="mt-1.5 text-[12px] text-destructive">{fields.content}</p>}
          </Field>
          <label className="flex items-start gap-2.5 text-[13px] leading-relaxed">
            <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I understand this file contains sensitive login credentials.</span>
          </label>
          {fields.ack && <p className="-mt-2 text-[12px] text-destructive">{fields.ack}</p>}
          <div className="flex justify-end gap-2">
            <Btn type="button" onClick={close}>Cancel</Btn>
            <Btn variant="primary" disabled={importCred.isPending}>{importCred.isPending ? "Importing…" : "Import profile"}</Btn>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CodexProfiles({ onAdd }: { onAdd: () => void }) {
  const q = useCodexCredentials();
  const [busyId, setBusyId] = useState<string>("");
  const [revoking, setRevoking] = useState<CodexCredential | null>(null);
  const toggle = useAction<{ id: string; kind: "enable" | "disable" }>((v) => `/api/codex/credentials/${v.id}/${v.kind}`, INV);
  const revoke = useAction<string>((id) => `/api/codex/credentials/${id}`, INV, { method: "DELETE" });

  return (
    <section className="mb-12">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium">Codex profiles</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Named accounts used for routing. Tokens are never shown.</p>
        </div>
        <Btn variant="primary" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add Codex profile</Btn>
      </div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data!.length ? (
        <Empty title="No Codex profiles" hint="Import auth.json and give the account a name. One API key covers every profile." action={<Btn variant="primary" onClick={onAdd}>Add Codex profile</Btn>} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b bg-[hsl(var(--canvas))] text-[12px] text-muted-foreground">
                {["Name", "Status", "Expires", "Last used", "Last refreshed", "Created", ""].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.data!.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{c.label}</td>
                  <td className="px-4 py-3"><Dot state={c.status} /></td>
                  <td className="whitespace-nowrap px-4 py-3">{c.expires_at ? relTime(c.expires_at) : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3">{relTime(c.last_used_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{relTime(c.last_refreshed_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{relTime(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {c.status === "active" && <Btn disabled={toggle.isPending && busyId === c.id} onClick={() => { setBusyId(c.id); toggle.mutate({ id: c.id, kind: "disable" }, { onSuccess: () => toast(`${c.label} disabled`) }); }}>Disable</Btn>}
                      {c.status === "disabled" && <Btn disabled={toggle.isPending && busyId === c.id} onClick={() => { setBusyId(c.id); toggle.mutate({ id: c.id, kind: "enable" }, { onSuccess: () => toast(`${c.label} enabled`) }); }}>Enable</Btn>}
                      {c.status !== "revoked" && <Btn variant="danger" onClick={() => setRevoking(c)}>Revoke</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Revoke {revoking?.label}?</DialogTitle>
            <DialogDescription className="text-[13px]">“{revoking?.label}” will leave the routing pool. This cannot be undone, and the stored credential is not shown.</DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex justify-end gap-2">
            <Btn onClick={() => setRevoking(null)}>Cancel</Btn>
            <Btn variant="danger" disabled={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id, { onSuccess: () => toast(`${revoking.label} revoked`), onSettled: () => setRevoking(null) })}>
              {revoke.isPending ? "Revoking…" : "Revoke"}
            </Btn>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
