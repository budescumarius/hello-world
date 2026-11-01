import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  const t = getMessages("fr");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-lg">
        <div className="mb-1 text-2xl font-bold tracking-wide">MADIBU <span className="font-normal text-muted-foreground">AI</span></div>
        <p className="mb-6 text-sm text-muted-foreground">{t.app.tagline}</p>
        <LoginForm t={t.auth} />
      </div>
    </main>
  );
}
