import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const d = (ms: number): CSSProperties => ({ ["--d" as string]: `${ms}ms` });
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { KeyRound, Link2, Lock, Sparkles } from "lucide-react";
import { useSession } from "./session";
import { Logo } from "@/layout/Logo";
import { Btn, LoadingRows } from "@/components/kit";
import { cn } from "@/lib/utils";

const BIG_SCALE = 2.6; // visual magnification of the intro tile while it draws

const Center = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-full items-center justify-center bg-background p-6">{children}</div>
);

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground" />;
}

const Google = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8Z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8Z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4Z"/></svg>
);

export function LoginPage() {
  const { status, login } = useSession();
  const err = new URLSearchParams(useLocation().search).get("error");
  // Full-screen brand intro on every logged-out visit: the oversized logo draws
  // itself, then glides and shrinks into its real slot in the sign-in card.
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [intro, setIntro] = useState<"play" | "fly" | "done">(reducedMotion ? "done" : "play");
  const [flyTo, setFlyTo] = useState<{ dx: number; dy: number; scale: number } | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (intro !== "play") return;
    const t = window.setTimeout(() => {
      const tile = tileRef.current?.getBoundingClientRect();
      const fly = flyRef.current?.getBoundingClientRect();
      if (tile && fly) {
        // The flying tile is visually magnified BIG_SCALE× by an inner transform,
        // so the outer wrapper must shrink by 1/BIG_SCALE for a true size landing.
        setFlyTo({
          dx: tile.left + tile.width / 2 - (fly.left + fly.width / 2),
          dy: tile.top + tile.height / 2 - (fly.top + fly.height / 2),
          scale: tile.width / fly.width / BIG_SCALE,
        });
      }
      setIntro("fly");
    }, 1900);
    return () => window.clearTimeout(t);
  }, [intro]);

  useEffect(() => {
    if (intro !== "fly") return;
    // Fallback only: normally the overlay unmounts on transition end, so the
    // swap happens on the exact final frame of the flight.
    const t = window.setTimeout(() => setIntro("done"), 1100);
    return () => window.clearTimeout(t);
  }, [intro]);

  const onFlyEnd = (e: TransitionEvent) => {
    if (intro === "fly" && e.propertyName === "transform" && e.target === flyRef.current) setIntro("done");
  };

  if (status === "authed") return <Navigate to="/app/playground" replace />;
  const steps = [
    { icon: Link2, title: "Connect your subscription", text: "Link your ChatGPT plan in a few clicks." },
    { icon: KeyRound, title: "Get your API & endpoint", text: "Any Endpoint turns it into a ready-to-use API key and endpoint." },
    { icon: Sparkles, title: "Freedom welcomes you", text: "Use it in any app, tool or workflow you like." },
  ];
  const line1 = ["Use", "your", "ChatGPT's", "Codex", "Usage", "limit", "as", "API"];
  const line2 = ["anywhere", "you", "need."];
  const headline = (base: number) => (
    <h2 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[31px] lg:text-[36px] lg:leading-[1.12]">
      {line1.map((w, i) => <span key={w}><span className="word" style={d(base + i * 70)}>{w}</span>{" "}</span>)}
      {line2.map((w, i) => <span key={w}><span className="word" style={d(base + (line1.length + i) * 70)}><span className="shimmer-text">{w}</span></span>{i < line2.length - 1 ? " " : ""}</span>)}
    </h2>
  );
  const stepList = (compact: boolean) => (
    <ol className={compact ? "relative mt-7 space-y-5" : "relative mt-5 space-y-6"}>
      {!compact && <span className="draw-line-y absolute left-[17.5px] top-9 bottom-9 w-px bg-border" style={d(1100)} />}
      {steps.map(({ icon: I, title, text }, i) => (
        <li key={title} className="benefit reveal relative flex cursor-default gap-4" style={d((compact ? 500 : 1050) + i * 150)}>
          <span className="benefit-icon relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm"><I className="h-4 w-4" strokeWidth={1.7} /></span>
          <div className="pt-0.5">
            <p className="benefit-title text-[14px] font-medium"><span className="mono mr-2 text-[11.5px] text-muted-foreground">0{i + 1}</span>{title}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
  return (
    <div className="flex min-h-full flex-col lg:grid lg:grid-cols-[1.05fr_1fr]">
      {intro !== "done" && (
        <div className="fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center bg-background" aria-hidden onClick={() => setIntro("done")}>
          <div
            ref={flyRef}
            onTransitionEnd={onFlyEnd}
            className={cn(intro === "fly" && "intro-fly")}
            style={intro === "fly" && flyTo ? { transform: `translate(${flyTo.dx}px, ${flyTo.dy}px) scale(${flyTo.scale})` } : undefined}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-background shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_-12px_rgba(0,0,0,.18)]" style={{ transform: `scale(${BIG_SCALE})` }}>
              <span className="logo-draw flex"><Logo size={30} /></span>
            </div>
          </div>
          <div className={cn("mt-12 text-center transition-opacity duration-500", intro === "fly" && "opacity-0")}>
            <p className="text-[26px] font-semibold tracking-tight"><span className="word" style={d(650)}>Any Endpoint</span></p>
          </div>
        </div>
      )}
      {/* Mobile pitch: brand, headline and steps (the desktop aside is hidden below lg) */}
      <div className="relative overflow-hidden bg-[#f6f5f1] px-6 pb-8 pt-9 lg:hidden">
        <div className="pointer-events-none absolute inset-0 opacity-[.5] [background-image:radial-gradient(hsl(var(--foreground)/.09)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_75%)] dot-drift" />
        <div className="reveal relative flex items-center gap-2.5 text-[15px] font-semibold tracking-tight" style={d(0)}><Logo size={26} />Any Endpoint</div>
        <div className="relative mt-6">{headline(150)}</div>
        {stepList(true)}
      </div>
      <aside className="relative hidden overflow-hidden bg-[#f6f5f1] p-12 lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0 opacity-[.5] [background-image:radial-gradient(hsl(var(--foreground)/.09)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_75%)] dot-drift" />
        <div className="reveal relative flex items-center gap-2.5 text-[15px] font-semibold tracking-tight" style={d(0)}><Logo size={28} />Any Endpoint</div>
        <div className="relative my-auto max-w-[440px]">
          {headline(150)}
          <span className="draw-line mt-6 block h-px w-16 bg-foreground/30" style={d(900)} />
          <p className="reveal mt-8 text-[11.5px] font-medium uppercase tracking-[.14em] text-muted-foreground" style={d(950)}>How it works</p>
          {stepList(false)}
        </div>
        <p className="reveal relative text-[12px] text-muted-foreground" style={d(1500)}>© {new Date().getFullYear()} Any Endpoint</p>
      </aside>
      <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-background p-6">
        <div aria-hidden className="aurora-a pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-[#10A37F]/[.08] blur-3xl" />
        <div aria-hidden className="aurora-b pointer-events-none absolute -right-16 bottom-1/4 h-80 w-80 rounded-full bg-[#D97757]/[.08] blur-3xl" />
        <div className="fade-in relative flex w-full max-w-[380px] flex-col items-center text-center">
          <div ref={tileRef} className="halo flex h-14 w-14 items-center justify-center rounded-2xl border bg-background shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_-12px_rgba(0,0,0,.18)]">
            <span className="logo-draw logo-breathe flex"><Logo size={30} /></span>
          </div>
          <h1 className="mt-7 text-[28px] font-semibold tracking-[-0.02em]">
            {["Sign", "in"].map((w, i) => <span key={w}><span className="word" style={d(400 + i * 110)}>{w}</span>{i === 0 ? " " : ""}</span>)}
          </h1>
          {err && <div role="alert" className="fade-in mt-6 w-full rounded-xl border border-destructive/20 bg-destructive/[.06] px-3.5 py-2.5 text-left text-[13px] text-destructive">We couldn't sign you in. Please try again or contact your administrator.</div>}
          <button onClick={() => login()} style={d(620)} className="btn-shine reveal group mt-9 flex h-12 w-full items-center justify-center gap-3 rounded-full bg-foreground text-[14.5px] font-medium text-background shadow-[0_8px_20px_-10px_rgba(0,0,0,.5)] transition hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,.55)] active:translate-y-0 active:scale-[.98]">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white transition-transform duration-300 group-hover:rotate-[360deg]"><Google /></span>
            Continue with Google
          </button>
        </div>
      </main>
    </div>
  );
}

export function AuthCallback() {
  const { status } = useSession();
  const nav = useNavigate();
  useEffect(() => {
    if (status === "authed") nav("/app/playground", { replace: true });
    if (status === "anon") nav("/login?error=1", { replace: true });
  }, [status, nav]);
  return (
    <Center>
      <div className="flex flex-col items-center gap-3 text-[13px] text-muted-foreground"><Spinner />Signing you in…</div>
    </Center>
  );
}

export function AdminGuard({ children }: { children: ReactNode }) {
  const { me, status } = useSession();
  if (status === "loading") return <div className="mx-auto w-full max-w-5xl px-5 py-8 md:px-10 md:py-12"><LoadingRows n={6} /></div>;
  if (me?.role !== "admin") return <Navigate to="/app/overview" replace />;
  return <>{children}</>;
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const { status, expired, login, refetch } = useSession();
  if (status === "loading") return <Center><Spinner /></Center>;
  if (status === "anon") return <Navigate to="/login" replace />;
  if (status === "forbidden")
    return (
      <Center>
        <div className="text-center"><Lock className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-3 font-medium">No access</p><p className="mt-1 text-[13px] text-muted-foreground">Your account isn't a member of any organization.</p></div>
      </Center>
    );
  if (status === "error")
    return (
      <Center>
        <div className="text-center"><p className="font-medium">Can't reach the control plane</p><Btn className="mt-4" variant="outline" onClick={() => refetch()}>Retry</Btn></div>
      </Center>
    );
  return (
    <>
      {children}
      {expired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="fade-in w-[320px] rounded-2xl border bg-background p-6 text-center shadow-xl">
            <p className="font-medium">Session expired</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Sign in again to continue.</p>
            <Btn variant="primary" className="mt-5 w-full justify-center" onClick={() => login()}>Sign in</Btn>
          </div>
        </div>
      )}
    </>
  );
}
