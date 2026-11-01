"use client";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";

export interface CashPoint { week: string; optimistic: number | null; realistic: number | null; pessimistic: number | null }
const nf = new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const SERIES = [
  { key: "realistic", color: "var(--series-1)" },
  { key: "pessimistic", color: "var(--series-2)" },
  { key: "optimistic", color: "var(--series-3)" },
] as const;

/** Solde projeté par scénario (fin de semaine), seuil d'alerte en pointillés, vue tableau accessible. */
export function CashChart({ data, threshold, labels }: { data: CashPoint[]; threshold: number; labels: Record<string, string> }) {
  const [table, setTable] = useState(false);
  return (
    <div>
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b text-muted-foreground"><th className="py-1 text-left">Semaine</th>{SERIES.map((s) => <th key={s.key} className="py-1 text-right">{labels[s.key]}</th>)}</tr></thead>
            <tbody>{data.map((d) => <tr key={d.week} className="border-b"><td className="py-1">{d.week}</td>{SERIES.map((s) => <td key={s.key} className="py-1 text-right tabular">{d[s.key] === null ? "—" : nf.format(d[s.key]!)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="h-64" role="img" aria-label="Solde de trésorerie projeté par scénario">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v) => nf.format(v).replace(/\s?€/, "")} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={70} />
              <Tooltip formatter={(v, name) => [nf.format(Number(v)), labels[String(name)] ?? name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend formatter={(v) => labels[v] ?? v} wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" />
              <ReferenceLine y={threshold} stroke="var(--status-critical)" strokeDasharray="4 3" label={{ value: labels.threshold, fontSize: 10, fill: "var(--muted-foreground)", position: "insideTopLeft" }} />
              {SERIES.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <button className="mt-2 text-xs text-muted-foreground underline" onClick={() => setTable(!table)}>{table ? "Voir le graphique" : "Voir le tableau"}</button>
    </div>
  );
}
