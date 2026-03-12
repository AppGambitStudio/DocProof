import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiKeyInfo {
  keyId: string;
  name: string;
  keyPrefix: string;
  status: "active" | "revoked";
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  scopes: string[];
}

interface CreateKeyResponse extends ApiKeyInfo {
  key: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Modal wrapper
// ---------------------------------------------------------------------------

function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-lg border border-gray-200 shadow-xl w-full max-w-md mx-4 p-6">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? "Copied!" : label || "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showCreate, setShowCreate] = useState(false);
  const [revealedKey, setRevealedKey] = useState<CreateKeyResponse | null>(
    null
  );
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  // Create form
  const [createName, setCreateName] = useState("");
  const [createExpiry, setCreateExpiry] = useState("");
  const [createScopes, setCreateScopes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Revoke
  const [revoking, setRevoking] = useState(false);

  // ---------- Data fetching ----------

  const fetchKeys = useCallback(async (initial = false) => {
    try {
      if (initial) setLoading(true);
      const data = await apiClient.get<{ keys: ApiKeyInfo[] }>(
        "/admin/api-keys"
      );
      const sorted = [...data.keys].sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
      setKeys(sorted);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load API keys"
      );
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys(true);
  }, [fetchKeys]);

  // ---------- Create key ----------

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);

    try {
      const body: Record<string, unknown> = { name: createName.trim() };
      if (createExpiry) body.expiresAt = createExpiry;
      if (createScopes.trim()) {
        body.scopes = createScopes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const result = await apiClient.post<CreateKeyResponse>(
        "/admin/api-keys",
        body
      );

      setShowCreate(false);
      setCreateName("");
      setCreateExpiry("");
      setCreateScopes("");
      setRevealedKey(result);
      await fetchKeys(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create key"
      );
    } finally {
      setCreating(false);
    }
  };

  // ---------- Revoke key ----------

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await apiClient.del(`/admin/api-keys/${revokeTarget.keyId}`);
      setRevokeTarget(null);
      await fetchKeys(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to revoke key"
      );
      setRevokeTarget(null);
    } finally {
      setRevoking(false);
    }
  };

  // ---------- Loading state ----------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading API keys...</p>
        </div>
      </div>
    );
  }

  // ---------- Error state ----------

  if (error && keys.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-600 font-medium">Failed to load API keys</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
          <button
            onClick={() => fetchKeys(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage API keys for programmatic access to DocProof jobs.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          Create Key
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Keys table */}
      <div className="bg-white rounded-lg border border-gray-200">
        {keys.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No API keys yet.</p>
            <p className="text-gray-300 text-xs mt-1">
              Create a key to start making API requests.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Key
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Key Prefix</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created By</th>
                  <th className="py-3 px-4">Last Used</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {keys.map((k) => (
                  <tr
                    key={k.keyId}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 px-4 text-gray-900 font-medium">
                      {k.name}
                      {k.expiresAt && (
                        <span className="block text-xs text-gray-400 mt-0.5">
                          Expires {formatDate(k.expiresAt)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-2">
                        <code className="font-mono text-xs text-gray-600">
                          {k.keyPrefix}...
                        </code>
                        <CopyButton text={k.keyPrefix} />
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          k.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {k.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-500 text-xs">
                      {k.createdBy}
                      <span className="block text-gray-400 mt-0.5">
                        {formatDate(k.createdAt)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-500 text-xs">
                      {k.lastUsedAt ? timeAgo(k.lastUsedAt) : "Never"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {k.status === "active" && (
                        <button
                          onClick={() => setRevokeTarget(k)}
                          className="px-3 py-1 text-xs font-medium border border-red-300 text-red-700 rounded-md hover:bg-red-50 transition-colors"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- Create Key Modal ---------- */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)}>
        <h2 className="text-lg font-semibold text-gray-900">
          Create API Key
        </h2>
        <form onSubmit={handleCreate} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Production Backend"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expiry Date{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={createExpiry}
              onChange={(e) => setCreateExpiry(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Scopes{" "}
              <span className="text-gray-400 font-normal">
                (optional, comma-separated)
              </span>
            </label>
            <input
              type="text"
              value={createScopes}
              onChange={(e) => setCreateScopes(e.target.value)}
              placeholder="e.g. jobs:create, jobs:read"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {createError && (
            <p className="text-sm text-red-600">{createError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !createName.trim()}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? "Creating..." : "Create Key"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ---------- Key Reveal Modal ---------- */}
      <Modal open={!!revealedKey} onClose={() => {}}>
        {revealedKey && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              API Key Created
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Your new API key for{" "}
              <span className="font-medium">{revealedKey.name}</span> has been
              created.
            </p>

            <div className="mt-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  API Key
                </label>
                <CopyButton text={revealedKey.key} label="Copy Key" />
              </div>
              <div className="font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm break-all select-all">
                {revealedKey.key}
              </div>
            </div>

            <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
              <p className="text-sm font-medium text-yellow-800">
                Save this key now — it will not be shown again.
              </p>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={() => setRevealedKey(null)}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                I've saved my key
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- Revoke Confirmation Modal ---------- */}
      <Modal open={!!revokeTarget} onClose={() => setRevokeTarget(null)}>
        {revokeTarget && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Revoke API Key
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to revoke{" "}
              <span className="font-medium">{revokeTarget.name}</span>? This
              cannot be undone.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Key prefix: {revokeTarget.keyPrefix}...
            </p>

            <div className="flex justify-end gap-3 pt-6">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="px-4 py-2 text-sm font-medium border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {revoking ? "Revoking..." : "Revoke Key"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
