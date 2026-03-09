import type { Validation, ValidationStatus } from "./types";

interface ValidatorResult {
  status: ValidationStatus;
  message: string;
  expected?: string;
  actual?: string;
}

type ValidatorFn = (
  value: unknown,
  validation: Validation
) => ValidatorResult;

const required: ValidatorFn = (value) => {
  const pass = value !== null && value !== undefined && value !== "";
  return {
    status: pass ? "pass" : "fail",
    message: pass ? "Field is present" : "Required field is missing",
  };
};

const regex: ValidatorFn = (value, v) => {
  if (v.type !== "regex") throw new Error("Invalid validation type");
  const str = String(value ?? "");
  const re = new RegExp(v.pattern);
  const pass = re.test(str);
  return {
    status: pass ? "pass" : "fail",
    message: pass
      ? "Pattern matched"
      : v.message ?? `Value does not match pattern: ${v.pattern}`,
    expected: v.pattern,
    actual: str,
  };
};

const length: ValidatorFn = (value, v) => {
  if (v.type !== "length") throw new Error("Invalid validation type");
  const str = String(value ?? "");
  const len = str.length;
  const minOk = v.min === undefined || len >= v.min;
  const maxOk = v.max === undefined || len <= v.max;
  const pass = minOk && maxOk;
  return {
    status: pass ? "pass" : "fail",
    message: pass
      ? "Length within range"
      : `Length ${len} outside range [${v.min ?? "∞"}, ${v.max ?? "∞"}]`,
    expected: `${v.min ?? "∞"}-${v.max ?? "∞"}`,
    actual: String(len),
  };
};

const enumValidator: ValidatorFn = (value, v) => {
  if (v.type !== "enum") throw new Error("Invalid validation type");
  const str = String(value ?? "");
  const pass = v.values.includes(str);
  return {
    status: pass ? "pass" : "fail",
    message: pass
      ? "Value is in allowed set"
      : `Value "${str}" not in allowed values: ${v.values.join(", ")}`,
    expected: v.values.join(" | "),
    actual: str,
  };
};

const numericRange: ValidatorFn = (value, v) => {
  if (v.type !== "numeric_range") throw new Error("Invalid validation type");
  const num = Number(value);
  if (isNaN(num)) {
    return { status: "fail", message: "Value is not a number", actual: String(value) };
  }
  const minOk = v.min === undefined || num >= v.min;
  const maxOk = v.max === undefined || num <= v.max;
  const pass = minOk && maxOk;
  return {
    status: pass ? "pass" : "fail",
    message: pass
      ? "Value within range"
      : `Value ${num} outside range [${v.min ?? "-∞"}, ${v.max ?? "∞"}]`,
    expected: `${v.min ?? "-∞"} to ${v.max ?? "∞"}`,
    actual: String(num),
  };
};

// ─── Checksum validators for Indian document numbers ───

function validatePAN(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase());
}

function validateGSTIN(gstin: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/.test(
    gstin.toUpperCase()
  );
}

function validateAadhaar(aadhaar: string): boolean {
  const digits = aadhaar.replace(/\s/g, "");
  return /^\d{12}$/.test(digits);
}

function validateLuhn(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

const checksumValidators: Record<string, (v: string) => boolean> = {
  pan: validatePAN,
  gstin: validateGSTIN,
  aadhaar: validateAadhaar,
  luhn: validateLuhn,
};

const checksum: ValidatorFn = (value, v) => {
  if (v.type !== "checksum") throw new Error("Invalid validation type");
  const str = String(value ?? "");
  const fn = checksumValidators[v.algorithm];
  if (!fn) {
    return { status: "fail", message: `Unknown checksum algorithm: ${v.algorithm}` };
  }
  const pass = fn(str);
  return {
    status: pass ? "pass" : "fail",
    message: pass
      ? `${v.algorithm.toUpperCase()} checksum valid`
      : `${v.algorithm.toUpperCase()} checksum invalid`,
    actual: str,
  };
};

// ─── Validator Registry ───

const validators: Record<string, ValidatorFn> = {
  required,
  regex,
  length,
  enum: enumValidator,
  numeric_range: numericRange,
  checksum,
  // date_format and date_range can be added here
  // custom_llm is handled separately in the pipeline
};

/**
 * Run a single validation against a value.
 * Returns undefined for validation types that need external handling (e.g., custom_llm).
 */
export function runValidation(
  value: unknown,
  validation: Validation
): ValidatorResult | undefined {
  const fn = validators[validation.type];
  if (!fn) return undefined; // handled externally
  return fn(value, validation);
}

/**
 * Run all validations for a field value.
 * Skips custom_llm validations (returned as pending).
 */
export function runAllValidations(
  value: unknown,
  validations: Validation[]
): { results: ValidatorResult[]; pendingLlm: Validation[] } {
  const results: ValidatorResult[] = [];
  const pendingLlm: Validation[] = [];

  for (const v of validations) {
    if (v.type === "custom_llm") {
      pendingLlm.push(v);
      continue;
    }
    const result = runValidation(value, v);
    if (result) results.push(result);
  }

  return { results, pendingLlm };
}
