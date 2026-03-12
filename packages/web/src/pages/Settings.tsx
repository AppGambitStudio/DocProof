import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppSettings {
  defaultModel: string;
  escalationModel: string;
  escalationThreshold: "LOW" | "MEDIUM";
  defaultTemperature: number;
  maxFileSizeMb: number;
  maxFilesPerJob: number;
  documentRetentionDays: number;
  resultRetentionDays: number;
  webhookRetryAttempts: number;
  webhookTimeoutMs: number;
  reviewAssignmentMode: "manual" | "round_robin";
  notificationEmail: string | null;
  slackWebhookUrl: string | null;
}

type Toast = { type: "success" | "error"; message: string } | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getChangedFields(
  original: AppSettings,
  current: AppSettings,
): Partial<AppSettings> {
  const changed: Partial<AppSettings> = {};
  for (const key of Object.keys(original) as (keyof AppSettings)[]) {
    if (!deepEqual(original[key], current[key])) {
      (changed as Record<string, unknown>)[key] = current[key];
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-40 mb-2" />
      <div className="h-3 bg-gray-100 rounded w-64 mb-5" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i}>
            <div className="h-3 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-9 bg-gray-100 rounded w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast component
// ---------------------------------------------------------------------------

function ToastBanner({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  if (!toast) return null;

  const isError = toast.type === "error";
  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm ${
        isError
          ? "bg-red-50 border border-red-200 text-red-800"
          : "bg-green-50 border border-green-200 text-green-800"
      }`}
    >
      <span>{toast.message}</span>
      <button
        onClick={onDismiss}
        className={`ml-2 font-medium hover:opacity-70 ${
          isError ? "text-red-600" : "text-green-600"
        }`}
      >
        Dismiss
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field components
// ---------------------------------------------------------------------------

function TextField({
  label,
  value,
  onChange,
  placeholder,
  helper,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  helper?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />
      {helper && <p className="text-xs text-gray-400 mt-1">{helper}</p>}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  helper,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  helper?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />
      {helper && <p className="text-xs text-gray-400 mt-1">{helper}</p>}
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  helper,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  helper?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {helper && <p className="text-xs text-gray-400 mt-1">{helper}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Settings() {
  const navigate = useNavigate();
  const [original, setOriginal] = useState<AppSettings | null>(null);
  const [form, setForm] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.get<AppSettings>("/admin/settings");
      setOriginal(data);
      setForm(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load settings",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const isDirty = original && form ? !deepEqual(original, form) : false;

  const update = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!original || !form || !isDirty) return;
    const changed = getChangedFields(original, form);
    if (Object.keys(changed).length === 0) return;

    try {
      setSaving(true);
      const updated = await apiClient.put<AppSettings>(
        "/admin/settings",
        changed,
      );
      setOriginal(updated);
      setForm(updated);
      setToast({ type: "success", message: "Settings saved successfully." });
    } catch (err) {
      setToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to save settings.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!window.confirm("Reset all settings to their defaults? This cannot be undone.")) {
      return;
    }
    // PUT with empty body triggers server-side default reset
    setSaving(true);
    apiClient
      .put<AppSettings>("/admin/settings", { resetToDefaults: true })
      .then((updated) => {
        setOriginal(updated);
        setForm(updated);
        setToast({
          type: "success",
          message: "Settings reset to defaults.",
        });
      })
      .catch((err) => {
        setToast({
          type: "error",
          message:
            err instanceof Error
              ? err.message
              : "Failed to reset settings.",
        });
      })
      .finally(() => setSaving(false));
  };

  const handleDiscard = () => {
    if (original) setForm(original);
  };

  // ---------- Loading state ----------
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-7 bg-gray-200 rounded w-32 mb-2 animate-pulse" />
            <div className="h-4 bg-gray-100 rounded w-72 animate-pulse" />
          </div>
        </div>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  // ---------- Error state ----------
  if (error && !form) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-600 font-medium">Failed to load settings</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
          <button
            onClick={fetchSettings}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="space-y-6">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      {/* ---------- Header ---------- */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure system-wide settings for DocProof
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
              Unsaved changes
            </span>
          )}
          {isDirty && (
            <button
              onClick={handleDiscard}
              disabled={saving}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-50"
            >
              Discard
            </button>
          )}
          <button
            onClick={handleReset}
            disabled={saving}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Reset to defaults
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      {/* ---------- Quick Links ---------- */}
      <div
        onClick={() => navigate("/settings/api-keys")}
        className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">API Keys</p>
            <p className="text-xs text-gray-500">Create, manage, and revoke API keys for job authentication</p>
          </div>
        </div>
        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* ---------- Models ---------- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Models</h3>
        <p className="text-sm text-gray-500 mb-4">
          Configure the AI models used for document extraction and validation.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField
            label="Default Model"
            value={form.defaultModel}
            onChange={(v) => update("defaultModel", v)}
            helper="Model ID used for initial extraction (e.g. Haiku)"
          />
          <TextField
            label="Escalation Model"
            value={form.escalationModel}
            onChange={(v) => update("escalationModel", v)}
            helper="Model ID used when confidence is below threshold (e.g. Sonnet)"
          />
          <SelectField
            label="Escalation Threshold"
            value={form.escalationThreshold}
            onChange={(v) => update("escalationThreshold", v)}
            options={[
              { value: "LOW", label: "Low" },
              { value: "MEDIUM", label: "Medium" },
            ]}
            helper="Confidence level that triggers model escalation"
          />
          <NumberField
            label="Default Temperature"
            value={form.defaultTemperature}
            onChange={(v) => update("defaultTemperature", v)}
            min={0}
            max={1}
            step={0.1}
            helper="Controls randomness in model responses (0 = deterministic, 1 = creative)"
          />
        </div>
      </div>

      {/* ---------- Limits ---------- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Limits</h3>
        <p className="text-sm text-gray-500 mb-4">
          Set upload and processing limits for jobs.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberField
            label="Max File Size (MB)"
            value={form.maxFileSizeMb}
            onChange={(v) => update("maxFileSizeMb", v)}
            min={1}
            max={100}
            step={1}
            helper="Maximum allowed size per uploaded file"
          />
          <NumberField
            label="Max Files Per Job"
            value={form.maxFilesPerJob}
            onChange={(v) => update("maxFilesPerJob", v)}
            min={1}
            max={50}
            step={1}
            helper="Maximum number of files allowed in a single job"
          />
        </div>
      </div>

      {/* ---------- Retention ---------- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Retention
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Control how long documents and results are retained before automatic
          cleanup.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberField
            label="Document Retention (days)"
            value={form.documentRetentionDays}
            onChange={(v) => update("documentRetentionDays", v)}
            min={1}
            max={3650}
            step={1}
            helper="Uploaded documents are deleted after this period"
          />
          <NumberField
            label="Result Retention (days)"
            value={form.resultRetentionDays}
            onChange={(v) => update("resultRetentionDays", v)}
            min={1}
            max={3650}
            step={1}
            helper="Extraction and validation results are deleted after this period"
          />
        </div>
      </div>

      {/* ---------- Webhooks ---------- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Webhooks
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Configure webhook delivery settings for job status callbacks.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberField
            label="Retry Attempts"
            value={form.webhookRetryAttempts}
            onChange={(v) => update("webhookRetryAttempts", v)}
            min={0}
            max={10}
            step={1}
            helper="Number of times to retry a failed webhook delivery"
          />
          <NumberField
            label="Timeout (in ms)"
            value={form.webhookTimeoutMs}
            onChange={(v) => update("webhookTimeoutMs", v)}
            min={1000}
            max={30000}
            step={1000}
            helper="Maximum time to wait for a webhook response"
          />
        </div>
      </div>

      {/* ---------- Review ---------- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Review</h3>
        <p className="text-sm text-gray-500 mb-4">
          Configure how anomaly reviews are assigned to team members.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectField
            label="Assignment Mode"
            value={form.reviewAssignmentMode}
            onChange={(v) => update("reviewAssignmentMode", v)}
            options={[
              { value: "manual", label: "Manual" },
              { value: "round_robin", label: "Round Robin" },
            ]}
            helper="How review tasks are assigned when anomalies are detected"
          />
        </div>
      </div>

      {/* ---------- Notifications ---------- */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Notifications
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Set up email and Slack notifications for job events.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField
            label="Notification Email"
            value={form.notificationEmail ?? ""}
            onChange={(v) =>
              update("notificationEmail", v.trim() === "" ? null : v.trim())
            }
            placeholder="Not configured"
            helper="Email address for job completion and failure notifications"
            type="email"
          />
          <TextField
            label="Slack Webhook URL"
            value={form.slackWebhookUrl ?? ""}
            onChange={(v) =>
              update("slackWebhookUrl", v.trim() === "" ? null : v.trim())
            }
            placeholder="Not configured"
            helper="Slack incoming webhook URL for notifications"
          />
        </div>
      </div>
    </div>
  );
}
