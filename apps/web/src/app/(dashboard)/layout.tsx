import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const user = session.user;
  const isAdmin = (user as Record<string, unknown>).role === "ADMIN" || (user as Record<string, unknown>).role === "DESIGNER";

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-xl font-bold">DCO</h1>
          <p className="text-xs text-gray-500 mt-1">Dynamic Creative Optimization</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/campaigns">Campaigns</NavLink>
          {isAdmin && <NavLink href="/templates">Templates</NavLink>}
          <NavLink href="/jobs">Render Queue</NavLink>
        </nav>

        <div className="p-4 border-t border-gray-800">
          <p className="text-sm text-gray-400 truncate">{user.name}</p>
          <p className="text-xs text-gray-600 truncate">{user.email}</p>
          <form action="/api/auth/signout" method="POST" className="mt-2">
            <button
              type="submit"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 p-8">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block px-3 py-2 rounded text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
    >
      {children}
    </Link>
  );
}
