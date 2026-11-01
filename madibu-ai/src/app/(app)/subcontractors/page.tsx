import { PartyPage } from "../_parties/party-page";

export const metadata = { title: "Sous-traitants" };

export default async function Page({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const sp = await searchParams;
  return <PartyPage kind="subcontractors" archived={sp.archived === "1"} />;
}
