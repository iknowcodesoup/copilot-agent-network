import { cn } from "@/lib/utils";

type Tone =
  | "in-progress"
  | "complete"
  | "failed"
  | "queued"
  | "review"
  | "running"
  | "neutral";

const TONES: Record<Tone, string> = {
  "in-progress": "bg-info/15 text-info border-info/30",
  running: "bg-primary/15 text-primary border-primary/30",
  complete: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  queued: "bg-muted text-muted-foreground border-border",
  review: "bg-primary/15 text-primary border-primary/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

const LABELS: Record<string, string> = {
  "in-progress": "In progress",
  complete: "Complete",
  failed: "Failed",
  queued: "Queued",
  review: "Awaiting review",
  running: "Training",
};

export function StatusPill({
  tone,
  label,
  pulse,
  className,
}: {
  tone: Tone;
  label?: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.7rem] font-medium tracking-wide uppercase",
        TONES[tone],
        className,
      )}
    >
      {pulse && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {label ?? LABELS[tone] ?? tone}
    </span>
  );
}
