"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { commitImport, type ImportPreview, previewImport } from "./import-actions";

export function ImportPanel({ labels }: { labels: { preview: string; commit: string; help: string; valid: string; invalid: string } }) {
  const [kind, setKind] = useState("projects");
  const [text, setText] = useState("");
  const [res, setRes] = useState<ImportPreview | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{labels.help}</p>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="w-48" value={kind} onChange={(e) => { setKind(e.target.value); setRes(null); }} aria-label="Type d'import">
          <option value="projects">Chantiers</option><option value="invoices">Factures</option><option value="expenses">Dépenses</option>
        </NativeSelect>
        <a className="text-sm underline" href={`/api/export/template?kind=${kind}`}>Modèle CSV</a>
        <input type="file" accept=".csv,text/csv" data-testid="csv-file" className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; setRes(null); setText(f ? await f.text() : ""); }} />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" disabled={!text || pending} onClick={() => start(async () => setRes(await previewImport(kind, text)))}>{labels.preview}</Button>
        <Button disabled={!res?.ok || pending} data-testid="csv-commit" onClick={() => start(async () => {
          const r = await commitImport(kind, text); setRes(r);
          if (r.committed) toast.success(`${r.committed} ligne(s) importée(s)`); else toast.error(r.error ?? "Import refusé");
        })}>{labels.commit}</Button>
      </div>
      {res ? (
        <div className="rounded-md border p-3 text-sm" data-testid="csv-result">
          <div><strong>{res.valid}</strong> {labels.valid} / {res.total} · <strong className={res.errors.length ? "text-critical" : ""}>{new Set(res.errors.map((e) => e.row)).size}</strong> {labels.invalid}</div>
          {res.committed ? <div className="text-good">✔ {res.committed} ligne(s) écrite(s).</div> : null}
          {res.error ? <div className="text-critical">{res.error}</div> : null}
          {res.headerErrors.map((h) => <div key={h} className="text-critical">{h}</div>)}
          {res.notes.map((n) => <div key={n} className="text-muted-foreground">{n}</div>)}
          {res.errors.length ? <ul className="mt-2 max-h-64 list-disc overflow-y-auto pl-5 text-xs">{res.errors.map((e, i) => <li key={i}>Ligne {e.row} · {e.field} : {e.message}</li>)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}
