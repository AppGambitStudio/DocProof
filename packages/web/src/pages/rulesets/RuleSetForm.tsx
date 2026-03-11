import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../lib/api";
import {
  CrossDocRule,
  DocumentTypeConfig,
  FieldDefinition,
  FieldRule,
  Validation,
  MetadataRule,
  PromptConfig,
  RuleSet,
} from "../../lib/types";

interface FormData {
  id: string;
  name: string;
  description: string;
  version: number;
  status: "draft" | "active" | "archived";
  documentTypes: DocumentTypeConfig[];
  fieldRules: FieldRule[];
  crossDocRules: CrossDocRule[];
  metadataRules: MetadataRule[];
  promptConfig: PromptConfig;
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

const emptyValidation: Validation = {
  type: "required",
};

const emptyFieldRule: FieldRule = {
  id: "",
  documentType: "",
  field: "",
  validations: [],
};

const emptyCrossDocRule: CrossDocRule = {
  id: "",
  description: "",
  sourceDoc: "",
  sourceField: "",
  targetDoc: "",
  targetField: "",
  matchType: "exact",
};

const emptyMetadataRule: MetadataRule = {
  id: "",
  field: "",
  validations: [],
};

// Must match core validator registry type names
const validationTypes = [
  "required",
  "regex",
  "length",
  "enum",
  "numeric_range",
  "checksum",
  "date_format",
  "date_range",
  "custom_llm",
];

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
    fieldRules: [],
    crossDocRules: [],
    metadataRules: [],
    promptConfig: {},
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
        fieldRules: data.fieldRules || [],
        crossDocRules: data.crossDocRules || [],
        metadataRules: data.metadataRules || [],
        promptConfig: data.promptConfig || {},
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
        fieldRules: form.fieldRules,
        crossDocRules: form.crossDocRules,
        metadataRules: form.metadataRules,
        promptConfig:
          form.promptConfig.role || form.promptConfig.organizationContext || form.promptConfig.customInstructions || form.promptConfig.customSystemPrompt || form.promptConfig.temperature !== undefined || (form.promptConfig.contextFields && form.promptConfig.contextFields.length > 0)
            ? form.promptConfig
            : undefined,
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

  // --- Field Rules helpers ---
  function addFieldRule() {
    setForm((prev) => ({
      ...prev,
      fieldRules: [...prev.fieldRules, { ...emptyFieldRule, validations: [] }],
    }));
  }

  function removeFieldRule(index: number) {
    setForm((prev) => ({
      ...prev,
      fieldRules: prev.fieldRules.filter((_, i) => i !== index),
    }));
  }

  function updateFieldRule(index: number, updates: Partial<FieldRule>) {
    setForm((prev) => ({
      ...prev,
      fieldRules: prev.fieldRules.map((r, i) =>
        i === index ? { ...r, ...updates } : r
      ),
    }));
  }

  function addValidationToFieldRule(ruleIndex: number) {
    const rule = form.fieldRules[ruleIndex];
    updateFieldRule(ruleIndex, {
      validations: [...rule.validations, { ...emptyValidation }],
    });
  }

  function removeValidationFromFieldRule(ruleIndex: number, valIndex: number) {
    const rule = form.fieldRules[ruleIndex];
    updateFieldRule(ruleIndex, {
      validations: rule.validations.filter((_, i) => i !== valIndex),
    });
  }

  function updateValidationInFieldRule(
    ruleIndex: number,
    valIndex: number,
    updates: Partial<Validation>
  ) {
    const rule = form.fieldRules[ruleIndex];
    updateFieldRule(ruleIndex, {
      validations: rule.validations.map((v, i) =>
        i === valIndex ? { ...v, ...updates } : v
      ),
    });
  }

  // --- Cross-Doc Rules helpers ---
  function addCrossDocRule() {
    setForm((prev) => ({
      ...prev,
      crossDocRules: [...prev.crossDocRules, { ...emptyCrossDocRule }],
    }));
  }

  function removeCrossDocRule(index: number) {
    setForm((prev) => ({
      ...prev,
      crossDocRules: prev.crossDocRules.filter((_, i) => i !== index),
    }));
  }

  function updateCrossDocRule(index: number, updates: Partial<CrossDocRule>) {
    setForm((prev) => ({
      ...prev,
      crossDocRules: prev.crossDocRules.map((r, i) =>
        i === index ? { ...r, ...updates } : r
      ),
    }));
  }

  // --- Metadata Rules helpers ---
  function addMetadataRule() {
    setForm((prev) => ({
      ...prev,
      metadataRules: [...prev.metadataRules, { ...emptyMetadataRule, validations: [] }],
    }));
  }

  function removeMetadataRule(index: number) {
    setForm((prev) => ({
      ...prev,
      metadataRules: prev.metadataRules.filter((_, i) => i !== index),
    }));
  }

  function updateMetadataRule(index: number, updates: Partial<MetadataRule>) {
    setForm((prev) => ({
      ...prev,
      metadataRules: prev.metadataRules.map((r, i) =>
        i === index ? { ...r, ...updates } : r
      ),
    }));
  }

  function addValidationToMetadataRule(ruleIndex: number) {
    const rule = form.metadataRules[ruleIndex];
    updateMetadataRule(ruleIndex, {
      validations: [...rule.validations, { ...emptyValidation }],
    });
  }

  function removeValidationFromMetadataRule(ruleIndex: number, valIndex: number) {
    const rule = form.metadataRules[ruleIndex];
    updateMetadataRule(ruleIndex, {
      validations: rule.validations.filter((_, i) => i !== valIndex),
    });
  }

  function updateValidationInMetadataRule(
    ruleIndex: number,
    valIndex: number,
    updates: Partial<Validation>
  ) {
    const rule = form.metadataRules[ruleIndex];
    updateMetadataRule(ruleIndex, {
      validations: rule.validations.map((v, i) =>
        i === valIndex ? { ...v, ...updates } : v
      ),
    });
  }

  // --- Prompt Config helper ---
  function updatePromptConfig(updates: Partial<PromptConfig>) {
    setForm((prev) => ({
      ...prev,
      promptConfig: { ...prev.promptConfig, ...updates },
    }));
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

        {/* Field Rules */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              Field Rules
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({form.fieldRules.length})
              </span>
            </h2>
            <button
              type="button"
              onClick={addFieldRule}
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
              Add Field Rule
            </button>
          </div>

          {form.fieldRules.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">
              No field rules added yet. Click "Add Field Rule" to get started.
            </p>
          )}

          <div className="space-y-4">
            {form.fieldRules.map((rule, rIndex) => (
              <div
                key={rIndex}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700">
                    Field Rule #{rIndex + 1}
                  </h3>
                  <button
                    type="button"
                    onClick={() => removeFieldRule(rIndex)}
                    className="text-red-500 hover:text-red-700 transition-colors"
                    title="Remove field rule"
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

                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Rule ID
                    </label>
                    <input
                      type="text"
                      value={rule.id}
                      onChange={(e) =>
                        updateFieldRule(rIndex, { id: e.target.value })
                      }
                      placeholder="e.g., fr_pan_format"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Document Type
                    </label>
                    <input
                      type="text"
                      value={rule.documentType}
                      onChange={(e) =>
                        updateFieldRule(rIndex, { documentType: e.target.value })
                      }
                      placeholder="e.g., pan_card"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Field
                    </label>
                    <input
                      type="text"
                      value={rule.field}
                      onChange={(e) =>
                        updateFieldRule(rIndex, { field: e.target.value })
                      }
                      placeholder="e.g., pan_number"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                </div>

                {/* Validations */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-gray-600">Validations</label>
                    <button
                      type="button"
                      onClick={() => addValidationToFieldRule(rIndex)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      + Add Validation
                    </button>
                  </div>

                  {rule.validations.length === 0 && (
                    <p className="text-xs text-gray-400 py-2">No validations added</p>
                  )}

                  {rule.validations.map((val, vIndex) => (
                    <div
                      key={vIndex}
                      className="flex items-center gap-2 mb-2 flex-wrap"
                    >
                      <select
                        value={val.type}
                        onChange={(e) =>
                          updateValidationInFieldRule(rIndex, vIndex, {
                            type: e.target.value,
                          })
                        }
                        className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                      >
                        {validationTypes.map((vt) => (
                          <option key={vt} value={vt}>
                            {vt}
                          </option>
                        ))}
                      </select>
                      {val.type === "regex" && (
                        <input
                          type="text"
                          value={val.pattern || ""}
                          onChange={(e) =>
                            updateValidationInFieldRule(rIndex, vIndex, { pattern: e.target.value })
                          }
                          placeholder="Pattern (regex)"
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      )}
                      {(val.type === "length" || val.type === "numeric_range" || val.type === "date_range") && (
                        <>
                          <input
                            type="text"
                            value={val.min !== undefined && val.min !== null ? String(val.min) : ""}
                            onChange={(e) =>
                              updateValidationInFieldRule(rIndex, vIndex, { min: e.target.value ? Number(e.target.value) || e.target.value : undefined })
                            }
                            placeholder="Min"
                            className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                          <input
                            type="text"
                            value={val.max !== undefined && val.max !== null ? String(val.max) : ""}
                            onChange={(e) =>
                              updateValidationInFieldRule(rIndex, vIndex, { max: e.target.value ? Number(e.target.value) || e.target.value : undefined })
                            }
                            placeholder="Max"
                            className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                        </>
                      )}
                      {val.type === "enum" && (
                        <input
                          type="text"
                          value={(val.values ?? []).join(", ")}
                          onChange={(e) =>
                            updateValidationInFieldRule(rIndex, vIndex, { values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                          }
                          placeholder="Values (comma-separated)"
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      )}
                      {val.type === "checksum" && (
                        <select
                          value={val.algorithm || ""}
                          onChange={(e) =>
                            updateValidationInFieldRule(rIndex, vIndex, { algorithm: e.target.value })
                          }
                          className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                        >
                          <option value="">Select algorithm</option>
                          <option value="pan">PAN</option>
                          <option value="gstin">GSTIN</option>
                          <option value="aadhaar">Aadhaar</option>
                          <option value="luhn">Luhn</option>
                        </select>
                      )}
                      {(val.type === "date_format") && (
                        <input
                          type="text"
                          value={val.format || ""}
                          onChange={(e) =>
                            updateValidationInFieldRule(rIndex, vIndex, { format: e.target.value })
                          }
                          placeholder="Format (e.g., dd-mm-yyyy)"
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      )}
                      {val.type === "custom_llm" && (
                        <input
                          type="text"
                          value={val.prompt || ""}
                          onChange={(e) =>
                            updateValidationInFieldRule(rIndex, vIndex, { prompt: e.target.value })
                          }
                          placeholder="LLM validation prompt"
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      )}
                      <input
                        type="text"
                        value={val.message || ""}
                        onChange={(e) =>
                          updateValidationInFieldRule(rIndex, vIndex, {
                            message: e.target.value,
                          })
                        }
                        placeholder="Error message"
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeValidationFromFieldRule(rIndex, vIndex)}
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

        {/* Cross-Doc Rules */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              Cross-Doc Rules
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({form.crossDocRules.length})
              </span>
            </h2>
            <button
              type="button"
              onClick={addCrossDocRule}
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
              Add Cross-Doc Rule
            </button>
          </div>

          {form.crossDocRules.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">
              No cross-doc rules added yet. Click "Add Cross-Doc Rule" to get started.
            </p>
          )}

          <div className="space-y-4">
            {form.crossDocRules.map((rule, rIndex) => (
              <div
                key={rIndex}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700">
                    Cross-Doc Rule #{rIndex + 1}
                  </h3>
                  <button
                    type="button"
                    onClick={() => removeCrossDocRule(rIndex)}
                    className="text-red-500 hover:text-red-700 transition-colors"
                    title="Remove cross-doc rule"
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
                      Rule ID
                    </label>
                    <input
                      type="text"
                      value={rule.id}
                      onChange={(e) =>
                        updateCrossDocRule(rIndex, { id: e.target.value })
                      }
                      placeholder="e.g., name_match_pan_aadhaar"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={rule.description}
                      onChange={(e) =>
                        updateCrossDocRule(rIndex, { description: e.target.value })
                      }
                      placeholder="e.g., Name must match across documents"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Source Doc Type
                    </label>
                    <input
                      type="text"
                      value={rule.sourceDoc}
                      onChange={(e) =>
                        updateCrossDocRule(rIndex, { sourceDoc: e.target.value })
                      }
                      placeholder="e.g., pan_card"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Source Field
                    </label>
                    <input
                      type="text"
                      value={rule.sourceField}
                      onChange={(e) =>
                        updateCrossDocRule(rIndex, { sourceField: e.target.value })
                      }
                      placeholder="e.g., full_name"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Target Doc Type
                    </label>
                    <input
                      type="text"
                      value={rule.targetDoc}
                      onChange={(e) =>
                        updateCrossDocRule(rIndex, { targetDoc: e.target.value })
                      }
                      placeholder="e.g., aadhaar_card"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Target Field
                    </label>
                    <input
                      type="text"
                      value={rule.targetField}
                      onChange={(e) =>
                        updateCrossDocRule(rIndex, { targetField: e.target.value })
                      }
                      placeholder="e.g., full_name"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Match Type
                    </label>
                    <select
                      value={rule.matchType}
                      onChange={(e) =>
                        updateCrossDocRule(rIndex, {
                          matchType: e.target.value as CrossDocRule["matchType"],
                          threshold: e.target.value === "fuzzy" ? rule.threshold ?? 0.8 : undefined,
                        })
                      }
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                    >
                      <option value="exact">exact</option>
                      <option value="fuzzy">fuzzy</option>
                      <option value="contains">contains</option>
                      <option value="semantic">semantic</option>
                    </select>
                  </div>
                  {rule.matchType === "fuzzy" && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Threshold (0-1)
                      </label>
                      <input
                        type="number"
                        value={rule.threshold ?? 0.8}
                        onChange={(e) =>
                          updateCrossDocRule(rIndex, {
                            threshold: parseFloat(e.target.value) || 0,
                          })
                        }
                        min={0}
                        max={1}
                        step={0.05}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Metadata Rules */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              Metadata Rules
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({form.metadataRules.length})
              </span>
            </h2>
            <button
              type="button"
              onClick={addMetadataRule}
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
              Add Metadata Rule
            </button>
          </div>

          {form.metadataRules.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">
              No metadata rules added yet. Click "Add Metadata Rule" to get started.
            </p>
          )}

          <div className="space-y-4">
            {form.metadataRules.map((rule, rIndex) => (
              <div
                key={rIndex}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700">
                    Metadata Rule #{rIndex + 1}
                  </h3>
                  <button
                    type="button"
                    onClick={() => removeMetadataRule(rIndex)}
                    className="text-red-500 hover:text-red-700 transition-colors"
                    title="Remove metadata rule"
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
                      Rule ID
                    </label>
                    <input
                      type="text"
                      value={rule.id}
                      onChange={(e) =>
                        updateMetadataRule(rIndex, { id: e.target.value })
                      }
                      placeholder="e.g., mr_applicant_name"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Field Name
                    </label>
                    <input
                      type="text"
                      value={rule.field}
                      onChange={(e) =>
                        updateMetadataRule(rIndex, { field: e.target.value })
                      }
                      placeholder="e.g., applicant_name"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                </div>

                {/* Validations */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-gray-600">Validations</label>
                    <button
                      type="button"
                      onClick={() => addValidationToMetadataRule(rIndex)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      + Add Validation
                    </button>
                  </div>

                  {rule.validations.length === 0 && (
                    <p className="text-xs text-gray-400 py-2">No validations added</p>
                  )}

                  {rule.validations.map((val, vIndex) => (
                    <div
                      key={vIndex}
                      className="flex items-center gap-2 mb-2 flex-wrap"
                    >
                      <select
                        value={val.type}
                        onChange={(e) =>
                          updateValidationInMetadataRule(rIndex, vIndex, {
                            type: e.target.value,
                          })
                        }
                        className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                      >
                        {validationTypes.map((vt) => (
                          <option key={vt} value={vt}>
                            {vt}
                          </option>
                        ))}
                      </select>
                      {val.type === "regex" && (
                        <input
                          type="text"
                          value={val.pattern || ""}
                          onChange={(e) =>
                            updateValidationInMetadataRule(rIndex, vIndex, { pattern: e.target.value })
                          }
                          placeholder="Pattern (regex)"
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      )}
                      {(val.type === "length" || val.type === "numeric_range" || val.type === "date_range") && (
                        <>
                          <input
                            type="text"
                            value={val.min !== undefined && val.min !== null ? String(val.min) : ""}
                            onChange={(e) =>
                              updateValidationInMetadataRule(rIndex, vIndex, { min: e.target.value ? Number(e.target.value) || e.target.value : undefined })
                            }
                            placeholder="Min"
                            className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                          <input
                            type="text"
                            value={val.max !== undefined && val.max !== null ? String(val.max) : ""}
                            onChange={(e) =>
                              updateValidationInMetadataRule(rIndex, vIndex, { max: e.target.value ? Number(e.target.value) || e.target.value : undefined })
                            }
                            placeholder="Max"
                            className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                        </>
                      )}
                      {val.type === "enum" && (
                        <input
                          type="text"
                          value={(val.values ?? []).join(", ")}
                          onChange={(e) =>
                            updateValidationInMetadataRule(rIndex, vIndex, { values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                          }
                          placeholder="Values (comma-separated)"
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      )}
                      {val.type === "checksum" && (
                        <select
                          value={val.algorithm || ""}
                          onChange={(e) =>
                            updateValidationInMetadataRule(rIndex, vIndex, { algorithm: e.target.value })
                          }
                          className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                        >
                          <option value="">Select algorithm</option>
                          <option value="pan">PAN</option>
                          <option value="gstin">GSTIN</option>
                          <option value="aadhaar">Aadhaar</option>
                          <option value="luhn">Luhn</option>
                        </select>
                      )}
                      {(val.type === "date_format") && (
                        <input
                          type="text"
                          value={val.format || ""}
                          onChange={(e) =>
                            updateValidationInMetadataRule(rIndex, vIndex, { format: e.target.value })
                          }
                          placeholder="Format (e.g., dd-mm-yyyy)"
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      )}
                      {val.type === "custom_llm" && (
                        <input
                          type="text"
                          value={val.prompt || ""}
                          onChange={(e) =>
                            updateValidationInMetadataRule(rIndex, vIndex, { prompt: e.target.value })
                          }
                          placeholder="LLM validation prompt"
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      )}
                      <input
                        type="text"
                        value={val.message || ""}
                        onChange={(e) =>
                          updateValidationInMetadataRule(rIndex, vIndex, {
                            message: e.target.value,
                          })
                        }
                        placeholder="Error message"
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeValidationFromMetadataRule(rIndex, vIndex)}
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

        {/* Prompt Config */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Prompt Config</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <input
                type="text"
                value={form.promptConfig.role || ""}
                onChange={(e) =>
                  updatePromptConfig({ role: e.target.value || undefined })
                }
                placeholder="e.g., You are a document verification specialist for a healthcare company."
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Organization Context
              </label>
              <textarea
                value={form.promptConfig.organizationContext || ""}
                onChange={(e) =>
                  updatePromptConfig({ organizationContext: e.target.value || undefined })
                }
                rows={3}
                placeholder="Describe your organization context for AI extraction..."
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Custom Instructions
              </label>
              <textarea
                value={form.promptConfig.customInstructions || ""}
                onChange={(e) =>
                  updatePromptConfig({ customInstructions: e.target.value || undefined })
                }
                rows={4}
                placeholder="Additional extraction instructions appended to the auto-generated prompt (normalization rules, special attention items, etc.)"
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Context Fields (comma-separated)
              </label>
              <input
                type="text"
                value={form.promptConfig.contextFields?.join(", ") || ""}
                onChange={(e) =>
                  updatePromptConfig({
                    contextFields: e.target.value
                      ? e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                      : undefined,
                  })
                }
                placeholder="e.g., applicant_name, application_date, branch_code"
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.promptConfig.multiDocPerFile ?? false}
                  onChange={(e) =>
                    updatePromptConfig({ multiDocPerFile: e.target.checked || undefined })
                  }
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Multi-doc per file
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.promptConfig.imageQualityAssessment ?? false}
                  onChange={(e) =>
                    updatePromptConfig({ imageQualityAssessment: e.target.checked || undefined })
                  }
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Image quality assessment
              </label>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={form.promptConfig.temperature ?? ""}
                  onChange={(e) =>
                    updatePromptConfig({ temperature: e.target.value !== "" ? Number(e.target.value) : undefined })
                  }
                  placeholder="0"
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
            <details className="mt-2">
              <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700">
                Advanced Overrides
              </summary>
              <div className="space-y-4 mt-3 p-3 bg-gray-50 rounded-lg">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Custom System Prompt (overrides auto-generation)
                  </label>
                  <textarea
                    value={form.promptConfig.customSystemPrompt || ""}
                    onChange={(e) =>
                      updatePromptConfig({ customSystemPrompt: e.target.value || undefined })
                    }
                    rows={4}
                    placeholder="Leave empty to use auto-generated prompt. If set, replaces the entire system prompt. Supports ${variable} substitution from job metadata."
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Custom Analysis Prompt (overrides cross-doc validation prompt)
                  </label>
                  <textarea
                    value={form.promptConfig.customAnalysisPrompt || ""}
                    onChange={(e) =>
                      updatePromptConfig({ customAnalysisPrompt: e.target.value || undefined })
                    }
                    rows={4}
                    placeholder="Leave empty to use auto-generated analysis prompt. If set, replaces the cross-document validation prompt."
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none font-mono"
                  />
                </div>
              </div>
            </details>
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
