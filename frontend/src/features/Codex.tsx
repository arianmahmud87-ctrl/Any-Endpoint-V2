import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardPaste, FileJson, Plus, ShieldCheck, Upload } from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { useAction, useCodexCredentials, useFlags, useSettings } from "@/lib/api/hooks";
import { ApiError, type CodexCredential } from "@/lib/api/types";
import { Btn, Dot, Empty, ErrorState, Field, inputCls, LoadingRows, Tag } from "@/components/kit";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { num, relTime } from "@/lib/format";
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

/** Compact per-profile on/off switch, same motion language as the failover switch. */
function ProfileSwitch({ on, pending, onToggle, label }: { on: boolean; pending: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? "Disable" : "Enable"} ${label}`}
      title={on ? `Disable ${label}` : `Enable ${label}`}
      disabled={pending}
      onClick={onToggle}
      className={cn(
        "relative flex h-7 w-[64px] shrink-0 items-center rounded-full border bg-background px-0.5 shadow-sm transition active:scale-[0.97] disabled:opacity-50",
        on && "border-foreground bg-foreground text-background",
      )}
    >
      <span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-foreground transition-all duration-300 ease-out", on && "left-[38px] bg-background")} />
      <span className={cn("relative z-10 w-full text-center text-[10.5px] font-medium", on ? "pr-5" : "pl-5")}>
        {pending ? "…" : on ? "On" : "Off"}
      </span>
    </button>
  );
}

export function SwitcherControl() {
  const { on } = useSwitcher();
  const flags = useFlags();
  const locked = flags.data?.locked.includes("intelligent_switcher") ?? false;
  // Hidden means invisible entirely; locked means visible but read-only.
  if (flags.data?.hidden.includes("intelligent_switcher")) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          Intelligent Switcher
          {locked && <Tag>Locked by administrator</Tag>}
        </p>
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {locked
            ? "This feature is temporarily disabled by the administrator."
            : on
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
  const [dragging, setDragging] = useState<boolean>(false);
  const [ack, setAck] = useState<boolean>(false);
  const [mode, setMode] = useState<"upload" | "paste">("upload");
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
    setMode("upload");
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

  const step = (n: string, title: string) => (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full border text-[10.5px] font-medium text-muted-foreground">{n}</span>
      <span className="text-[13px] font-medium">{title}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Add Profile</DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="flex items-start gap-2.5 rounded-xl border bg-[hsl(var(--canvas))] p-3 text-[12.5px] leading-relaxed">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
            <span className="text-muted-foreground">Sent once over your encrypted session, then cleared from this page. Never stored in the browser.</span>
          </div>

          <div className="space-y-2">
            {step("1", "Name the account")}
            <Field label="Profile name">
              <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={LABEL_LIMIT} placeholder="Work account" autoComplete="off" required />
              {fields.label && <p className="mt-1.5 text-[12px] text-destructive">{fields.label}</p>}
            </Field>
          </div>

          <div className="space-y-2">
            {step("2", "Provide auth.json")}
            <div className="flex rounded-lg border bg-secondary/40 p-0.5">
              {([["upload", "Upload file", FileJson], ["paste", "Paste JSON", ClipboardPaste]] as const).map(([m, text, Icon]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[7px] text-[12.5px] font-medium transition", mode === m ? "border shadow-sm bg-background" : "text-muted-foreground hover:text-foreground")}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {text}
                </button>
              ))}
            </div>
            {mode === "upload" ? (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void onFile(e.dataTransfer.files?.[0]);
                  }}
                  className={cn(
                    "flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-7 text-center transition",
                    dragging ? "border-foreground bg-secondary" : "hover:border-foreground/40 hover:bg-secondary/50",
                  )}
                >
                  {fileName ? <FileJson className="h-4 w-4 text-muted-foreground" /> : <Upload className="h-4 w-4 text-muted-foreground" />}
                  {fileName ? (
                    <span className="mt-2 text-[13px] font-medium">{fileName} <span className="font-normal text-muted-foreground">selected — contents hidden</span></span>
                  ) : (
                    <span className="mt-2 text-[13px] text-muted-foreground">Drop auth.json here, or <span className="font-medium text-foreground">click to browse</span></span>
                  )}
                </button>
              </div>
            ) : (
              <textarea
                value={content && fileName ? "" : content}
                onChange={(e) => { setFileName(""); setContent(e.target.value); }}
                placeholder='{"tokens": {"refresh_token": "…", "access_token": "…"}}'
                rows={4}
                autoComplete="off"
                spellCheck={false}
                className="w-full resize-none rounded-lg border bg-background px-3 py-2 font-mono text-[12px] outline-none focus:border-foreground/30"
              />
            )}
            {fields.content && <p className="text-[12px] text-destructive">{fields.content}</p>}
          </div>

          <div className="space-y-2">
            {step("3", "Confirm and import")}
            <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-[13px] leading-relaxed transition hover:bg-secondary/40", ack && "border-foreground/30")}>
              <input type="checkbox" className="mt-0.5 accent-foreground" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I understand this file contains sensitive login credentials.</span>
            </label>
            {fields.ack && <p className="text-[12px] text-destructive">{fields.ack}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Btn type="button" onClick={close}>Cancel</Btn>
            <Btn variant="primary" disabled={importCred.isPending}>{importCred.isPending ? "Importing…" : "Import profile"}</Btn>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_FILTERS = ["all", "active", "disabled", "expired", "revoked"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function CodexProfiles({ onAdd }: { onAdd: () => void }) {
  const q = useCodexCredentials();
  const [busyId, setBusyId] = useState<string>("");
  const [revoking, setRevoking] = useState<CodexCredential | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState<string>("");
  const toggle = useAction<{ id: string; kind: "enable" | "disable" }>((v) => `/api/codex/credentials/${v.id}/${v.kind}`, INV);
  const revoke = useAction<string>((id) => `/api/codex/credentials/${id}`, INV, { method: "DELETE" });

  const all = q.data ?? [];
  const countFor = (s: StatusFilter) => (s === "all" ? all.length : all.filter((c) => c.status === s).length);
  const visible = all.filter((c) => (filter === "all" || c.status === filter) && c.label.toLowerCase().includes(search.trim().toLowerCase()));
  const summary = [
    ["Total", all.length],
    ["Active", countFor("active")],
    ["Disabled", countFor("disabled")],
    ["Expired / revoked", countFor("expired") + countFor("revoked")],
  ];

  return (
    <section className="mb-12">
      <div className="mb-3 flex sm:justify-end">
        <Btn variant="primary" className="w-full sm:w-auto" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add Profile</Btn>
      </div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : !all.length ? (
        <Empty title="No Codex profiles" hint="Import auth.json and give the account a name. One API key covers every profile." action={<Btn variant="primary" onClick={onAdd}>Add Profile</Btn>} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
            {summary.map(([k, v]) => (
              <div key={k} className="bg-background px-4 py-3">
                <div className="text-[12px] text-muted-foreground">{k}</div>
                <div className="mt-0.5 text-[17px] font-semibold tracking-tight">{num(v as number)}</div>
              </div>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilter(s)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] capitalize transition",
                    filter === s ? "border-foreground bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/60",
                  )}
                >
                  {s}
                  <span className={cn("rounded-full px-1.5 text-[11px]", filter === s ? "bg-background" : "bg-secondary")}>{countFor(s)}</span>
                </button>
              ))}
            </div>
            <input
              className={cn(inputCls, "h-8 max-w-[220px] flex-1")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name"
              autoComplete="off"
              aria-label="Search profiles"
            />
          </div>
          {visible.length === 0 ? (
            <Empty title="No profiles match your filters" hint="Try a different status or clear the search." action={<Btn onClick={() => { setFilter("all"); setSearch(""); }}>Clear filters</Btn>} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((c) => (
                <div key={c.id} className="flex flex-col rounded-xl border bg-background p-4 transition duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.label}</span>
                    <Dot state={c.status} />
                  </div>
                  <dl className="mt-3 flex-1 space-y-1 text-[12.5px]">
                    {([
                      ["Expires", c.expires_at],
                      ["Last used", c.last_used_at],
                      ["Last refreshed", c.last_refreshed_at],
                      ["Created", c.created_at],
                    ] as [string, string | null][]).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd>{v ? relTime(v) : "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                    {(c.status === "active" || c.status === "disabled") ? (
                      <ProfileSwitch
                        on={c.status === "active"}
                        pending={toggle.isPending && busyId === c.id}
                        label={c.label}
                        onToggle={() => {
                          setBusyId(c.id);
                          const kind = c.status === "active" ? "disable" : "enable";
                          toggle.mutate({ id: c.id, kind }, { onSuccess: () => toast(kind === "disable" ? `${c.label} disabled` : `${c.label} enabled`) });
                        }}
                      />
                    ) : <span />}
                    {c.status !== "revoked" && <Btn variant="danger" className="h-7 px-2.5 text-[12px]" onClick={() => setRevoking(c)}>Revoke</Btn>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Revoke {revoking?.label}?</DialogTitle>
            <DialogDescription className="text-[13px]">“{revoking?.label}” will leave the routing pool for good. This cannot be undone, and the stored credential is not shown.</DialogDescription>
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
