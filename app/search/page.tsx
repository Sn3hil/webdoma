import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
import { SearchView } from "@/components/search-view";
import { getAccountsByUserId, getUserById } from "@/lib/db";
import { SOURCES } from "@/tor_sources/registry";

export default async function SearchPage() {
  const session = await getSession();

  if (!session.userId) {
    redirect("/login");
  }

  const user = getUserById(session.userId);
  const accounts = getAccountsByUserId(session.userId);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar username={user?.username} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <SearchView
          accounts={accounts}
          hasAccounts={accounts.length > 0}
          availableSources={SOURCES.map(s => ({ id: s.id, label: s.label }))}
        />
      </main>
    </div>
  );
}
