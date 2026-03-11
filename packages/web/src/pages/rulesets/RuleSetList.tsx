import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/api";
import { RuleSet } from "../../lib/types";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState } from "../../components/EmptyState";

export function RuleSetList() {
  const navigate = useNavigate();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadRuleSets();
  }, []);

  async function loadRuleSets() {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.get<{ ruleSets: RuleSet[] }>("/admin/rule-sets");
      setRuleSets(data.ruleSets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rule sets");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      setError(null);
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.id || !data.name) {
        setError("Invalid ruleset JSON: missing 'id' or 'name' field");
        return;
      }

      await apiClient.post("/admin/rule-sets", {
        id: data.id,
        name: data.name,
        description: data.description,
        version: data.version ?? 1,
        status: data.status ?? "draft",
        documentTypes: data.documentTypes ?? [],
        fieldRules: data.fieldRules ?? [],
        crossDocRules: data.crossDocRules ?? [],
        metadataRules: data.metadataRules ?? [],
        promptConfig: data.promptConfig,
      });

      navigate(`/rulesets/${data.id}`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError("Invalid JSON file");
      } else {
        setError(err instanceof Error ? err.message : "Failed to import rule set");
      }
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const filtered = ruleSets.filter(
    (rs) =>
      rs.name.toLowerCase().includes(search.toLowerCase()) ||
      rs.id.toLowerCase().includes(search.toLowerCase())
  );

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">RuleSets</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage document verification rule sets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {importing ? "Importing..." : "Import JSON"}
          </button>
          <button
            onClick={() => navigate("/rulesets/new")}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New RuleSet
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
      </div>

      {/* Content */}
      {loading && <LoadingSkeleton />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm text-red-700">{error}</p>
          </div>
          <button
            onClick={loadRuleSets}
            className="mt-2 text-sm font-medium text-red-700 hover:text-red-800 underline"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200">
          <EmptyState
            title={search ? "No matching rule sets" : "No rule sets yet"}
            description={
              search
                ? "Try adjusting your search terms"
                : "Create your first rule set to start verifying documents"
            }
            action={
              !search ? (
                <button
                  onClick={() => navigate("/rulesets/new")}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Create RuleSet
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                  Name
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                  ID
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                  Version
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                  Doc Types
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map((rs) => (
                <tr
                  key={rs.id}
                  onClick={() => navigate(`/rulesets/${rs.id}`)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-gray-900">{rs.name}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-500 font-mono">{rs.id}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-500">v{rs.version}</span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={rs.status} />
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-500">
                      {rs.documentTypes?.length ?? 0}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-500">{formatDate(rs.updatedAt)}</span>
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

function LoadingSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
        <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-6 py-4 border-b border-gray-100 flex gap-6">
          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-12 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-8 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
