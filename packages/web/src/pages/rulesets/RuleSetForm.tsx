import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../lib/api";
import { DocumentTypeConfig, FieldDefinition, RuleSet } from "../../lib/types";

interface FormData {
  id: string;
  name: string;
  description: string;
  version: number;
  status: "draft" | "active" | "archived";
  documentTypes: DocumentTypeConfig[];
}

const emptyDocType: DocumentTypeConfig = {
  typeId: "",
  label: "",
  required: false,
  maxCount: 1,
  acceptedFormats: ["pdf", "jpg", "png"],
  extractionPrompt: "",
  expectedFields: [],
};

const emptyField: FieldDefinition = {
  name: "",
  label: "",
  type: "string",
};

export function RuleSetForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<FormData>({
    id: "",
    name: "",
    description: "",
    version: 1,
    status: "draft",
    documentTypes: [],
  });

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEdit && id) {
      loadRuleSet(id);
    }
  }, [id, isEdit]);

  async function loadRuleSet(ruleSetId: string) {
    try {
      setLoading(true);
      const data = await apiClient.get<RuleSet>(`/admin/rule-sets/${ruleSetId}`);
      setForm({
        id: data.id,
        name: data.name,
        description: data.description || "",
        version: data.version,
        status: data.status,
        documentTypes: data.documentTypes || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rule set");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!isEdit && !form.id.trim()) {
      setError("ID is required");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const body = {
        id: form.id,
        name: form.name,
        description: form.description || undefined,
        version: form.version,
        status: form.status,
        documentTypes: form.documentTypes,
        fieldRules: [],
        crossDocRules: [],
        metadataRules: [],
      };

      if (isEdit) {
        await apiClient.put(`/admin/rule-sets/${id}`, body);
        navigate(`/rulesets/${id}`);
      } else {
        await apiClient.post("/admin/rule-sets", body);
        navigate(`/rulesets/${form.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rule set");
      setSaving(false);
    }
  }

  function updateField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addDocType() {
    setForm((prev) => ({
      ...prev,
      documentTypes: [...prev.documentTypes, { ...emptyDocType }],
    }));
  }

  function removeDocType(index: number) {
    setForm((prev) => ({
      ...prev,
      documentTypes: prev.documentTypes.filter((_, i) => i !== index),
    }));
  }

  function updateDocType(index: number, updates: Partial<DocumentTypeConfig>) {
    setForm((prev) => ({
      ...prev,
      documentTypes: prev.documentTypes.map((dt, i) =>
        i === index ? { ...dt, ...updates } : dt
      ),
    }));
  }

  function addFieldToDocType(dtIndex: number) {
    const dt = form.documentTypes[dtIndex];
    updateDocType(dtIndex, {
      expectedFields: [...(dt.expectedFields || []), { ...emptyField }],
    });
  }

  function removeFieldFromDocType(dtIndex: number, fieldIndex: number) {
    const dt = form.documentTypes[dtIndex];
    updateDocType(dtIndex, {
      expectedFields: dt.expectedFields.filter((_, i) => i !== fieldIndex),
    });
  }

  function updateFieldInDocType(
    dtIndex: number,
    fieldIndex: number,
    updates: Partial<FieldDefinition>
  ) {
    const dt = form.documentTypes[dtIndex];
    updateDocType(dtIndex, {
      expectedFields: dt.expectedFields.map((f, i) =>
        i === fieldIndex ? { ...f, ...updates } : f
      ),
    });
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-6 w-48 bg-gray-200 rounded mb-8" />
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      {/* Back button */}
      <button
        onClick={() => navigate(isEdit ? `/rulesets/${id}` : "/rulesets")}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {isEdit ? "Back to RuleSet" : "Back to RuleSets"}
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {isEdit ? "Edit RuleSet" : "New RuleSet"}
      </h1>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Basic Fields */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Basic Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ID</label>
              <input
                type="text"
                value={form.id}
                onChange={(e) => updateField("id", e.target.value)}
                disabled={isEdit}
                placeholder="e.g., mortgage-verification-v1"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g., Mortgage Verification"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={2}
                placeholder="Describe what this rule set is for..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
              <input
                type="number"
                value={form.version}
                onChange={(e) => updateField("version", parseInt(e.target.value) || 1)}
                min={1}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) =>
                  updateField("status", e.target.value as FormData["status"])
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
        </div>

        {/* Document Types */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              Document Types
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({form.documentTypes.length})
              </span>
            </h2>
            <button
              type="button"
              onClick={addDocType}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Add Document Type
            </button>
          </div>

          {form.documentTypes.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">
              No document types added yet. Click "Add Document Type" to get started.
            </p>
          )}

          <div className="space-y-4">
            {form.documentTypes.map((dt, dtIndex) => (
              <div
                key={dtIndex}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700">
                    Document Type #{dtIndex + 1}
                  </h3>
                  <button
                    type="button"
                    onClick={() => removeDocType(dtIndex)}
                    className="text-red-500 hover:text-red-700 transition-colors"
                    title="Remove document type"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Type ID
                    </label>
                    <input
                      type="text"
                      value={dt.typeId}
                      onChange={(e) => updateDocType(dtIndex, { typeId: e.target.value })}
                      placeholder="e.g., w2_form"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
                    <input
                      type="text"
                      value={dt.label}
                      onChange={(e) => updateDocType(dtIndex, { label: e.target.value })}
                      placeholder="e.g., W-2 Form"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Max Count
                    </label>
                    <input
                      type="number"
                      value={dt.maxCount}
                      onChange={(e) =>
                        updateDocType(dtIndex, { maxCount: parseInt(e.target.value) || 1 })
                      }
                      min={1}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dt.required}
                        onChange={(e) => updateDocType(dtIndex, { required: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">Required</span>
                    </label>
                  </div>
                </div>

                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Accepted Formats (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={dt.acceptedFormats?.join(", ") || ""}
                    onChange={(e) =>
                      updateDocType(dtIndex, {
                        acceptedFormats: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="pdf, jpg, png"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Extraction Prompt
                  </label>
                  <textarea
                    value={dt.extractionPrompt}
                    onChange={(e) =>
                      updateDocType(dtIndex, { extractionPrompt: e.target.value })
                    }
                    rows={2}
                    placeholder="Instructions for AI to extract fields from this document type..."
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                  />
                </div>

                {/* Expected Fields */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-gray-600">Expected Fields</label>
                    <button
                      type="button"
                      onClick={() => addFieldToDocType(dtIndex)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      + Add Field
                    </button>
                  </div>

                  {dt.expectedFields.length === 0 && (
                    <p className="text-xs text-gray-400 py-2">No fields added</p>
                  )}

                  {dt.expectedFields.map((field, fIndex) => (
                    <div
                      key={fIndex}
                      className="flex items-center gap-2 mb-2"
                    >
                      <input
                        type="text"
                        value={field.name}
                        onChange={(e) =>
                          updateFieldInDocType(dtIndex, fIndex, { name: e.target.value })
                        }
                        placeholder="name"
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) =>
                          updateFieldInDocType(dtIndex, fIndex, { label: e.target.value })
                        }
                        placeholder="Label"
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                      <select
                        value={field.type}
                        onChange={(e) =>
                          updateFieldInDocType(dtIndex, fIndex, {
                            type: e.target.value as FieldDefinition["type"],
                          })
                        }
                        className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                      >
                        <option value="string">string</option>
                        <option value="number">number</option>
                        <option value="date">date</option>
                        <option value="boolean">boolean</option>
                        <option value="enum">enum</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeFieldFromDocType(dtIndex, fIndex)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                      >
                        <svg
                          className="w-3.5 h-3.5"
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
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(isEdit ? `/rulesets/${id}` : "/rulesets")}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create RuleSet"}
          </button>
        </div>
      </form>
    </div>
  );
}
