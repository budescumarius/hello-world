import { PartyPage } from "../_parties/party-page";

export const metadata = { title: "Clients" };

export default async function Page({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const sp = await searchParams;
  return <PartyPage kind="clients" archived={sp.archived === "1"} />;
}
