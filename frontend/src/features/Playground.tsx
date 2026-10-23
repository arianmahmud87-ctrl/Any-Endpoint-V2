import { memo, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { ArrowUp, Bot, ChevronDown, RefreshCw, Square, User } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/lib/api/client";
import { useAccountKey, useFlags, useModels, useSettings } from "@/lib/api/hooks";
import type { ModelsResponse } from "@/lib/api/types";
import { Empty, LockedNotice } from "@/components/kit";

const MAX = 8000;

interface Bubble {
  id: string;
  role: "you" | "api";
  text: string;
  meta?: string;
  pending?: boolean;
}

const iconCls = "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground";
const jsonInputCls = "min-w-0 flex-1 border-b border-transparent bg-transparent text-foreground outline-none transition focus:border-foreground/40";

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

const Reply = memo(function Reply({ text, live }: { text: string; live: boolean }) {
  const shown = useTyped(text, live);
  return <p className="whitespace-pre-wrap break-words">{shown}{live && shown.length < text.length && <span className="ml-0.5 inline-block h-3.5 w-px animate-pulse bg-current align-middle" />}</p>;
});

export default function Playground() {
  const key = useAccountKey();
  const models = useModels();
  const settings = useSettings();
  const flags = useFlags();
  const qc = useQueryClient();
  const [endpoint, setEndpoint] = useState<string>(`${window.location.origin}/v1/chat/completions`);
  const [apiKey, setApiKey] = useState<string>("");
  const [keyShown, setKeyShown] = useState<boolean>(false);
  const [modelListOpen, setModelListOpen] = useState<boolean>(false);
  const [model, setModel] = useState<string>("");
  const [modelName, setModelName] = useState<string>("");
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
    if (settings.data.preferred_model_label) setModelName(settings.data.preferred_model_label);
    if (settings.data.preferred_effort) setEffort(settings.data.preferred_effort);
  }, [settings.data]);

  const savePref = useMutation({
    mutationFn: (body: { model?: string | null; effort?: string | null; label?: string | null }) => api("/api/user/settings/model", { method: "PATCH", body }),
  });

  const availableModels = models.data?.models ?? [];
  const efforts = models.data?.reasoning_efforts ?? [];
  const activeModel = model.trim() || availableModels[0]?.id || "gpt-5-codex";

  const commitModel = () => savePref.mutate({ model: model.trim() || null, label: modelName.trim() || null });

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

  const foreignEndpoint = (() => {
    try {
      return new URL(endpoint.trim()).origin !== window.location.origin;
    } catch {
      return false;
    }
  })();

  if (flags.data?.hidden.includes("playground")) {
    return <Navigate to="/app/overview" replace />;
  }

  if (flags.data?.locked.includes("playground")) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-12">
        <LockedNotice feature="Playground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto grid min-h-0 w-full max-w-[1240px] flex-1 grid-cols-1 gap-4 px-4 pb-4 pt-2 md:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-h-[440px] min-w-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border bg-[#eceae4]">
            <div className="flex h-11 shrink-0 items-center justify-between border-b bg-background px-4">
              <span className="text-[13px] font-medium">Gateway</span>
              {bubbles.length > 0 && <button type="button" onClick={() => setBubbles([])} className="text-[12px] text-muted-foreground hover:text-foreground">Clear</button>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              {bubbles.length === 0 && (
                <div className="flex items-start gap-2">
                  <span className={iconCls}><Bot className="h-3.5 w-3.5" /></span>
                  <div className="max-w-[82%] rounded-2xl rounded-bl-md bg-background px-3.5 py-2 text-[14px] leading-snug shadow-sm">
                    <p>Hey, what's going on?</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">Send a message to test the gateway. Config lives in the JSON panel.</p>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {bubbles.map((b) => (
                  <div key={b.id} className={cn("flex items-start gap-2", b.role === "you" ? "justify-end" : "justify-start")}>
                    {b.role === "api" && <span className={iconCls}><Bot className="h-3.5 w-3.5" /></span>}
                    <div className={cn("max-w-[82%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug shadow-sm", b.role === "you" ? "rounded-br-md bg-foreground text-background" : "rounded-bl-md bg-background text-foreground")}>
                      {b.pending ? (
                        <span className="flex gap-1 py-1">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/40" style={{ animationDelay: `${i * 140}ms` }} />)}</span>
                      ) : b.role === "api" ? <Reply text={b.text} live={b.id === liveId} /> : <p className="whitespace-pre-wrap break-words">{b.text}</p>}
                      {b.meta && <p className={cn("mt-1 text-[10.5px]", b.role === "you" ? "text-background/60" : "text-muted-foreground")}>{b.meta}</p>}
                    </div>
                    {b.role === "you" && <span className={iconCls}><User className="h-3.5 w-3.5" /></span>}
                  </div>
                ))}
                <div ref={end} />
              </div>
            </div>
            <form
              className="m-3 mt-0 flex shrink-0 items-end gap-2 rounded-[22px] border bg-background p-2 shadow-sm"
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
          <p className="mt-2 shrink-0 text-center text-[11.5px] text-muted-foreground">Chats are not stored in server.</p>
        </div>

        <div className="min-w-0 self-start rounded-[28px] border bg-background p-4 md:sticky md:top-2">
          <div className="flex items-center justify-between px-1">
            <p className="mono text-[12px] text-muted-foreground">playground.json</p>
            <button
              type="button"
              onClick={refreshModels}
              disabled={refreshing}
              aria-label="Refresh model list"
              title="Refresh model list"
              className="flex h-7 w-7 items-center justify-center rounded-lg border bg-background text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
          </div>
          <div className="mono mt-3 rounded-2xl border bg-[hsl(var(--canvas))] p-4 text-[13px] leading-8">
            <p className="text-muted-foreground">{"{"}</p>
            <div className="flex items-center gap-1.5 pl-4">
              <span className="shrink-0 text-foreground/80">"endpoint":</span>
              <span className="text-foreground/70">"</span>
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} maxLength={200} spellCheck={false} autoComplete="off" aria-label="endpoint" className={jsonInputCls} />
              <span className="text-foreground/70">",</span>
            </div>
            <div className="flex items-center gap-1.5 pl-4">
              <span className="shrink-0 text-foreground/80">"your_api_key":</span>
              <span className="text-foreground/70">"</span>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onDoubleClick={() => setKeyShown(true)}
                onBlur={() => setKeyShown(false)}
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
                aria-label={keyShown ? "your_api_key" : "Hidden API key. Double-click to show."}
                className={cn(jsonInputCls, !keyShown && apiKey && "select-none blur-sm")}
              />
              <span className="text-foreground/70">",</span>
            </div>
            <div className="relative flex items-center gap-1.5 pl-4">
              <span className="shrink-0 text-foreground/80">"model_id":</span>
              <span className="text-foreground/70">"</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => { setModelListOpen(false); commitModel(); }} maxLength={100} spellCheck={false} autoComplete="off" placeholder={availableModels[0]?.id ?? "gpt-5-codex"} aria-label="model_id" className={jsonInputCls} />
              <span className="text-foreground/70">"</span>
              <button type="button" aria-label="Show available models" title="Show available models" onMouseDown={(e) => e.preventDefault()} onClick={() => setModelListOpen((v) => !v)} className="shrink-0 text-muted-foreground transition hover:text-foreground">
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", modelListOpen && "rotate-180")} />
              </button>
              <span className="text-foreground/70">,</span>
              {modelListOpen && (
                <div className="absolute left-4 top-full z-20 mt-1 max-h-52 w-[calc(100%-1rem)] overflow-y-auto rounded-xl border bg-background py-1 shadow-lg">
                  {availableModels.length === 0 && <p className="px-3 py-1.5 text-[12px] text-muted-foreground">No models loaded — click the refresh icon above.</p>}
                  {availableModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setModel(m.id); savePref.mutate({ model: m.id }); setModelListOpen(false); }}
                      className={cn("flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12.5px] transition hover:bg-secondary", m.id === activeModel && "bg-secondary/60")}
                    >
                      <span className="mono">{m.id}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{m.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 pl-4">
              <span className="shrink-0 text-foreground/80">"model_name":</span>
              <span className="text-foreground/70">"</span>
              <input value={modelName} onChange={(e) => setModelName(e.target.value)} onBlur={commitModel} maxLength={100} spellCheck={false} autoComplete="off" placeholder={availableModels.find((m) => m.id === activeModel)?.label ?? "Display name"} aria-label="model_name" className={jsonInputCls} />
              <span className="text-foreground/70">",</span>
            </div>
            <div className="flex items-center gap-1.5 pl-4">
              <span className="shrink-0 text-foreground/80">"reasoning":</span>
              <span className="text-foreground/70">"</span>
              <label className="relative min-w-0 flex-1 cursor-pointer">
                <select
                  value={effort}
                  onChange={(e) => { setEffort(e.target.value); savePref.mutate({ effort: e.target.value }); }}
                  aria-label="reasoning"
                  className="w-full cursor-pointer appearance-none border-b border-transparent bg-transparent pr-4 text-foreground outline-none transition focus:border-foreground/40"
                >
                  {efforts.some((o) => o.id === effort) ? null : <option value={effort}>{effort}</option>}
                  {efforts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              </label>
              <span className="text-foreground/70">"</span>
            </div>
            <p className="text-muted-foreground">{"}"}</p>
          </div>
          {foreignEndpoint && apiKey.trim() !== "" && (
            <p className="mt-1.5 px-1 text-[11px] font-medium text-destructive">This URL is outside {window.location.host}. Your API key will be sent to that server — only use endpoints you trust.</p>
          )}
        </div>
      </div>
    </div>
  );
}
