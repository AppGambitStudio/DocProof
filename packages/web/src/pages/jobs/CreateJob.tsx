import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/api";
import type { RuleSet, DocumentTypeConfig } from "../../lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  id: string;
  documentType: string; // "auto" or a specific typeId
  file: File;
}

interface MetadataEntry {
  key: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateJob() {
  const navigate = useNavigate();

  // Form state
  const [ruleSetId, setRuleSetId] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [metadata, setMetadata] = useState<MetadataEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);

  // Loaded data
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [loadingRuleSets, setLoadingRuleSets] = useState(true);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Drag state
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- load rulesets --------------------------------------------------------

  useEffect(() => {
    apiClient
      .get<{ ruleSets: RuleSet[] }>("/admin/rule-sets")
      .then((data) => {
        const active = data.ruleSets.filter((r) => r.status === "active");
        setRuleSets(active);
        if (active.length === 1) setRuleSetId(active[0].id);
      })
      .catch(() => setError("Failed to load rulesets"))
      .finally(() => setLoadingRuleSets(false));
  }, []);

  const selectedRuleSet = ruleSets.find((r) => r.id === ruleSetId);
  const docTypes: DocumentTypeConfig[] = selectedRuleSet?.documentTypes ?? [];

  // ---- file handling --------------------------------------------------------

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const entries: FileEntry[] = Array.from(newFiles).map((f) => ({
      id: crypto.randomUUID(),
      documentType: "auto",
      file: f,
    }));
    setFiles((prev) => [...prev, ...entries]);
  }, []);

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function updateFileType(id: string, docType: string) {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, documentType: docType } : f))
    );
  }

  // ---- drag & drop ----------------------------------------------------------

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  // ---- metadata handling ----------------------------------------------------

  function addMetadata() {
    setMetadata((prev) => [...prev, { key: "", value: "" }]);
  }

  function updateMetadata(index: number, field: "key" | "value", val: string) {
    setMetadata((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  }

  function removeMetadata(index: number) {
    setMetadata((prev) => prev.filter((_, i) => i !== index));
  }

  // ---- submit ---------------------------------------------------------------

  async function handleSubmit() {
    if (!ruleSetId) {
      setError("Please select a ruleset");
      return;
    }
    if (files.length === 0) {
      setError("Please upload at least one document");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // 1. Create job
      setProgress("Creating job...");
      const metadataObj: Record<string, unknown> = {};
      for (const m of metadata) {
        if (m.key.trim()) metadataObj[m.key.trim()] = m.value;
      }

      const createRes = await apiClient.post<{ jobId: string }>("/admin/jobs", {
        ruleSetId,
        ...(externalRef && { externalRef }),
        ...(Object.keys(metadataObj).length > 0 && { metadata: metadataObj }),
      });

      const { jobId } = createRes;

      // 2. Upload each file
      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        setProgress(`Uploading file ${i + 1}/${files.length}: ${entry.file.name}...`);

        // Get presigned URL — documentType is optional, "auto" lets the engine classify
        const uploadBody: Record<string, unknown> = {
          fileName: entry.file.name,
          mimeType: entry.file.type || "application/octet-stream",
          size: entry.file.size,
        };
        if (entry.documentType !== "auto") {
          uploadBody.documentType = entry.documentType;
        }

        const uploadRes = await apiClient.post<{ fileId: string; uploadUrl: string }>(
          `/admin/jobs/${jobId}/upload`,
          uploadBody
        );

        // Upload file to S3 via presigned URL
        const putRes = await fetch(uploadRes.uploadUrl, {
          method: "PUT",
          body: entry.file,
          headers: {
            "Content-Type": entry.file.type || "application/octet-stream",
          },
        });

        if (!putRes.ok) {
          throw new Error(`Failed to upload ${entry.file.name} (${putRes.status})`);
        }
      }

      // 3. Start processing
      setProgress("Starting processing pipeline...");
      await apiClient.post(`/admin/jobs/${jobId}/process`, {});

      // Navigate to job detail
      navigate(`/jobs/${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
      setSubmitting(false);
      setProgress("");
    }
  }

  // ---- helpers --------------------------------------------------------------

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ---- render ---------------------------------------------------------------

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Create Job</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload documents for verification — the engine will identify document types automatically
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-white shadow rounded-lg divide-y divide-gray-200">
        {/* RuleSet Selection */}
        <div className="p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            RuleSet <span className="text-red-500">*</span>
          </label>
          {loadingRuleSets ? (
            <div className="h-10 bg-gray-100 rounded animate-pulse" />
          ) : ruleSets.length === 0 ? (
            <p className="text-sm text-gray-500">
              No active rulesets found.{" "}
              <button
                onClick={() => navigate("/rulesets/new")}
                className="text-blue-600 hover:text-blue-500 underline"
              >
                Create one first
              </button>
            </p>
          ) : (
            <select
              value={ruleSetId}
              onChange={(e) => setRuleSetId(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
            >
              <option value="">Select a ruleset...</option>
              {ruleSets.map((rs) => (
                <option key={rs.id} value={rs.id}>
                  {rs.name} (v{rs.version})
                </option>
              ))}
            </select>
          )}
          {selectedRuleSet && (
            <p className="mt-1 text-xs text-gray-400">{selectedRuleSet.description}</p>
          )}
          {selectedRuleSet && docTypes.length > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              Expected documents: {docTypes.map((dt) => dt.label || dt.typeId).join(", ")}
            </p>
          )}
        </div>

        {/* External Reference */}
        <div className="p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            External Reference
          </label>
          <input
            type="text"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="e.g. application ID, customer ID..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            Optional identifier to link this job to your system
          </p>
        </div>

        {/* Metadata */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Metadata</label>
            <button
              type="button"
              onClick={addMetadata}
              className="text-sm text-blue-600 hover:text-blue-500"
            >
              + Add field
            </button>
          </div>
          {metadata.length === 0 && (
            <p className="text-xs text-gray-400">
              Optional key-value pairs passed to the validation engine (e.g. applicantName)
            </p>
          )}
          <div className="space-y-2">
            {metadata.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={m.key}
                  onChange={(e) => updateMetadata(i, "key", e.target.value)}
                  placeholder="Key"
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                />
                <input
                  type="text"
                  value={m.value}
                  onChange={(e) => updateMetadata(i, "value", e.target.value)}
                  placeholder="Value"
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                />
                <button
                  onClick={() => removeMetadata(i)}
                  className="text-gray-400 hover:text-red-500"
                  title="Remove"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Document Upload — drop zone */}
        <div className="p-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Documents <span className="text-red-500">*</span>
          </label>

          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragging
                ? "border-blue-400 bg-blue-50"
                : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
            }`}
          >
            <svg
              className="mx-auto h-10 w-10 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="mt-2 text-sm text-gray-600">
              <span className="font-medium text-blue-600">Click to browse</span> or drag &amp; drop files
            </p>
            <p className="mt-1 text-xs text-gray-400">
              PDF, JPG, PNG, TIFF — the engine will automatically identify each document type
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* File list */}
          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-2.5"
                >
                  {/* File icon */}
                  <svg
                    className="h-5 w-5 text-gray-400 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                    />
                  </svg>

                  {/* File name + size */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{f.file.name}</p>
                    <p className="text-xs text-gray-400">{formatSize(f.file.size)}</p>
                  </div>

                  {/* Optional type selector */}
                  {docTypes.length > 0 && (
                    <select
                      value={f.documentType}
                      onChange={(e) => updateFileType(f.id, e.target.value)}
                      className="text-xs rounded border-gray-300 text-gray-600 py-1 pr-6"
                      title="Optionally specify document type"
                    >
                      <option value="auto">Auto-detect</option>
                      {docTypes.map((dt) => (
                        <option key={dt.typeId} value={dt.typeId}>
                          {dt.label || dt.typeId}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Remove */}
                  <button
                    onClick={() => removeFile(f.id)}
                    className="text-gray-400 hover:text-red-500 flex-shrink-0"
                    title="Remove file"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}

              <p className="text-xs text-gray-400 mt-1">
                {files.length} file{files.length !== 1 ? "s" : ""} selected
                {files.every((f) => f.documentType === "auto") && docTypes.length > 0 && (
                  <> &mdash; types will be identified automatically, or select manually per file</>
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate("/jobs")}
          className="text-sm text-gray-600 hover:text-gray-800"
        >
          Cancel
        </button>
        <div className="flex items-center gap-3">
          {progress && (
            <span className="text-sm text-blue-600 flex items-center gap-2">
              <svg
                className="animate-spin h-4 w-4 text-blue-500"
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
              {progress}
            </span>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting || !ruleSetId || files.length === 0}
            className="inline-flex items-center px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Processing..." : "Create & Process"}
          </button>
        </div>
      </div>
    </div>
  );
}
