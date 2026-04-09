import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) return null;

  const orgId = session.user.organizationId;

  const [campaignCount, templateCount, recentJobs] = await Promise.all([
    prisma.campaign.count({ where: { organizationId: orgId, status: "ACTIVE" } }),
    prisma.template.count({ where: { organizationId: orgId, status: "PUBLISHED" } }),
    prisma.renderJob.findMany({
      where: { variant: { template: { organizationId: orgId } } },
      include: {
        variant: { include: { template: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Active Campaigns" value={campaignCount} />
        <StatCard label="Published Templates" value={templateCount} />
        <StatCard
          label="Recent Renders"
          value={recentJobs.filter((j) => j.status === "COMPLETED").length}
        />
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 mb-8">
        <Link
          href="/campaigns"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
        >
          View Campaigns
        </Link>
        <Link
          href="/jobs"
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm font-medium transition-colors"
        >
          Render Queue
        </Link>
      </div>

      {/* Recent jobs */}
      <h3 className="text-lg font-semibold mb-3">Recent Render Jobs</h3>
      {recentJobs.length === 0 ? (
        <p className="text-gray-500">No render jobs yet.</p>
      ) : (
        <div className="bg-gray-900 rounded border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left px-4 py-3">Variant</th>
                <th className="text-left px-4 py-3">Template</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {recentJobs.map((job) => (
                <tr key={job.id} className="border-b border-gray-800/50 hover:bg-gray-800/50">
                  <td className="px-4 py-3">{job.variant.name}</td>
                  <td className="px-4 py-3 text-gray-400">{job.variant.template.name}</td>
                  <td className="px-4 py-3">
                    <JobStatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(job.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-4">
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: "bg-gray-700 text-gray-300",
    QUEUED: "bg-yellow-900/50 text-yellow-400",
    RENDERING: "bg-blue-900/50 text-blue-400",
    ENCODING: "bg-purple-900/50 text-purple-400",
    COMPLETED: "bg-green-900/50 text-green-400",
    FAILED: "bg-red-900/50 text-red-400",
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.PENDING}`}>
      {status}
    </span>
  );
}
