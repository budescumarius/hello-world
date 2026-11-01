"use client";
import { SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/app/markdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { Messages } from "@/lib/i18n";

type Msg = { role: "user" | "assistant"; content: string; actions?: Array<{ tool: string }> };

export function Chat({ t, enabled }: { t: Messages["assistant"]; enabled: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  // conversation conservée en mémoire uniquement (aucune donnée financière stockée dans le navigateur)
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text.trim() }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-20).map(({ role, content }) => ({ role, content })) }) });
      const data = await res.json();
      setMsgs([...next, { role: "assistant", content: data.reply ?? data.error ?? "Erreur", actions: data.actions }]);
    } catch {
      setMsgs([...next, { role: "assistant", content: "Erreur réseau." }]);
    } finally { setBusy(false); }
  }

  if (!enabled) return <Card className="p-5 text-sm text-muted-foreground">{t.disabled}</Card>;
  return (
    <Card className="flex h-[calc(100dvh-14rem)] min-h-96 flex-col gap-0 p-0">
      <div className="flex-1 space-y-3 overflow-y-auto p-4" data-testid="chat-log">
        {!msgs.length ? <div className="flex flex-wrap gap-2">{t.suggestions.map((s) => <Button key={s} size="sm" variant="outline" onClick={() => send(s)}>{s}</Button>)}</div> : null}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground" : "max-w-[95%] rounded-xl border bg-card px-3 py-2"}>
            {m.role === "assistant" ? <Markdown source={m.content} /> : m.content}
            {m.actions?.length ? <div className="mt-2 border-t pt-1 text-xs text-muted-foreground">{t.actions} : {m.actions.map((a) => a.tool === "create_task" ? "tâche créée" : "demande d'approbation déposée").join(", ")}</div> : null}
          </div>
        ))}
        {busy ? <div className="text-sm text-muted-foreground">{t.thinking}</div> : null}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.placeholder} className="min-h-10 flex-1 resize-none" rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
        <div className="flex flex-col gap-1">
          <Button type="submit" disabled={busy || !input.trim()} aria-label={t.send}><SendIcon /></Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMsgs([])} title={t.newChat}>↺</Button>
        </div>
      </form>
    </Card>
  );
}
