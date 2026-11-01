"use client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({ text }: { text: string }) {
  return <Button size="sm" variant="outline" className="mt-2" onClick={async () => { await navigator.clipboard.writeText(text); toast.success("Copié"); }}>Copier</Button>;
}
