import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function JobsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const jobs = await prisma.renderJob.findMany({
    where: {
      variant: { template: { organizationId: session.user.organizationId } },
    },
    include: {
      variant: { include: { template: { select: { name: true } } } },
      submittedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Render Queue</h2>

      {jobs.length === 0 ? (
        <p className="text-gray-500">No render jobs yet.</p>
      ) : (
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left px-4 py-3">Variant</th>
                <th className="text-left px-4 py-3">Template</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Progress</th>
                <th className="text-left px-4 py-3">Submitted by</th>
                <th className="text-left px-4 py-3">Created</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/50"
                >
                  <td className="px-4 py-3">{job.variant.name}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {job.variant.template.name}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3">
                    {job.status === "RENDERING" || job.status === "ENCODING" ? (
                      <div className="w-20 bg-gray-700 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    ) : job.status === "COMPLETED" ? (
                      <span className="text-green-400 text-xs">100%</span>
                    ) : (
                      <span className="text-gray-600 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {job.submittedBy.name}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(job.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {job.status === "COMPLETED" && job.outputPath && (
                      <a
                        href={`/api/jobs/${job.id}?download=true`}
                        className="text-blue-400 hover:text-blue-300 text-xs"
                      >
                        Download
                      </a>
                    )}
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: "bg-gray-700 text-gray-300",
    QUEUED: "bg-yellow-900/50 text-yellow-400",
    RENDERING: "bg-blue-900/50 text-blue-400",
    ENCODING: "bg-purple-900/50 text-purple-400",
    COMPLETED: "bg-green-900/50 text-green-400",
    FAILED: "bg-red-900/50 text-red-400",
  };

  return (
    <span
      className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.PENDING}`}
    >
      {status}
    </span>
  );
}
