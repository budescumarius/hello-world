import * as React from "react";
import { cn } from "@/lib/utils";

/** Liste déroulante native : accessible, fonctionne sans JavaScript et sur mobile. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select data-slot="select"
      className={cn("flex h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50", className)}
      {...props}>
      {children}
    </select>
  );
}
export { NativeSelect };
