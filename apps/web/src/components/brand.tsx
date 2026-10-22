import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <g stroke="white" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M9 21l7-10 7 10" />
        <path d="M9 21h14" />
      </g>
      <g fill="white">
        <circle cx="9" cy="21" r="3" />
        <circle cx="16" cy="11" r="3" />
        <circle cx="23" cy="21" r="3" />
      </g>
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-lg font-semibold tracking-tight", className)}>
      <Logo />
      A-Link
    </span>
  );
}
