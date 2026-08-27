"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRenameVoice } from "./api/use_voices";

/*
 * Click the name to rename the voice. A clip joins a voice by id, so the
 * rename changes nothing else - every clip that shows this name reads it back
 * resolved on the next fetch. This is VideoTitle on the Videos tab, lifted
 * out because both the card grid and the clips panel show a voice name.
 *
 * Every event stops propagating. The voice card is one big click target that
 * selects the voice, and without this a click meant for the name would select
 * the card underneath it.
 *
 * className styles the interactive element - the button and the input alike -
 * for layout such as `flex-1`. textClassName styles the name text itself, so
 * a caller sets its own type scale.
 */
export function EditableVoiceName({
  voiceId,
  name,
  className,
  textClassName,
}: {
  voiceId: string;
  name: string;
  className?: string;
  textClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const renameVoice = useRenameVoice(voiceId);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  const save = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) renameVoice.mutate(next);
  };

  if (editing)
    return (
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        className={cn(
          "min-w-0 rounded-md border border-input bg-background px-2 py-1 outline-none",
          className,
          textClassName,
        )}
      />
    );

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        "group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-muted/40",
        className,
      )}
    >
      <h3 className={cn("min-w-0 truncate", textClassName)}>{name}</h3>
      <Pencil className="size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
    </button>
  );
}
