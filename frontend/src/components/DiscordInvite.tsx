import { useCallback, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const DISCORD_URL = "https://discord.gg/9H9GjwR2P";
const STORAGE_KEY = "ae-discord-invite-dismissed";

export function DiscordMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" role="img" aria-label="Discord" className={cn("shrink-0", className)}>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export interface DiscordInviteState { dismissed: boolean; closing: boolean; close: () => void; }

/** Popup-vs-sidebar state for the Discord invite; dismissal persists in localStorage. */
export function useDiscordInvite(): DiscordInviteState {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });
  const [closing, setClosing] = useState<boolean>(false);
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* storage unavailable */ }
      setDismissed(true);
    }, 300);
  }, []);
  return { dismissed, closing, close };
}

/** Centered invitation card shown after sign-in until the user dismisses it. */
export function DiscordPopup({ state }: { state: DiscordInviteState }) {
  const { dismissed, closing, close } = state;
  if (dismissed) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className={cn("absolute inset-0 bg-black/40", closing ? "disc-fade-out" : "fade-in")} />
      <div
        className={cn("pointer-events-auto relative w-full max-w-[330px] rounded-2xl border bg-background p-6 text-center shadow-xl", closing ? "disc-pop-out" : "disc-pop-in")}
        style={closing ? undefined : { animationDelay: "350ms" }}
        role="dialog"
        aria-label="Discord invitation"
      >
        <button onClick={close} aria-label="Dismiss invitation" className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5865F2] text-white">
          <DiscordMark size={24} />
        </div>
        <p className="mt-4 text-[16px] font-semibold tracking-tight">Join our Discord</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">Get help, share feedback and chat with the community.</p>
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="mt-5 flex h-10 w-full items-center justify-center rounded-full bg-[#5865F2] text-[13.5px] font-medium text-white transition hover:opacity-90 active:scale-[.98]">
          Join Discord server
        </a>
      </div>
    </div>
  );
}

/** Compact rounded box that lives at the bottom of the sidebar after dismissal. */
export function DiscordSidebarBox({ state }: { state: DiscordInviteState }) {
  const { dismissed } = state;
  if (!dismissed) return null;
  return (
    <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="fade-in mt-auto flex items-center gap-2.5 rounded-xl border p-3 transition hover:bg-sidebar-accent">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#5865F2] text-white"><DiscordMark size={16} /></span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[12.5px] font-medium leading-tight">Join our Discord</span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">Community & support</span>
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
    </a>
  );
}
