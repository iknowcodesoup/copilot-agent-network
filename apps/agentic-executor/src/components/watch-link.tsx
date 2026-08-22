"use client";

import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Open one video on YouTube.
 *
 * A real anchor, not a button calling window.open: middle-click, open-in-new-
 * tab, and copy-link-address all have to keep working. It sits inside cards
 * that are themselves clickable, so the click is stopped from reaching them -
 * opening the video must not also select or start the card behind it.
 *
 * This is the manual half of the ingest gate. A download that failed goes on
 * to succeed once the video has been played by hand, so every place a video
 * appears offers the link, next to the Retry that follows it.
 */
export function WatchLink({
  url,
  label = "Watch",
  className,
}: {
  url: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      title="Open on YouTube"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background/80 px-2 py-1 font-mono text-[0.7rem] text-muted-foreground backdrop-blur transition-colors hover:border-primary/40 hover:text-foreground",
        className,
      )}
    >
      <Play className="size-3" />
      {label}
    </a>
  );
}
