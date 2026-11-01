import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/lib/auth";
import { env } from "@/lib/env";
import { getMessages } from "@/lib/i18n";
import { Chat } from "./chat";

export const metadata = { title: "Assistant IA" };

export default async function AssistantPage() {
  const user = await requirePermission("assistant.use");
  const t = getMessages(user.locale);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t.assistant.title} description={t.assistant.intro} />
      <Chat t={t.assistant} enabled={env.aiEnabled()} />
    </div>
  );
}
