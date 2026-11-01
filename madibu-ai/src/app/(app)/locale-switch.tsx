"use client";
import { useTransition } from "react";
import { setLocale } from "./_actions";

export function LocaleSwitch({ locale }: { locale: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1" aria-label="Langue">
      {(["fr", "ro"] as const).map((l) => (
        <button key={l} disabled={pending || l === locale} onClick={() => start(async () => { await setLocale(l); })}
          className={l === locale ? "rounded bg-white/15 px-2 py-0.5 text-white" : "rounded px-2 py-0.5 hover:text-white"}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
