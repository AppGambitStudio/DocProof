interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const colorMap: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pass: "bg-green-100 text-green-800",
  completed: "bg-green-100 text-green-800",
  valid: "bg-green-100 text-green-800",
  match: "bg-green-100 text-green-800",
  draft: "bg-yellow-100 text-yellow-800",
  pending: "bg-yellow-100 text-yellow-800",
  review: "bg-yellow-100 text-yellow-800",
  review_required: "bg-yellow-100 text-yellow-800",
  warn: "bg-yellow-100 text-yellow-800",
  partial_match: "bg-yellow-100 text-yellow-800",
  anomaly: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  created: "bg-blue-100 text-blue-800",
  uploading: "bg-blue-100 text-blue-800",
  extracting: "bg-blue-100 text-blue-800",
  validating: "bg-blue-100 text-blue-800",
  archived: "bg-gray-100 text-gray-600",
  fail: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
  invalid: "bg-red-100 text-red-800",
  mismatch: "bg-red-100 text-red-800",
  illegible: "bg-gray-100 text-gray-600",
};

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const colors = colorMap[status] || "bg-gray-100 text-gray-700";
  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm";

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full capitalize ${colors} ${sizeClasses}`}
    >
      {status}
    </span>
  );
}
