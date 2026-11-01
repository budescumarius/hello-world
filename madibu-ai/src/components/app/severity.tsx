import { AlertOctagonIcon, AlertTriangleIcon, InfoIcon, OctagonAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const MAP = {
  critical: { Icon: AlertOctagonIcon, cls: "border-critical/50 text-critical bg-critical/5" },
  high: { Icon: OctagonAlertIcon, cls: "border-serious/60 text-foreground bg-serious/10" },
  warning: { Icon: AlertTriangleIcon, cls: "border-warning/70 text-foreground bg-warning/10" },
  info: { Icon: InfoIcon, cls: "border-border text-muted-foreground" },
} as const;

/** Statut toujours porté par une icône + un libellé (jamais par la couleur seule). */
export function SeverityBadge({ severity, label }: { severity: keyof typeof MAP; label: string }) {
  const { Icon, cls } = MAP[severity] ?? MAP.info;
  return (
    <span className={cn("inline-flex h-fit shrink-0 self-start items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", cls)}>
      <Icon className="size-3" aria-hidden /> {label}
    </span>
  );
}
