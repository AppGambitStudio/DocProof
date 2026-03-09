import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardStats {
  jobs: {
    total: number;
    processing: number;
    completed: number;
    failed: number;
    reviewRequired: number;
    byStatus: Record<string, number>;
  };
  ruleSets: {
    active: number;
  };
  cost: {
    totalUsd: number;
  };
  recentCompleted: Array<{
    jobId: string;
    ruleSetId: string;
    externalRef?: string;
    costUsd: number;
    fileCount: number;
    completedAt: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 30_000;

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

function formatTimestamp(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  created: "bg-gray-400",
  pending: "bg-gray-400",
  extracting: "bg-blue-300",
  processing: "bg-blue-500",
  validating: "bg-indigo-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  review_required: "bg-yellow-500",
  reviewRequired: "bg-yellow-500",
  review: "bg-yellow-500",
  archived: "bg-gray-300",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "bg-gray-400";
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Sub-sections (inline, not exported)
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  subtitle,
  accent,
  icon,
}: {
  label: string;
  value: number | string;
  subtitle: string;
  accent: string;
  icon: string;
}) {
  return (
    <div
      className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 border-l-4 ${accent}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
          <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
        </div>
        <span className="text-2xl" aria-hidden="true">
          {icon}
        </span>
      </div>
    </div>
  );
}

function StatusBar({ byStatus, total }: { byStatus: Record<string, number>; total: number }) {
  if (total === 0) {
    return (
      <p className="text-sm text-gray-400 italic">No job data yet.</p>
    );
  }

  const entries = Object.entries(byStatus).filter(([, v]) => v > 0);
  entries.sort((a, b) => b[1] - a[1]);

  return (
    <div>
      {/* Stacked bar */}
      <div className="flex h-6 rounded-full overflow-hidden">
        {entries.map(([status, count]) => {
          const pct = (count / total) * 100;
          return (
            <div
              key={status}
              className={`${statusColor(status)} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${formatStatus(status)}: ${count} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([status, count]) => {
          const pct = ((count / total) * 100).toFixed(1);
          return (
            <span key={status} className="inline-flex items-center text-xs text-gray-600">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full mr-1.5 ${statusColor(status)}`}
              />
              {formatStatus(status)}{" "}
              <span className="ml-1 text-gray-400">
                {count} ({pct}%)
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function RecentJobsTable({
  jobs,
}: {
  jobs: DashboardStats["recentCompleted"];
}) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 text-sm">No completed jobs yet.</p>
        <p className="text-gray-300 text-xs mt-1">
          Completed jobs will appear here once processing finishes.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <th className="py-3 pr-4">Job ID</th>
            <th className="py-3 pr-4">RuleSet</th>
            <th className="py-3 pr-4">External Ref</th>
            <th className="py-3 pr-4 text-right">Files</th>
            <th className="py-3 pr-4 text-right">Cost</th>
            <th className="py-3 text-right">Completed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {jobs.slice(0, 10).map((job) => (
            <tr key={job.jobId} className="hover:bg-gray-50 transition-colors">
              <td className="py-3 pr-4">
                <Link
                  to={`/jobs/${job.jobId}`}
                  className="text-blue-600 hover:text-blue-800 font-mono text-xs"
                >
                  {job.jobId.length > 12
                    ? `${job.jobId.slice(0, 12)}...`
                    : job.jobId}
                </Link>
              </td>
              <td className="py-3 pr-4 text-gray-700 font-mono text-xs">
                {job.ruleSetId.length > 12
                  ? `${job.ruleSetId.slice(0, 12)}...`
                  : job.ruleSetId}
              </td>
              <td className="py-3 pr-4 text-gray-500">
                {job.externalRef || <span className="text-gray-300">--</span>}
              </td>
              <td className="py-3 pr-4 text-right text-gray-700">
                {job.fileCount}
              </td>
              <td className="py-3 pr-4 text-right text-gray-700">
                {formatCost(job.costUsd)}
              </td>
              <td className="py-3 text-right text-gray-400 whitespace-nowrap">
                {relativeTime(job.completedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const data = await apiClient.get<DashboardStats>("/admin/stats");
      setStats(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard stats");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats(true);
    const interval = setInterval(() => fetchStats(false), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-600 font-medium">Failed to load dashboard</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
          <button
            onClick={() => fetchStats(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const successRate =
    stats.jobs.total > 0
      ? ((stats.jobs.completed / stats.jobs.total) * 100).toFixed(1)
      : "0";

  const avgCost =
    stats.jobs.total > 0
      ? formatCost(stats.cost.totalUsd / stats.jobs.total)
      : "--";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-3">
          {error && (
            <span className="text-xs text-red-500">Refresh failed</span>
          )}
          {lastUpdated && (
            <span className="text-xs text-gray-400">
              Last updated: {formatTimestamp(lastUpdated)}
            </span>
          )}
          <button
            onClick={() => fetchStats(false)}
            className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label="Total Jobs"
          value={stats.jobs.total.toLocaleString()}
          subtitle="all time"
          accent="border-l-gray-400"
          icon="&#128202;"
        />
        <StatCard
          label="Processing"
          value={stats.jobs.processing.toLocaleString()}
          subtitle="in progress"
          accent="border-l-blue-500"
          icon="&#9881;&#65039;"
        />
        <StatCard
          label="Completed"
          value={stats.jobs.completed.toLocaleString()}
          subtitle={`success rate: ${successRate}%`}
          accent="border-l-green-500"
          icon="&#9989;"
        />
        <StatCard
          label="Failed / Review"
          value={(stats.jobs.failed + stats.jobs.reviewRequired).toLocaleString()}
          subtitle={`${stats.jobs.failed} failed, ${stats.jobs.reviewRequired} review`}
          accent="border-l-red-500"
          icon="&#9888;&#65039;"
        />
      </div>

      {/* Middle row: RuleSets + Cost + Status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active RuleSets */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">Active RuleSets</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {stats.ruleSets.active}
          </p>
          <Link
            to="/rulesets"
            className="mt-3 inline-block text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            Manage rulesets &rarr;
          </Link>
        </div>

        {/* Cost Summary */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">Total Cost</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {formatCost(stats.cost.totalUsd)}
          </p>
          {stats.jobs.total > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              avg per job: {avgCost}
            </p>
          )}
        </div>

        {/* Job Status Breakdown */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500 mb-3">
            Job Status Breakdown
          </p>
          <StatusBar byStatus={stats.jobs.byStatus} total={stats.jobs.total} />
        </div>
      </div>

      {/* Recent Completed Jobs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
            Recent Completed Jobs
          </h2>
          <Link
            to="/jobs"
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            View all jobs &rarr;
          </Link>
        </div>
        <RecentJobsTable jobs={stats.recentCompleted} />
      </div>
    </div>
  );
}
