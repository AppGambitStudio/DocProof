import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/api";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState } from "../../components/EmptyState";
import type { JobSummary, JobListResponse, JobStatus } from "../../lib/job-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(createdAt: string, completedAt?: string): string {
  if (!completedAt) return "\u2014";
  const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  if (ms < 0) return "\u2014";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatCost(cost?: number): string {
  if (cost == null) return "\u2014";
  return `$${cost.toFixed(6)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) + "\u2026" : id;
}

const PROCESSING_STATUSES: JobStatus[] = [
  "created",
  "uploading",
  "extracting",
  "validating",
];

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

interface FilterTab {
  label: string;
  value: string; // query‐param value or "all"
  statusParam?: string; // what we send to the API
}

const TABS: FilterTab[] = [
  { label: "All", value: "all" },
  { label: "Processing", value: "processing", statusParam: "processing" },
  { label: "Completed", value: "completed", statusParam: "completed" },
  { label: "Failed", value: "failed", statusParam: "failed" },
  { label: "Review Required", value: "review_required", statusParam: "review_required" },
  { label: "Approved", value: "approved", statusParam: "approved" },
  { label: "Rejected", value: "rejected", statusParam: "rejected" },
];

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JobList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get("status") || "all";

  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [totalCount, setTotalCount] = useState(0);

  // Track whether any jobs are still processing (for auto‐refresh)
  const hasProcessing = jobs.some((j) =>
    PROCESSING_STATUSES.includes(j.status)
  );

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- fetch helpers -------------------------------------------------------

  const buildPath = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      const tab = TABS.find((t) => t.value === activeTab);
      if (tab?.statusParam) params.set("status", tab.statusParam);
      if (cursor) params.set("cursor", cursor);
      return `/admin/jobs?${params.toString()}`;
    },
    [activeTab]
  );

  const fetchJobs = useCallback(
    async (cursor?: string) => {
      try {
        if (!cursor) setLoading(true);
        else setLoadingMore(true);
        setError(null);

        const data = await apiClient.get<JobListResponse>(buildPath(cursor));

        if (cursor) {
          setJobs((prev) => [...prev, ...data.jobs]);
        } else {
          setJobs(data.jobs);
        }
        setNextCursor(data.nextCursor);
        setTotalCount(data.count);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [buildPath]
  );

  // ---- effects -------------------------------------------------------------

  // Initial fetch + refetch when filter changes
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Auto‐refresh every 10 s when processing jobs exist
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (hasProcessing) {
      intervalRef.current = setInterval(() => {
        fetchJobs();
      }, 10_000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hasProcessing, fetchJobs]);

  // ---- event handlers ------------------------------------------------------

  function onTabChange(value: string) {
    if (value === "all") {
      setSearchParams({});
    } else {
      setSearchParams({ status: value });
    }
  }

  // ---- render --------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            {totalCount > 0
              ? `${totalCount} job${totalCount === 1 ? "" : "s"} total`
              : "Monitor document verification jobs"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/jobs/new")}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Job
          </button>
        {hasProcessing && (
          <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            Auto-refreshing
          </span>
        )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6" aria-label="Status filter">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => onTabChange(tab.value)}
                className={`whitespace-nowrap pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <div className="flex">
            <svg
              className="h-5 w-5 text-red-400 mr-2 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.707-10.293a1 1 0 011.414 0l.293.293.293-.293a1 1 0 011.414 1.414L12.414 9l.293.293a1 1 0 01-1.414 1.414L11 10.414l-.293.293a1 1 0 01-1.414-1.414l.293-.293-.293-.293a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm text-red-700">{error}</p>
              <button
                onClick={() => fetchJobs()}
                className="mt-2 text-sm font-medium text-red-600 hover:text-red-500 underline"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {[
                  "Job ID",
                  "Status",
                  "RuleSet",
                  "External Ref",
                  "Files",
                  "Cost",
                  "Created",
                  "Duration",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}

              {!loading && jobs.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No jobs found"
                      description={
                        activeTab === "all"
                          ? "No verification jobs have been created yet."
                          : `No jobs with status "${activeTab.replace("_", " ")}".`
                      }
                      action={
                        activeTab === "all" ? (
                          <button
                            onClick={() => navigate("/jobs/new")}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            Create Job
                          </button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              )}

              {!loading &&
                jobs.map((job) => (
                  <tr
                    key={job.jobId}
                    onClick={() => navigate(`/jobs/${job.jobId}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-mono text-blue-600">
                      {truncateId(job.jobId)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                      {truncateId(job.ruleSetId)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {job.externalRef || "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {job.fileCount}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                      {formatCost(job.costUsd)}
                    </td>
                    <td
                      className="px-4 py-3 text-sm text-gray-500"
                      title={new Date(job.createdAt).toLocaleString()}
                    >
                      {timeAgo(job.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDuration(job.createdAt, job.completedAt)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Load more */}
        {nextCursor && !loading && (
          <div className="border-t border-gray-200 px-4 py-3 flex justify-center">
            <button
              onClick={() => fetchJobs(nextCursor)}
              disabled={loadingMore}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-500"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Loading...
                </>
              ) : (
                "Load more"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
