# Rule Authoring Guide

Rules are the heart of DocProof. A **RuleSet** defines everything needed to validate one type of onboarding: what documents are expected, what fields to extract, what validations to run, and how documents relate to each other.

## RuleSet Structure

```typescript
interface RuleSet {
  id: string;                          // unique identifier, e.g. "kyc_india_individual"
  name: string;                        // human-readable name
  description?: string;
  version: number;
  status: "draft" | "active" | "archived";
  documentTypes: DocumentTypeConfig[]; // what documents to collect
  fieldRules: FieldRule[];             // per-field validations
  crossDocRules: CrossDocRule[];       // cross-document consistency checks
  metadataRules: MetadataRule[];       // job-level metadata validations
  promptConfig?: PromptConfig;        // custom prompt configuration
}
```

### Document Types

Each document type defines what to collect and how to extract data from it:

```typescript
interface DocumentTypeConfig {
  typeId: string;               // e.g. "pan_card", "bank_statement"
  label: string;                // display name
  required: boolean;            // is this document mandatory?
  maxCount: number;             // how many files of this type are allowed
  acceptedFormats: string[];    // e.g. ["pdf", "jpg", "png"]
  extractionPrompt: string;     // Claude prompt for extracting fields
  expectedFields: FieldDefinition[];
  satisfiesTypes?: string[];    // other typeIds this document can substitute for
  fieldExtractionRules?: FieldExtractionRule[];  // per-field extraction instructions
  flagConditions?: FlagCondition[];              // conditions that flag a document for review
  applicableTo?: string[];                       // restrict to specific metadata values
  category?: string;                             // grouping category (e.g. "identity", "address", "financial")
}
```

#### `satisfiesTypes` — Document Substitution

The `satisfiesTypes` field declares that a document type can serve as a substitute for other required types. This is useful when one document inherently contains the same information as another.

**Example:** An Aadhaar card contains a verified address, so it can also count as address proof:

```json
{
  "typeId": "aadhaar_card",
  "label": "Aadhaar Card",
  "required": true,
  "satisfiesTypes": ["address_proof"],
  ...
}
```

With this configuration, if a job includes an Aadhaar card but no separate address proof document, the engine will use the Aadhaar card's extracted data for any cross-document rules that reference `address_proof`.

**Important:** Set `satisfiesTypes` on the document that *provides* the substitute, not on the document being substituted. Think of it as "this document also counts as...".

```typescript
interface FieldDefinition {
  name: string;                 // field key, e.g. "pan_number"
  label: string;                // display label
  type: "string" | "number" | "date" | "boolean" | "enum";
  description?: string;         // helps Claude understand what to extract
}
```

### Field Rules

Field rules define validations on individual extracted fields:

```typescript
interface FieldRule {
  id: string;                   // unique rule ID
  documentType: string;         // which document type this applies to
  field: string;                // which field to validate
  validations: Validation[];    // list of checks to run
}
```

### Cross-Document Rules

Cross-document rules verify consistency between fields across different documents:

```typescript
interface CrossDocRule {
  id: string;
  description: string;          // e.g. "Name on PAN must match name on Aadhaar"
  sourceDoc: string;            // source document type ID
  sourceField: string;          // field in source document
  targetDoc: string;            // target document type ID
  targetField: string;          // field in target document
  matchType: "exact" | "fuzzy" | "contains" | "semantic";
  threshold?: number;           // confidence threshold for fuzzy/semantic (0-1)
}
```

### Metadata Rules

Metadata rules validate job-level metadata (data passed when creating the job, not extracted from documents):

```typescript
interface MetadataRule {
  id: string;
  field: string;                // metadata field name
  validations: Validation[];
}
```

### Prompt Configuration

Optional configuration that customizes how Claude extracts data from documents:

```typescript
interface PromptConfig {
  systemPrompt?: string;     // custom system prompt override
  extractionInstructions?: string;  // additional instructions appended to extraction prompts
  outputFormat?: string;     // custom output format instructions
  temperature?: number;      // model temperature (0-1, default 0)
}
```

When `promptConfig` is set on a RuleSet, it is used across all extraction calls for that ruleset. This allows you to customize extraction behavior per use case — for example, adding domain-specific instructions or adjusting the output format.

## Validation Types

### `required`

Checks that the field has a non-null, non-empty value.

```json
{ "type": "required" }
```

### `regex`

Validates the field value against a regular expression pattern.

```json
{ "type": "regex", "pattern": "^[A-Z]{5}[0-9]{4}[A-Z]$", "message": "Invalid PAN format" }
```

### `length`

Checks string length is within bounds.

```json
{ "type": "length", "min": 2, "max": 100 }
```

Either `min` or `max` can be omitted for one-sided checks.

### `enum`

Validates the field value is one of an allowed set.

```json
{ "type": "enum", "values": ["utility_bill", "bank_statement", "rent_agreement", "voter_id", "passport"] }
```

### `date_format`

Checks that the field matches a date format string.

```json
{ "type": "date_format", "format": "DD/MM/YYYY" }
```

### `date_range`

Validates a date falls within a range. Supports absolute dates and relative expressions.

```json
{ "type": "date_range", "relative": "-90d", "max": "today" }
```

This example checks that the date is within the last 90 days. You can also use absolute values:

```json
{ "type": "date_range", "min": "2020-01-01", "max": "2026-12-31" }
```

### `numeric_range`

Checks that a numeric value falls within bounds.

```json
{ "type": "numeric_range", "min": 0, "max": 150 }
```

### `checksum`

Runs a checksum algorithm against the field value. Supported algorithms:

| Algorithm | Description | Example |
|---|---|---|
| `pan` | Indian PAN number checksum | `ABCDE1234F` |
| `gstin` | Indian GST Identification Number | `22AAAAA0000A1Z5` |
| `aadhaar` | Indian Aadhaar (Verhoeff algorithm) | `1234 5678 9012` |
| `luhn` | Luhn algorithm (credit cards, etc.) | `4111111111111111` |

```json
{ "type": "checksum", "algorithm": "pan" }
```

### `custom_llm`

Falls back to Claude for validations that cannot be expressed as deterministic rules. Provide a prompt that describes the check.

```json
{
  "type": "custom_llm",
  "prompt": "Check if the photograph on this document appears to be a recent photo of an adult. Consider image quality, face visibility, and whether it looks like a proper ID photo."
}
```

Use this sparingly -- it adds a Claude API call per validation.

## Cross-Document Match Types

### `exact`

Values must be identical (after trimming whitespace). Date-like values are automatically normalized — different separators are treated as equivalent, so `31/08/2002` matches `31-08-2002` and `31.08.2002`.

```json
{
  "sourceDoc": "pan_card", "sourceField": "date_of_birth",
  "targetDoc": "aadhaar_card", "targetField": "date_of_birth",
  "matchType": "exact"
}
```

### `fuzzy`

String similarity matching with a configurable threshold (0-1). Useful for name matching where minor spelling differences are acceptable.

```json
{
  "sourceDoc": "pan_card", "sourceField": "full_name",
  "targetDoc": "aadhaar_card", "targetField": "full_name",
  "matchType": "fuzzy",
  "threshold": 0.85
}
```

### `contains`

Checks if the source value is contained within the target value (or vice versa).

```json
{
  "sourceDoc": "pan_card", "sourceField": "full_name",
  "targetDoc": "bank_statement", "targetField": "account_holder",
  "matchType": "contains"
}
```

### `semantic`

Uses Claude to determine if two values refer to the same thing, even with completely different formatting. Best for address matching.

```json
{
  "sourceDoc": "aadhaar_card", "sourceField": "address",
  "targetDoc": "address_proof", "targetField": "address",
  "matchType": "semantic"
}
```

This triggers a Claude API call that compares the two values with contextual understanding.

### Extraction Output

Each file extraction returns one or more `DocumentAnalysis` objects (a single file may contain multiple documents):

```typescript
interface DocumentAnalysis {
  documentType: string;              // detected document type
  confidence: "HIGH" | "MEDIUM" | "LOW";  // extraction confidence
  extractedFields: Record<string, unknown>;
  anomalies: string[];               // detected issues (e.g. "Document appears tampered")
  imageQuality?: string;             // quality assessment for image-based documents
  nameMatch?: boolean;               // whether detected name matches metadata
  dateFields?: Record<string, string>;  // normalized date fields
}
```

**Confidence levels:**
- **HIGH** — All fields extracted clearly, document is legible
- **MEDIUM** — Most fields extracted, some uncertainty
- **LOW** — Significant extraction issues; triggers automatic escalation to a more capable model (Sonnet)

## Creating a RuleSet via the API

```bash
curl -X POST <your-api-url>/admin/rule-sets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <cognito-token>" \
  -d '{
    "id": "my_onboarding",
    "name": "My Onboarding Flow",
    "version": 1,
    "status": "active",
    "documentTypes": [
      {
        "typeId": "id_card",
        "label": "Government ID",
        "required": true,
        "maxCount": 1,
        "acceptedFormats": ["pdf", "jpg", "png"],
        "extractionPrompt": "Extract the full name, ID number, and date of birth from this government-issued ID.",
        "expectedFields": [
          { "name": "full_name", "label": "Full Name", "type": "string" },
          { "name": "id_number", "label": "ID Number", "type": "string" },
          { "name": "date_of_birth", "label": "Date of Birth", "type": "date" }
        ]
      }
    ],
    "fieldRules": [
      {
        "id": "fr_name_required",
        "documentType": "id_card",
        "field": "full_name",
        "validations": [
          { "type": "required" },
          { "type": "length", "min": 2, "max": 100 }
        ]
      }
    ],
    "crossDocRules": [],
    "metadataRules": []
  }'
```

## Example: KYC India

See [`examples/kyc-india/ruleset.json`](../examples/kyc-india/ruleset.json) for a complete working example that covers:

- **PAN card** validation with checksum verification
- **Aadhaar card** validation with Verhoeff checksum
- **Address proof** with recency check (document must be within 90 days)
- **Cross-document checks**: name matching (fuzzy) across PAN/Aadhaar/address proof, date of birth matching (exact), and address consistency (semantic)

Use it as a starting point for your own rule sets:

```bash
curl -X POST <your-api-url>/admin/rule-sets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <cognito-token>" \
  -d @examples/kyc-india/ruleset.json
```

## Example: Vendor Onboarding (Indian Company)

See [`examples/vendor-onboarding-india/ruleset.json`](../examples/vendor-onboarding-india/ruleset.json) for a company-level onboarding example covering:

- **Certificate of Incorporation** with CIN format validation
- **Company PAN** with checksum and entity type verification
- **GST Certificate** with GSTIN checksum, active status check, and PAN-in-GSTIN cross-validation
- **MSME / Udyam Registration** with registration number format validation
- **Cancelled Cheque** with IFSC format validation and account number length check
- **Authorized Signatory ID** (PAN/Aadhaar/Passport) for director/signatory verification
- **Board Resolution** for signatory authorization
- **Cross-document checks**: company name matching across PAN/GST/Incorporation (fuzzy), PAN embedded in GSTIN (contains), address consistency (semantic), signatory name in board resolution (fuzzy)
- **Metadata rules**: `companyName` and `entityType` (PRIVATE_LIMITED, PUBLIC_LIMITED, LLP, PARTNERSHIP, PROPRIETORSHIP)
- **Prompt config**: domain-specific system prompt for Indian corporate document verification

```bash
curl -X POST <your-api-url>/admin/rule-sets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <cognito-token>" \
  -d @examples/vendor-onboarding-india/ruleset.json
```
