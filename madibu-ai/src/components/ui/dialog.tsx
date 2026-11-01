"use client";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        className={cn("fixed top-[50%] left-[50%] z-50 grid max-h-[90vh] w-[calc(100%-1.5rem)] max-w-2xl translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-xl border bg-card p-5 shadow-lg", className)}
        {...props}>
        {children}
        <DialogPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 hover:opacity-100" aria-label="Fermer">
          <XIcon className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
const DialogHeader = ({ className, ...p }: React.ComponentProps<"div">) => <div className={cn("flex flex-col gap-1.5", className)} {...p} />;
const DialogTitle = ({ className, ...p }: React.ComponentProps<typeof DialogPrimitive.Title>) => <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...p} />;
const DialogDescription = ({ className, ...p }: React.ComponentProps<typeof DialogPrimitive.Description>) => <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...p} />;
export { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger };
