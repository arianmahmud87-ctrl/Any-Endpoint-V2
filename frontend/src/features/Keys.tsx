import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAccountKey, useAction } from "@/lib/api/hooks";
import type { AccountKey } from "@/lib/api/types";
import { Btn, CopyBtn, ErrorState, Page } from "@/components/kit";
import { Confirm } from "@/components/Dialogs";
import { cn } from "@/lib/utils";

const SAMPLE = [
  "curl https://anyendpoint.online/v1/chat/completions \\",
  "-H \"Authorization: Bearer YOUR_KEY\" \\",
  "-H \"Content-Type: application/json\" \\",
  "-d '{\"model\":\"gpt-5-codex\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}'",
].join("\n");

export default function Keys() {
  const q = useAccountKey();
  const [shown, setShown] = useState<boolean>(false);
  const [taps, setTaps] = useState<number>(0);
  const [confirm, setConfirm] = useState<boolean>(false);
  const regen = useAction<void, AccountKey>(() => "/api/account/key/regenerate", [["account-key"]], { success: "New key issued" });

  const reveal = () => {
    const next = taps + 1;
    setTaps(next);
    if (next >= 2) setShown(true);
  };

  return (
    <Page title="API key" subtitle="One key is created when you sign in. It covers every Codex profile.">
      {q.isLoading ? <div className="h-28 animate-pulse rounded-2xl bg-secondary" /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : q.data && (
        <div className="max-w-xl rounded-2xl border p-5">
          <p className="text-[12px] text-muted-foreground">Default key · double-click to reveal</p>
          <button
            type="button"
            onDoubleClick={reveal}
            onClick={() => { if (!shown) setTaps((n) => n + 1); }}
            className={cn("mono mt-3 block w-full rounded-xl bg-[hsl(var(--canvas))] px-4 py-4 text-left text-[13px] tracking-wide transition", !shown && "blur-sm select-none")}
            aria-label={shown ? "API key" : "Hidden API key. Double-click to show."}
          >
            {q.data.raw_key}
          </button>
          {!shown && <p className="mt-2 text-[12px] text-muted-foreground">{taps === 1 ? "One more click." : "Stays hidden until you double-click it."}</p>}
          <div className="mt-4 flex gap-2">
            <CopyBtn value={q.data.raw_key} label="Copy" />
            <Btn onClick={() => setConfirm(true)}><RefreshCw className="h-3.5 w-3.5" />Regenerate</Btn>
          </div>
        </div>
      )}
      <div className="mt-8 max-w-xl rounded-xl border p-4">
        <p className="text-[13px] font-medium">Use the key</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Send it as a bearer token. Replace the host with your gateway. Do not put the key in a URL.</p>
        <pre className="mono mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[hsl(var(--canvas))] p-3 text-[12px] leading-relaxed">{SAMPLE}</pre>
      </div>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Regenerate this key?"
        body="The current key stops working immediately. Anything still using it will be rejected."
        confirmLabel="Regenerate"
        busy={regen.isPending}
        onConfirm={() => regen.mutate(undefined, { onSuccess: () => { setShown(false); setTaps(0); }, onSettled: () => setConfirm(false) })}
      />
    </Page>
  );
}
