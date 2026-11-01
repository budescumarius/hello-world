import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MADIBU AI", template: "%s · MADIBU AI" },
  description: "Gestion de chantiers et contrôle financier – MADIBU GROUP",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2b2d31" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full">
      <body className="min-h-full">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
