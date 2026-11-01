import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Tuile chiffre clé : la valeur, son libellé et sa provenance / qualité de donnée. */
export function Kpi({ label, value, sub, tone, testId }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "neg" | "warn"; testId?: string }) {
  return (
    <Card className="gap-1 py-4" data-testid={testId}>
      <div className="px-4 text-xs text-muted-foreground">{label}</div>
      <div className={cn("px-4 text-2xl font-semibold tabular", tone === "neg" && "text-critical")}>{value}</div>
      {sub ? <div className="px-4 text-xs text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}
