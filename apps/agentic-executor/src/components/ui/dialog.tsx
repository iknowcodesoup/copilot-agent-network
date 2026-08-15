"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";

/*
 * Thin wrapper, scoped to what voice_card.tsx's "View clips" modal needs
 * (Story 3.6) - not a general-purpose component library, matching
 * voice_speaker_combobox.tsx's precedent from Story 3.5. Styled like
 * components/ui/select.tsx: same Portal/Popup shape, plus the backdrop a
 * modal (unlike a popover) needs.
 */
const Dialog = DialogPrimitive.Root;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-50 bg-black/50 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-lg bg-popover p-4 text-xs/relaxed text-popover-foreground shadow-lg outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="dialog-close"
          className="absolute top-3 right-3 rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("pr-6 font-heading text-sm font-medium", className)}
      {...props}
    />
  );
}

export { Dialog, DialogClose, DialogContent, DialogTitle };
