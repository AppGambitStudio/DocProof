export interface AppSettings {
  // Models
  defaultModel: string;
  escalationModel: string;
  escalationThreshold: "LOW" | "MEDIUM";
  defaultTemperature: number;
  // Limits
  maxFileSizeMb: number;
  maxFilesPerJob: number;
  // Retention
  documentRetentionDays: number;
  resultRetentionDays: number;
  // Webhooks
  webhookRetryAttempts: number;
  webhookTimeoutMs: number;
  // Review
  reviewAssignmentMode: "manual" | "round_robin";
  // Notifications (future)
  notificationEmail: string | null;
  slackWebhookUrl: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  escalationModel: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  escalationThreshold: "LOW",
  defaultTemperature: 0,
  maxFileSizeMb: 10,
  maxFilesPerJob: 20,
  documentRetentionDays: 90,
  resultRetentionDays: 365,
  webhookRetryAttempts: 3,
  webhookTimeoutMs: 10000,
  reviewAssignmentMode: "manual",
  notificationEmail: null,
  slackWebhookUrl: null,
};

// Whitelist of fields that can be updated via API
export const SETTINGS_FIELDS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];
