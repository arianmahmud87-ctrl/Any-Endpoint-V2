import type { Provider } from "@/lib/api/types";
import { cn } from "@/lib/utils";

function CodexMark() {
  return (
    <g fill="none" stroke="#fff" strokeWidth="5.5" strokeLinejoin="round">
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <path key={a} d="M50 28 C60 20 76 24 78 38 L64 46 L50 38 Z" transform={`rotate(${a} 50 50)`} />
      ))}
    </g>
  );
}

/** Rounded-square brand icon for a provider. */
export function ProviderIcon({ provider, size = 18, className }: { provider: Provider; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Codex" className={cn("shrink-0", className)}>
      <rect width="100" height="100" rx="24" fill="#10A37F" />
      <CodexMark />
    </svg>
  );
}

/** Provider icon plus its name, for tables and lists. */
export function ProviderBadge({ provider }: { provider: Provider }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] capitalize">
      <ProviderIcon provider={provider} size={16} />
      {provider}
    </span>
  );
}
