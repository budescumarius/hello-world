import { PartyPage } from "../_parties/party-page";

export const metadata = { title: "Fournisseurs" };

export default async function Page({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const sp = await searchParams;
  return <PartyPage kind="suppliers" archived={sp.archived === "1"} />;
}
