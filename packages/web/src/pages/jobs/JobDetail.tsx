import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { apiClient } from "../../lib/api";
import { StatusBadge } from "../../components/StatusBadge";
import type {
  JobDetail as JobDetailType,
  JobStatus,
  DocumentResultDetail,
  DocumentAnalysis,
  CrossDocValidationResult,
  Anomaly,
  TokenUsage,
} from "../../lib/job-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROCESSING_STATUSES: JobStatus[] = [
  "created",
  "uploading",
  "extracting",
  "validating",
];

const STEP_ORDER: JobStatus[] = [
  "created",
  "uploading",
  "extracting",
  "validating",
  "completed",
];

function formatDate(iso?: string): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString();
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

function formatCost(cost?: number): string {
  if (cost == null) return "\u2014";
  return `$${cost.toFixed(6)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function confidenceColor(c: string): string {
  switch (c) {
    case "HIGH":
      return "bg-green-100 text-green-800";
    case "MEDIUM":
      return "bg-yellow-100 text-yellow-800";
    case "LOW":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function severityColor(s: string): string {
  switch (s) {
    case "critical":
      return "bg-red-100 text-red-800";
    case "high":
      return "bg-orange-100 text-orange-800";
    case "medium":
      return "bg-yellow-100 text-yellow-800";
    case "low":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function friendlyModel(modelId: string): string {
  if (modelId.includes("haiku")) return "Haiku";
  if (modelId.includes("sonnet")) return "Sonnet";
  if (modelId.includes("opus")) return "Opus";
  return modelId;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({ status }: { status: JobStatus }) {
  const currentIdx = STEP_ORDER.indexOf(status);
  const isFailed = status === "failed";
  const isReview = status === "review_required";

  return (
    <div className="flex items-center gap-1">
      {STEP_ORDER.map((step, idx) => {
        let state: "done" | "current" | "upcoming" | "error" = "upcoming";
        if (isFailed) {
          state = idx < currentIdx || currentIdx === -1 ? "done" : idx === currentIdx ? "error" : "upcoming";
          // If failed, mark the last processing step as error
          if (currentIdx === -1) {
            // status is 'failed', not in STEP_ORDER
            state = idx < STEP_ORDER.length - 1 ? "done" : "error";
          }
        } else if (isReview) {
          state = "done";
        } else if (idx < currentIdx) {
          state = "done";
        } else if (idx === currentIdx) {
          state = "current";
        }

        const circleClass =
          state === "done"
            ? "bg-green-500 text-white"
            : state === "current"
            ? "bg-blue-500 text-white ring-4 ring-blue-100"
            : state === "error"
            ? "bg-red-500 text-white"
            : "bg-gray-200 text-gray-500";

        return (
          <div key={step} className="flex items-center">
            {idx > 0 && (
              <div
                className={`h-0.5 w-8 mx-1 ${
                  state === "upcoming" ? "bg-gray-200" : "bg-green-500"
                }`}
              />
            )}
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${circleClass}`}
              >
                {state === "done" ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : state === "error" ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : state === "current" ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                  </span>
                ) : (
                  idx + 1
                )}
              </div>
              <span className="mt-1 text-[10px] text-gray-500 capitalize whitespace-nowrap">
                {step === "completed" ? "Complete" : step}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${color || "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Overview
// ---------------------------------------------------------------------------

function OverviewTab({ job }: { job: JobDetailType }) {
  const r = job.result;
  if (!r) return null;

  return (
    <div className="space-y-6">
      {/* Overall status */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-500">
          Overall Result:
        </span>
        <StatusBadge status={r.overallStatus} size="md" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Documents" value={r.summary.totalDocuments} />
        <SummaryCard
          label="Valid"
          value={r.summary.valid}
          color="text-green-600"
        />
        <SummaryCard
          label="Invalid"
          value={r.summary.invalid}
          color="text-red-600"
        />
        <SummaryCard
          label="Anomalies"
          value={r.summary.anomalies}
          color={r.summary.anomalies > 0 ? "text-yellow-600" : undefined}
        />
      </div>

      {/* Token usage summary */}
      {r.tokenUsage && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Token Usage Summary
          </h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-500">Input Tokens</p>
              <p className="text-lg font-semibold text-gray-900">
                {formatTokens(r.tokenUsage.total.inputTokens)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Output Tokens</p>
              <p className="text-lg font-semibold text-gray-900">
                {formatTokens(r.tokenUsage.total.outputTokens)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Cost</p>
              <p className="text-lg font-semibold text-gray-900">
                {formatCost(r.costUsd)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Documents
// ---------------------------------------------------------------------------

function DocumentCard({ doc }: { doc: DocumentResultDetail }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg
            className="w-5 h-5 text-gray-400 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {doc.fileName}
            </p>
            <p className="text-xs text-gray-500">{doc.documentType}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <StatusBadge status={doc.status} />
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-200 px-5 py-4 space-y-5">
          {/* Analyses */}
          {doc.analyses.map((a, i) => (
            <AnalysisSection key={i} analysis={a} index={i} />
          ))}

          {/* Field validation results */}
          {doc.fieldResults.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Field Validation Results
              </h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Field
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Rule
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Status
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Message
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {doc.fieldResults.map((fr, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-mono text-xs">
                          {fr.field}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          {fr.ruleId}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={fr.status} />
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          {fr.message || "\u2014"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisSection({
  analysis,
  index,
}: {
  analysis: DocumentAnalysis;
  index: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Analysis {index + 1}
        </h4>
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${confidenceColor(
            analysis.confidence
          )}`}
        >
          {analysis.confidence}
        </span>
        {analysis.confidenceReason && (
          <span className="text-xs text-gray-400">
            ({analysis.confidenceReason})
          </span>
        )}
      </div>

      {/* Extracted fields */}
      {Object.keys(analysis.extractedFields).length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">
            Extracted Fields
          </p>
          <div className="bg-gray-50 rounded-md p-3">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(analysis.extractedFields).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-2">
                  <dt className="text-xs font-mono text-gray-500 flex-shrink-0">
                    {k}:
                  </dt>
                  <dd className="text-xs text-gray-900 break-all">
                    {String(v ?? "\u2014")}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Name match */}
      {analysis.nameOnDocument && (
        <p className="text-xs text-gray-600">
          <span className="font-medium">Name on document:</span>{" "}
          {analysis.nameOnDocument}
          {analysis.nameMatchStatus && (
            <span className="ml-2">
              <StatusBadge status={analysis.nameMatchStatus.toLowerCase()} />
            </span>
          )}
        </p>
      )}

      {/* Image quality */}
      {analysis.imageQuality && (
        <p className="text-xs text-gray-600">
          <span className="font-medium">Image quality:</span> Legibility:{" "}
          {analysis.imageQuality.legibility}, Completeness:{" "}
          {analysis.imageQuality.completeness}
        </p>
      )}

      {/* Observations */}
      {analysis.observations && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">
            Observations
          </p>
          <p className="text-xs text-gray-700 bg-gray-50 rounded-md p-3 whitespace-pre-wrap">
            {analysis.observations}
          </p>
        </div>
      )}

      {/* Anomalies */}
      {analysis.anomalies.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-600 mb-1">Anomalies</p>
          <ul className="list-disc list-inside space-y-0.5">
            {analysis.anomalies.map((a, i) => (
              <li key={i} className="text-xs text-red-700">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DocumentsTab({ job }: { job: JobDetailType }) {
  const docs = job.result?.documents;
  if (!docs || docs.length === 0)
    return (
      <p className="text-sm text-gray-500 py-6 text-center">
        No document results available.
      </p>
    );

  return (
    <div className="space-y-4">
      {docs.map((doc) => (
        <DocumentCard key={doc.fileId} doc={doc} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Cross-Document Validation
// ---------------------------------------------------------------------------

function CrossDocTab({ results }: { results: CrossDocValidationResult[] }) {
  if (results.length === 0)
    return (
      <p className="text-sm text-gray-500 py-6 text-center">
        No cross-document validations.
      </p>
    );

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {[
                "Description",
                "Source Value",
                "Target Value",
                "Status",
                "Confidence",
                "Reasoning",
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
          <tbody className="divide-y divide-gray-200">
            {results.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {r.description}
                </td>
                <td className="px-4 py-3 text-sm font-mono text-gray-700">
                  {r.sourceValue || "\u2014"}
                </td>
                <td className="px-4 py-3 text-sm font-mono text-gray-700">
                  {r.targetValue || "\u2014"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {r.confidence || "\u2014"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                  {r.reasoning || "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Anomalies
// ---------------------------------------------------------------------------

function AnomaliesTab({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0)
    return (
      <p className="text-sm text-gray-500 py-6 text-center">
        No anomalies detected.
      </p>
    );

  return (
    <div className="space-y-3">
      {anomalies.map((a, i) => (
        <div
          key={i}
          className="bg-white rounded-lg border border-gray-200 p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
              {a.type}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full capitalize ${severityColor(
                a.severity
              )}`}
            >
              {a.severity}
            </span>
          </div>
          <p className="text-sm text-gray-900">{a.message}</p>
          {a.relatedDocuments && a.relatedDocuments.length > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              Related: {a.relatedDocuments.join(", ")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Token Usage
// ---------------------------------------------------------------------------

function TokenUsageTab({ job }: { job: JobDetailType }) {
  const tu = job.result?.tokenUsage;
  if (!tu)
    return (
      <p className="text-sm text-gray-500 py-6 text-center">
        No token usage data available.
      </p>
    );

  const allEntries: (TokenUsage & { phase: string })[] = [
    ...(tu.extraction ?? []).map((t) => ({ ...t, phase: "Extraction" })),
    ...(tu.validation ?? []).map((t) => ({ ...t, phase: "Validation" })),
  ];

  const totalCost = allEntries.reduce((s, e) => s + e.cost, 0);

  return (
    <div className="space-y-4">
      {/* Breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Extraction</p>
          <p className="text-sm font-medium text-gray-900">
            {formatTokens(
              (tu.extraction ?? []).reduce((s, e) => s + e.totalTokens, 0)
            )}{" "}
            tokens
          </p>
          <p className="text-xs text-gray-500">
            {formatCost((tu.extraction ?? []).reduce((s, e) => s + e.cost, 0))}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Validation</p>
          <p className="text-sm font-medium text-gray-900">
            {formatTokens(
              (tu.validation ?? []).reduce((s, e) => s + e.totalTokens, 0)
            )}{" "}
            tokens
          </p>
          <p className="text-xs text-gray-500">
            {formatCost((tu.validation ?? []).reduce((s, e) => s + e.cost, 0))}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {[
                  "File",
                  "Phase",
                  "Model",
                  "Input Tokens",
                  "Output Tokens",
                  "Cost",
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
            <tbody className="divide-y divide-gray-200">
              {allEntries.map((e, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 text-sm text-gray-900 truncate max-w-[200px]">
                    {e.fileName || "\u2014"}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">
                    {e.phase}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700">
                    {friendlyModel(e.modelId)}
                  </td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-700">
                    {e.inputTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-700">
                    {e.outputTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-700">
                    {formatCost(e.cost)}
                  </td>
                </tr>
              ))}
              {/* Total row */}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-2 text-sm" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-2 text-sm font-mono">
                  {tu.total.inputTokens.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-sm font-mono">
                  {tu.total.outputTokens.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-sm font-mono">
                  {formatCost(totalCost)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files Section
// ---------------------------------------------------------------------------

function FilePreview({ url, mimeType }: { url: string; mimeType: string }) {
  if (mimeType === "application/pdf") {
    return (
      <iframe
        src={url}
        className="w-full h-[500px] rounded border border-gray-200"
        title="Document preview"
      />
    );
  }

  if (mimeType.startsWith("image/")) {
    return (
      <img
        src={url}
        alt="Document preview"
        className="max-w-full max-h-[500px] rounded border border-gray-200 object-contain"
      />
    );
  }

  return (
    <p className="text-sm text-gray-500 py-4 text-center">
      Preview not available for {mimeType}
    </p>
  );
}

function FilesSection({ job }: { job: JobDetailType }) {
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);

  if (job.files.length === 0) return null;

  const previewFile = previewFileId
    ? job.files.find((f) => f.fileId === previewFileId)
    : null;
  const previewUrl = previewFileId ? job.fileUrls?.[previewFileId] : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">
          Uploaded Files ({job.files.length})
        </h3>
      </div>
      <ul className="divide-y divide-gray-200">
        {job.files.map((f) => {
          const hasUrl = !!job.fileUrls?.[f.fileId];
          return (
            <li
              key={f.fileId}
              className="px-5 py-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3 min-w-0">
                <svg
                  className="w-5 h-5 text-gray-400 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {f.fileName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {f.documentType || "Unknown type"} &middot; {f.mimeType}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {hasUrl && (
                  <>
                    <button
                      onClick={() =>
                        setPreviewFileId(
                          previewFileId === f.fileId ? null : f.fileId
                        )
                      }
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      {previewFileId === f.fileId ? "Hide" : "Preview"}
                    </button>
                    <a
                      href={job.fileUrls![f.fileId]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      Open
                    </a>
                  </>
                )}
                <span className="text-xs text-gray-400">
                  {timeAgo(f.uploadedAt)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Inline preview */}
      {previewFile && previewUrl && (
        <div className="border-t border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700">
              {previewFile.fileName}
            </p>
            <button
              onClick={() => setPreviewFileId(null)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Close preview
            </button>
          </div>
          <FilePreview url={previewUrl} mimeType={previewFile.mimeType} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      <div className="h-4 bg-gray-200 rounded w-1/4" />
      <div className="h-12 bg-gray-200 rounded w-full" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-gray-200 rounded" />
        ))}
      </div>
      <div className="h-48 bg-gray-200 rounded" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

type ResultTab = "overview" | "documents" | "crossdoc" | "anomalies" | "tokens";

function ReviewPanel({
  jobId,
  onReviewed,
}: {
  jobId: string;
  onReviewed: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(
    null
  );
  const [reviewError, setReviewError] = useState<string | null>(null);

  async function handleReview(action: "approve" | "reject") {
    try {
      setSubmitting(action);
      setReviewError(null);
      await apiClient.post(`/admin/jobs/${jobId}/review`, { action, notes: notes || undefined });
      onReviewed();
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : "Failed to submit review"
      );
      setSubmitting(null);
    }
  }

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-3">
        <svg
          className="w-5 h-5 text-yellow-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
        <h3 className="text-sm font-semibold text-yellow-800">
          Review Required
        </h3>
      </div>
      <p className="text-sm text-yellow-700 mb-4">
        This job has anomalies or validation issues that require manual review.
        Please review the results and approve or reject.
      </p>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Review Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Add any notes about your review decision..."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
        />
      </div>

      {reviewError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3">
          {reviewError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => handleReview("approve")}
          disabled={submitting !== null}
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          {submitting === "approve" ? "Approving..." : "Approve"}
        </button>
        <button
          onClick={() => handleReview("reject")}
          disabled={submitting !== null}
          className="inline-flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          {submitting === "reject" ? "Rejecting..." : "Reject"}
        </button>
      </div>
    </div>
  );
}

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>("overview");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isProcessing =
    job != null && PROCESSING_STATUSES.includes(job.status);

  const fetchJob = useCallback(async () => {
    if (!id) return;
    try {
      if (!job) setLoading(true);
      setError(null);
      const data = await apiClient.get<JobDetailType>(`/admin/jobs/${id}`);
      setJob(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial fetch
  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Auto-refresh while processing
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (isProcessing) {
      intervalRef.current = setInterval(fetchJob, 5_000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isProcessing, fetchJob]);

  // ---- render --------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-6">
        <Link
          to="/jobs"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Jobs
        </Link>
        <DetailSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Link
          to="/jobs"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Jobs
        </Link>
        <div className="rounded-md bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={fetchJob}
            className="mt-3 text-sm font-medium text-red-600 hover:text-red-500 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!job) return null;

  const hasResult = !!job.result;

  const resultTabs: { key: ResultTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "documents", label: "Documents" },
    { key: "crossdoc", label: "Cross-Doc Validation" },
    { key: "anomalies", label: "Anomalies" },
    { key: "tokens", label: "Token Usage" },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        to="/jobs"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <svg
          className="w-4 h-4 mr-1"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Jobs
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 font-mono">
                {job.jobId}
              </h1>
              <StatusBadge status={job.status} size="md" />
              {isProcessing && (
                <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                  </span>
                  Refreshing
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
              <span>
                RuleSet:{" "}
                <Link
                  to={`/rulesets/${job.ruleSetId}`}
                  className="text-blue-600 hover:underline font-mono"
                >
                  {job.ruleSetId}
                </Link>{" "}
                <span className="text-gray-400">v{job.ruleSetVersion}</span>
              </span>
              {job.externalRef && (
                <span>
                  Ref:{" "}
                  <span className="text-gray-700 font-medium">
                    {job.externalRef}
                  </span>
                </span>
              )}
              {job.costUsd != null && (
                <span>
                  Cost:{" "}
                  <span className="text-gray-700 font-mono font-medium">
                    {formatCost(job.costUsd)}
                  </span>
                </span>
              )}
            </div>

            {/* Timestamps */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
              <span title={formatDate(job.timestamps.created)}>
                Created: {timeAgo(job.timestamps.created)}
              </span>
              <span title={formatDate(job.timestamps.updated)}>
                Updated: {timeAgo(job.timestamps.updated)}
              </span>
              {job.timestamps.completed && (
                <span title={formatDate(job.timestamps.completed)}>
                  Completed: {timeAgo(job.timestamps.completed)}
                </span>
              )}
            </div>
          </div>

          {/* Metadata */}
          {Object.keys(job.metadata).length > 0 && (
            <div className="bg-gray-50 rounded-md p-3 text-xs min-w-[200px]">
              <p className="font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Metadata
              </p>
              <dl className="space-y-0.5">
                {Object.entries(job.metadata).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-gray-500">{k}:</dt>
                    <dd className="text-gray-800 font-medium break-all">
                      {String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* Step indicator for processing jobs */}
        {(isProcessing ||
          job.status === "completed" ||
          job.status === "failed" ||
          job.status === "review_required") && (
          <div className="mt-6 pt-5 border-t border-gray-100 flex justify-center">
            <StepIndicator status={job.status} />
          </div>
        )}
      </div>

      {/* Review panel for review_required jobs */}
      {job.status === "review_required" && (
        <ReviewPanel jobId={job.jobId} onReviewed={fetchJob} />
      )}

      {/* Review metadata for reviewed jobs */}
      {(job.status === ("approved" as JobStatus) ||
        job.status === ("rejected" as JobStatus)) &&
        job.reviewedBy && (
          <div
            className={`rounded-lg border p-4 ${
              job.status === ("approved" as JobStatus)
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-gray-700">
                {job.status === ("approved" as JobStatus)
                  ? "Approved"
                  : "Rejected"}{" "}
                by
              </span>
              <span className="font-mono text-gray-900">{job.reviewedBy}</span>
              {job.reviewedAt && (
                <span className="text-gray-500">
                  on {formatDate(job.reviewedAt)}
                </span>
              )}
            </div>
            {job.reviewNotes && (
              <p className="mt-2 text-sm text-gray-600">{job.reviewNotes}</p>
            )}
          </div>
        )}

      {/* Result tabs */}
      {hasResult && (
        <div className="space-y-4">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-6" aria-label="Result tabs">
              {resultTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`whitespace-nowrap pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {tab.label}
                  {tab.key === "anomalies" &&
                    job.result!.anomalies.length > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-red-100 text-red-700">
                        {job.result!.anomalies.length}
                      </span>
                    )}
                </button>
              ))}
            </nav>
          </div>

          {activeTab === "overview" && <OverviewTab job={job} />}
          {activeTab === "documents" && <DocumentsTab job={job} />}
          {activeTab === "crossdoc" && (
            <CrossDocTab results={job.result!.crossDocResults} />
          )}
          {activeTab === "anomalies" && (
            <AnomaliesTab anomalies={job.result!.anomalies} />
          )}
          {activeTab === "tokens" && <TokenUsageTab job={job} />}
        </div>
      )}

      {/* Files section - always visible */}
      <FilesSection job={job} />
    </div>
  );
}
