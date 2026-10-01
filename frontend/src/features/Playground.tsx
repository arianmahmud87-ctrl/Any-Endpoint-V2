import { useEffect, useRef, useState } from "react";
import { ArrowUp, RefreshCw, Square } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/lib/api/client";
import { useAccountKey, useModels, useSettings } from "@/lib/api/hooks";
import type { ModelsResponse } from "@/lib/api/types";
import { SwitcherButton } from "./Codex";

const MAX = 8000;

interface Bubble {
  id: string;
  role: "you" | "api";
  text: string;
  meta?: string;
  pending?: boolean;
}

/** Types text in so a response feels like a live SMS, not a dumped block. */
function useTyped(full: string, active: boolean): string {
  const [n, setN] = useState<number>(active ? 0 : full.length);
  useEffect(() => {
    if (!active) {
      setN(full.length);
      return;
    }
    setN(0);
    const id = window.setInterval(() => {
      setN((v) => {
        if (v >= full.length) {
          window.clearInterval(id);
          return v;
        }
        return Math.min(full.length, v + Math.max(1, Math.ceil(full.length / 80)));
      });
    }, 18);
    return () => window.clearInterval(id);
  }, [full, active]);
  return full.slice(0, n);
}

function Reply({ text, live }: { text: string; live: boolean }) {
  const shown = useTyped(text, live);
  return <p className="whitespace-pre-wrap break-words">{shown}{live && shown.length < text.length && <span className="ml-0.5 inline-block h-3.5 w-px animate-pulse bg-current align-middle" />}</p>;
}

export default function Playground() {
  const key = useAccountKey();
  const models = useModels();
  const settings = useSettings();
  const qc = useQueryClient();
  const [endpoint, setEndpoint] = useState<string>("https://anyendpoint.online/v1/chat/completions");
  const [apiKey, setApiKey] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [effort, setEffort] = useState<string>("medium");
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const prefsLoaded = useRef<boolean>(false);
  const [prompt, setPrompt] = useState<string>("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [running, setRunning] = useState<boolean>(false);
  const [liveId, setLiveId] = useState<string>("");
  const ctrl = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!apiKey && key.data?.raw_key) setApiKey(key.data.raw_key);
  }, [key.data?.raw_key, apiKey]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [bubbles, liveId]);

  // Load saved model preferences once, then default to the first available model.
  useEffect(() => {
    if (prefsLoaded.current || !settings.data) return;
    prefsLoaded.current = true;
    if (settings.data.preferred_model) setModel(settings.data.preferred_model);
    if (settings.data.preferred_effort) setEffort(settings.data.preferred_effort);
  }, [settings.data]);

  const savePref = useMutation({
    mutationFn: (body: { model?: string | null; effort?: string | null }) => api("/api/user/settings/model", { method: "PATCH", body }),
  });

  const availableModels = models.data?.models ?? [];
  const efforts = models.data?.reasoning_efforts ?? [];
  const activeModel = model || availableModels[0]?.id || "gpt-5-codex";

  const pickModel = (id: string) => { setModel(id); savePref.mutate({ model: id }); };
  const pickEffort = (id: string) => { setEffort(id); savePref.mutate({ effort: id }); };

  const refreshModels = async () => {
    setRefreshing(true);
    try {
      const fresh = await api<ModelsResponse>("/api/models?refresh=1");
      qc.setQueryData(["models"], fresh);
      toast(fresh.source === "upstream" ? `Model list updated. ${fresh.models.length} models available.` : "Couldn't reach the upstream. Showing the built-in list.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || running) return;
    if (!endpoint.trim()) return;
    const you: Bubble = { id: Math.random().toString(36).slice(2), role: "you", text };
    const replyId = Math.random().toString(36).slice(2);
    setBubbles((b) => [...b, you, { id: replyId, role: "api", text: "", pending: true }]);
    setPrompt("");
    setRunning(true);
    ctrl.current = new AbortController();
    const started = performance.now();
    try {
      const res = await fetch(endpoint.trim(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
        },
        body: JSON.stringify({ model: activeModel, messages: [{ role: "user", content: text }], ...(effort ? { reasoning_effort: effort } : {}) }),
        signal: ctrl.current.signal,
      });
      const raw = await res.text();
      let pretty = raw;
      try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* keep text */ }
      const body = pretty.slice(0, 20000) || "(empty response)";
      const ms = Math.round(performance.now() - started);
      setLiveId(replyId);
      setBubbles((b) => b.map((x) => (x.id === replyId ? { ...x, pending: false, text: body, meta: `${res.status} · ${ms} ms` } : x)));
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      const msg = aborted ? "Stopped." : "Could not reach that endpoint. Check the URL, or that it allows this site to call it.";
      setBubbles((b) => b.map((x) => (x.id === replyId ? { ...x, pending: false, text: msg, meta: "error" } : x)));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col px-4 pb-4 pt-2">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-medium">API tester</p>
            <p className="text-[12px] text-muted-foreground">Messages stay in this tab only.</p>
          </div>
          <SwitcherButton />
        </div>
        <div className="mb-3 space-y-2 rounded-2xl border bg-[hsl(var(--canvas))] p-3">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Endpoint
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.example/v1/responses" className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-[13px] normal-case tracking-normal outline-none focus:border-foreground" />
          </label>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">API key
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Bearer token" className="mono mt-1 h-9 w-full rounded-lg border bg-background px-3 text-[12px] normal-case tracking-normal outline-none focus:border-foreground" />
          </label>
          <div className="flex items-end gap-2">
            <label className="block min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Model
              <select
                value={activeModel}
                onChange={(e) => pickModel(e.target.value)}
                disabled={models.isLoading}
                className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-[13px] normal-case tracking-normal outline-none focus:border-foreground disabled:opacity-50"
              >
                {availableModels.length === 0 && <option value={activeModel}>{activeModel}</option>}
                {availableModels.some((m) => m.id === activeModel) ? null : <option value={activeModel}>{activeModel}</option>}
                {availableModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="block w-[118px] shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reasoning
              <select
                value={effort}
                onChange={(e) => pickEffort(e.target.value)}
                disabled={models.isLoading}
                className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-[13px] normal-case tracking-normal outline-none focus:border-foreground disabled:opacity-50"
              >
                {efforts.some((o) => o.id === effort) ? null : <option value={effort}>{effort}</option>}
                {efforts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={refreshModels}
              disabled={refreshing}
              aria-label="Refresh model list"
              title="Refresh model list"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
          </div>
          {models.data && (
            <p className="text-[11px] text-muted-foreground">
              {models.data.source === "upstream" ? "Live model list from the upstream API." : "Built-in model list. Add a Codex profile and refresh for the live list."}
            </p>
          )}
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[28px] border bg-[#eceae4] shadow-inner">
          <div className="flex h-11 items-center justify-between border-b bg-background/80 px-4 backdrop-blur">
            <span className="text-[13px] font-medium">Gateway</span>
            {bubbles.length > 0 && <button type="button" onClick={() => setBubbles([])} className="text-[12px] text-muted-foreground hover:text-foreground">Clear</button>}
          </div>
          <div className="h-[calc(100%-2.75rem)] overflow-y-auto px-3 py-4">
            {bubbles.length === 0 && (
              <p className="px-6 pt-16 text-center text-[13px] leading-relaxed text-muted-foreground">Set an endpoint and key, then send a message. The reply appears here as a text.</p>
            )}
            <div className="space-y-2">
              {bubbles.map((b) => (
                <div key={b.id} className={cn("flex", b.role === "you" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[82%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug shadow-sm", b.role === "you" ? "rounded-br-md bg-foreground text-background" : "rounded-bl-md bg-background text-foreground")}>
                    {b.pending ? (
                      <span className="flex gap-1 py-1">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/40" style={{ animationDelay: `${i * 140}ms` }} />)}</span>
                    ) : b.role === "api" ? <Reply text={b.text} live={b.id === liveId} /> : <p className="whitespace-pre-wrap break-words">{b.text}</p>}
                    {b.meta && <p className={cn("mt-1 text-[10.5px]", b.role === "you" ? "text-background/60" : "text-muted-foreground")}>{b.meta}</p>}
                  </div>
                </div>
              ))}
              <div ref={end} />
            </div>
          </div>
        </div>
        <form
          className="mt-3 flex items-end gap-2 rounded-[22px] border bg-background p-2 shadow-[0_2px_12px_-4px_rgba(0,0,0,.08)]"
          onSubmit={(e) => { e.preventDefault(); send(); }}
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, MAX))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="Message"
            className="max-h-28 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none"
          />
          {running ? (
            <button type="button" onClick={() => ctrl.current?.abort()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background" aria-label="Stop"><Square className="h-3 w-3" fill="currentColor" /></button>
          ) : (
            <button type="submit" disabled={!prompt.trim()} className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-90", prompt.trim() ? "bg-foreground text-background" : "bg-muted-foreground/20 text-background")} aria-label="Send"><ArrowUp className="h-4 w-4" strokeWidth={2.2} /></button>
          )}
        </form>
      </div>
    </div>
  );
}
