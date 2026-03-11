import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../lib/api";
import { RuleSet } from "../../lib/types";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState } from "../../components/EmptyState";

type Tab = "documentTypes" | "fieldRules" | "crossDocRules" | "metadataRules" | "promptConfig";

export function RuleSetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ruleSet, setRuleSet] = useState<RuleSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("documentTypes");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (id) loadRuleSet();
  }, [id]);

  async function loadRuleSet() {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.get<RuleSet>(`/admin/rule-sets/${id}`);
      setRuleSet(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rule set");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    try {
      setDeleting(true);
      await apiClient.del(`/admin/rule-sets/${id}`);
      navigate("/rulesets");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rule set");
      setShowDeleteModal(false);
      setDeleting(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (loading) {
    return <DetailSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-700">{error}</p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={loadRuleSet}
            className="text-sm font-medium text-red-700 hover:text-red-800 underline"
          >
            Retry
          </button>
          <button
            onClick={() => navigate("/rulesets")}
            className="text-sm font-medium text-gray-600 hover:text-gray-800 underline"
          >
            Back to list
          </button>
        </div>
      </div>
    );
  }

  if (!ruleSet) return null;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "documentTypes", label: "Document Types", count: ruleSet.documentTypes?.length },
    { key: "fieldRules", label: "Field Rules", count: ruleSet.fieldRules?.length },
    { key: "crossDocRules", label: "Cross-Doc Rules", count: ruleSet.crossDocRules?.length },
    { key: "metadataRules", label: "Metadata Rules", count: ruleSet.metadataRules?.length },
    ...(ruleSet.promptConfig ? [{ key: "promptConfig" as Tab, label: "Prompt Config" }] : []),
  ];

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => navigate("/rulesets")}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to RuleSets
      </button>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{ruleSet.name}</h1>
              <StatusBadge status={ruleSet.status} size="md" />
            </div>
            {ruleSet.description && (
              <p className="mt-1 text-sm text-gray-500">{ruleSet.description}</p>
            )}
            <div className="mt-3 flex items-center gap-4 text-sm text-gray-500">
              <span>
                ID: <code className="font-mono text-gray-600">{ruleSet.id}</code>
              </span>
              <span>Version: {ruleSet.version}</span>
              <span>Created: {formatDate(ruleSet.createdAt)}</span>
              <span>Updated: {formatDate(ruleSet.updatedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const exportData = {
                  id: ruleSet.id,
                  name: ruleSet.name,
                  description: ruleSet.description,
                  version: ruleSet.version,
                  status: ruleSet.status,
                  documentTypes: ruleSet.documentTypes,
                  fieldRules: ruleSet.fieldRules,
                  crossDocRules: ruleSet.crossDocRules,
                  metadataRules: ruleSet.metadataRules,
                  promptConfig: ruleSet.promptConfig,
                };
                const blob = new Blob(
                  [JSON.stringify(exportData, null, 2)],
                  { type: "application/json" }
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${ruleSet.id}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Export JSON
            </button>
            <button
              onClick={() => navigate(`/rulesets/${id}/edit`)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              Edit
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-0 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "documentTypes" && <DocumentTypesTab ruleSet={ruleSet} />}
      {activeTab === "fieldRules" && <FieldRulesTab ruleSet={ruleSet} />}
      {activeTab === "crossDocRules" && <CrossDocRulesTab ruleSet={ruleSet} />}
      {activeTab === "metadataRules" && <MetadataRulesTab ruleSet={ruleSet} />}
      {activeTab === "promptConfig" && <PromptConfigTab ruleSet={ruleSet} />}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowDeleteModal(false)}
          />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900">Delete RuleSet</h3>
            <p className="mt-2 text-sm text-gray-500">
              Are you sure you want to delete <strong>{ruleSet.name}</strong>? This will also
              delete all associated document type records. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentTypesTab({ ruleSet }: { ruleSet: RuleSet }) {
  const docTypes = ruleSet.documentTypes || [];

  if (docTypes.length === 0) {
    return (
      <EmptyState
        title="No document types configured"
        description="Add document types to define what documents this rule set can process"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {docTypes.map((dt) => (
        <div key={dt.typeId} className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{dt.label}</h3>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{dt.typeId}</p>
            </div>
            <div className="flex gap-1.5">
              {dt.required && (
                <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                  Required
                </span>
              )}
              {dt.category && (
                <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                  {dt.category}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Max count</span>
              <span className="text-gray-900">{dt.maxCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Accepted formats</span>
              <span className="text-gray-900">{dt.acceptedFormats?.join(", ") || "Any"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Expected fields</span>
              <span className="text-gray-900">{dt.expectedFields?.length ?? 0}</span>
            </div>
          </div>

          {dt.satisfiesTypes && dt.satisfiesTypes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">Satisfies types: </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {dt.satisfiesTypes.map((tid) => (
                  <span
                    key={tid}
                    className="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded"
                  >
                    {tid}
                  </span>
                ))}
              </div>
            </div>
          )}

          {dt.applicableTo && dt.applicableTo.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">Applicable to: </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {dt.applicableTo.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {dt.expectedFields && dt.expectedFields.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">Fields: </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {dt.expectedFields.map((f) => (
                  <span
                    key={f.name}
                    className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                  >
                    {f.label}
                    <span className="text-gray-400 ml-1">({f.type})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FieldRulesTab({ ruleSet }: { ruleSet: RuleSet }) {
  const rules = ruleSet.fieldRules || [];

  if (rules.length === 0) {
    return (
      <EmptyState
        title="No field rules configured"
        description="Field rules define validations for extracted document fields"
      />
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Document Type
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Field
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Validations
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rules.map((rule, i) => (
            <tr key={rule.id || i}>
              <td className="px-6 py-3 text-sm font-mono text-gray-600">
                {rule.id && <span className="text-gray-400 mr-2">{rule.id}</span>}
                {rule.documentType}
              </td>
              <td className="px-6 py-3 text-sm text-gray-900">{rule.field}</td>
              <td className="px-6 py-3">
                <div className="flex flex-wrap gap-1">
                  {rule.validations.map((v, vi) => {
                    const detail = v.pattern || v.algorithm || v.format || v.prompt
                      || (v.values ? v.values.join(", ") : null)
                      || (v.min !== undefined || v.max !== undefined ? `${v.min ?? "∞"}–${v.max ?? "∞"}` : null);
                    return (
                      <span
                        key={vi}
                        className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                      >
                        {v.type}
                        {detail && `: ${detail}`}
                      </span>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CrossDocRulesTab({ ruleSet }: { ruleSet: RuleSet }) {
  const rules = ruleSet.crossDocRules || [];

  if (rules.length === 0) {
    return (
      <EmptyState
        title="No cross-document rules configured"
        description="Cross-doc rules define how fields across different documents should match"
      />
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Description
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Source
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Target
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Match Type
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Threshold
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td className="px-6 py-3 text-sm text-gray-900">{rule.description}</td>
              <td className="px-6 py-3 text-sm text-gray-600">
                <span className="font-mono text-xs">{rule.sourceDoc}</span>
                <span className="text-gray-400 mx-1">.</span>
                <span>{rule.sourceField}</span>
              </td>
              <td className="px-6 py-3 text-sm text-gray-600">
                <span className="font-mono text-xs">{rule.targetDoc}</span>
                <span className="text-gray-400 mx-1">.</span>
                <span>{rule.targetField}</span>
              </td>
              <td className="px-6 py-3">
                <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded font-medium">
                  {rule.matchType}
                </span>
              </td>
              <td className="px-6 py-3 text-sm text-gray-500">
                {rule.threshold !== undefined ? `${(rule.threshold * 100).toFixed(0)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetadataRulesTab({ ruleSet }: { ruleSet: RuleSet }) {
  const rules = ruleSet.metadataRules || [];

  if (rules.length === 0) {
    return (
      <EmptyState
        title="No metadata rules configured"
        description="Metadata rules define validations for document metadata fields"
      />
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Field
            </th>
            <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
              Validations
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rules.map((rule, i) => (
            <tr key={rule.id || i}>
              <td className="px-6 py-3 text-sm font-medium text-gray-900">
                {rule.id && <span className="text-gray-400 font-mono text-xs mr-2">{rule.id}</span>}
                {rule.field}
              </td>
              <td className="px-6 py-3">
                <div className="flex flex-wrap gap-1">
                  {rule.validations.map((v, vi) => {
                    const detail = v.pattern || v.algorithm || v.format || v.prompt
                      || (v.values ? v.values.join(", ") : null)
                      || (v.min !== undefined || v.max !== undefined ? `${v.min ?? "∞"}–${v.max ?? "∞"}` : null);
                    return (
                      <span
                        key={vi}
                        className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                      >
                        {v.type}
                        {detail && `: ${detail}`}
                      </span>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PromptConfigTab({ ruleSet }: { ruleSet: RuleSet }) {
  const config = ruleSet.promptConfig;

  if (!config) {
    return (
      <EmptyState
        title="No prompt configuration"
        description="Prompt config customizes AI extraction behavior"
      />
    );
  }

  // Known fields with nice labels (rendered first, in order)
  const knownFields: { key: string; label: string }[] = [
    { key: "role", label: "Role" },
    { key: "organizationContext", label: "Organization Context" },
    { key: "customInstructions", label: "Custom Instructions" },
    { key: "contextFields", label: "Context Fields" },
    { key: "nameMatching", label: "Name Matching" },
    { key: "multiDocPerFile", label: "Multi-Doc Per File" },
    { key: "imageQualityAssessment", label: "Image Quality Assessment" },
    { key: "temperature", label: "Temperature" },
    { key: "customSystemPrompt", label: "Custom System Prompt (Override)" },
    { key: "customAnalysisPrompt", label: "Custom Analysis Prompt (Override)" },
  ];

  // Collect all keys present in the config
  const renderedKeys = new Set<string>();

  function renderValue(key: string, value: unknown) {
    if (value === null || value === undefined) return null;
    renderedKeys.add(key);

    if (typeof value === "boolean") {
      return (
        <span className={`px-2 py-0.5 text-xs rounded font-medium ${value ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {value ? "Enabled" : "Disabled"}
        </span>
      );
    }

    if (typeof value === "number") {
      return <span className="text-sm font-mono text-gray-900">{value}</span>;
    }

    if (Array.isArray(value)) {
      return (
        <div className="flex flex-wrap gap-1">
          {value.map((item, i) => (
            <span key={i} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded">
              {typeof item === "string" ? item : JSON.stringify(item)}
            </span>
          ))}
        </div>
      );
    }

    if (typeof value === "object") {
      return (
        <pre className="text-xs text-gray-700 bg-gray-50 rounded p-3 overflow-x-auto">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }

    // String — render as preformatted text for long content
    const str = String(value);
    if (str.length > 120) {
      return <p className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 rounded p-3">{str}</p>;
    }
    return <p className="text-sm text-gray-900">{str}</p>;
  }

  // Cast to Record for dynamic key access (API may return extra fields)
  const configRecord = config as unknown as Record<string, unknown>;

  // Remaining keys not in the known list
  const allKeys = Object.keys(configRecord);
  const extraKeys = allKeys.filter(
    (k) => !knownFields.some((kf) => kf.key === k) && configRecord[k] !== null && configRecord[k] !== undefined
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
      {knownFields.map(({ key, label }) => {
        const value = configRecord[key];
        if (value === null || value === undefined || value === "") return null;
        // Skip empty arrays/objects
        if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) return null;
        if (Array.isArray(value) && value.length === 0) return null;

        return (
          <div key={key}>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              {label}
            </label>
            <div className="mt-1">{renderValue(key, value)}</div>
          </div>
        );
      })}
      {extraKeys.map((key) => {
        const value = configRecord[key];
        if (renderedKeys.has(key)) return null;

        return (
          <div key={key}>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
            </label>
            <div className="mt-1">{renderValue(key, value)}</div>
          </div>
        );
      })}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="h-7 w-64 bg-gray-200 rounded mb-2" />
        <div className="h-4 w-96 bg-gray-200 rounded mb-3" />
        <div className="flex gap-4">
          <div className="h-4 w-24 bg-gray-200 rounded" />
          <div className="h-4 w-20 bg-gray-200 rounded" />
          <div className="h-4 w-32 bg-gray-200 rounded" />
        </div>
      </div>
      <div className="flex gap-4 mb-6 border-b border-gray-200 pb-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 w-24 bg-gray-200 rounded" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 h-40" />
        ))}
      </div>
    </div>
  );
}
