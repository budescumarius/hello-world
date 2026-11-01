import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/app/markdown";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Rapport" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const user = await requireUser();
  const sb = await createClient();
  const [{ data: report }, { data: list }] = await Promise.all([
    sb.from("reports").select("*").eq("id", id).maybeSingle(),
    sb.from("reports").select("id, kind, report_date").order("report_date", { ascending: false }).limit(30),
  ]);
  if (!report) notFound();
  return (
    <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[220px_1fr]">
      <Card><CardContent><ul className="grid gap-1 text-sm">{(list ?? []).map((r) => (
        <li key={r.id}><Link className={r.id === id ? "font-semibold" : "text-muted-foreground hover:underline"} href={`/financial/reports/${r.id}`}>
          {formatDate(r.report_date, user.locale)} · {r.kind === "daily_financial" ? "financier" : "chantiers"}</Link></li>))}</ul></CardContent></Card>
      <Card data-testid="report"><CardContent><Markdown source={report.content_md} /></CardContent></Card>
    </div>
  );
}
