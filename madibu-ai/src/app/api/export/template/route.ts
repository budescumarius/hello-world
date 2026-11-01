import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { EXAMPLES, type ImportKind, TEMPLATES, toCsv } from "@/lib/csv";

export async function GET(req: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  const kind = new URL(req.url).searchParams.get("kind") as ImportKind;
  if (!(kind in TEMPLATES)) return NextResponse.json({ error: "Type inconnu" }, { status: 400 });
  return new NextResponse(toCsv(TEMPLATES[kind], [EXAMPLES[kind]]), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="madibu-modele-${kind}.csv"` },
  });
}
