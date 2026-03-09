import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { evaluate, semanticMatch } from "@docproof/core";
import type {
  RuleSet,
  ExtractionResult,
  TokenUsage,
  CrossDocValidationResult,
  DocumentAnalysis,
} from "@docproof/core";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ValidateInput {
  jobId: string;
  ruleSetId: string;
  ruleSetVersion: number;
  extractions: ExtractionResult[];
}

/**
 * Step 3: Run rule engine on extracted data + semantic cross-doc validation.
 *
 * 1. Runs deterministic field rules, fuzzy matching, and anomaly detection via engine.
 * 2. Runs semantic cross-doc rules via LLM (Sonnet) for rules with matchType="semantic".
 * 3. Returns combined result with token usage from semantic matches.
 */
export const handler = async (event: ValidateInput) => {
  const { jobId, ruleSetId, extractions } = event;

  // Load full ruleset
  const { Item: ruleSetItem } = await ddb.send(
    new GetCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `RULESET#${ruleSetId}`, sk: "META" },
    })
  );

  if (!ruleSetItem) throw new Error(`RuleSet ${ruleSetId} not found`);

  // Load job metadata
  const { Item: job } = await ddb.send(
    new GetCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `JOB#${jobId}`, sk: "META" },
    })
  );

  const ruleSet = ruleSetItem as unknown as RuleSet;
  const metadata = job?.metadata ?? {};

  // Phase 1: Run deterministic rule engine (field rules, fuzzy matching, anomalies)
  const result = evaluate({
    jobId,
    ruleSet,
    extractions,
    metadata,
  });

  // Phase 2: Run semantic cross-doc rules via LLM
  const semanticRules = (ruleSet.crossDocRules ?? []).filter(
    (r) => r.matchType === "semantic"
  );

  const validationTokenUsage: TokenUsage[] = [];

  // Flatten all analyses for lookup
  const allAnalyses: { fileId: string; analysis: DocumentAnalysis }[] = [];
  for (const ext of extractions) {
    for (const analysis of ext.analyses) {
      allAnalyses.push({ fileId: ext.fileId, analysis });
    }
  }

  for (const rule of semanticRules) {
    const sourceAnalysis = allAnalyses.find(
      (a) => a.analysis.documentType === rule.sourceDoc
    )?.analysis;
    const targetAnalysis = allAnalyses.find(
      (a) => a.analysis.documentType === rule.targetDoc
    )?.analysis;

    if (!sourceAnalysis || !targetAnalysis) continue;

    const sourceVal = String(
      sourceAnalysis.extractedFields[rule.sourceField] ?? ""
    );
    const targetVal = String(
      targetAnalysis.extractedFields[rule.targetField] ?? ""
    );

    const matchResult = await semanticMatch(
      { metadata },
      rule.description,
      {
        type: rule.sourceDoc,
        fields: sourceAnalysis.extractedFields as Record<string, unknown>,
      },
      {
        type: rule.targetDoc,
        fields: targetAnalysis.extractedFields as Record<string, unknown>,
      }
    );

    validationTokenUsage.push(matchResult.tokenUsage);

    result.crossDocResults.push({
      ruleId: rule.id,
      description: rule.description,
      status: matchResult.match ? "pass" : "fail",
      confidence: matchResult.confidence,
      sourceValue: sourceVal,
      targetValue: targetVal,
      reasoning: matchResult.reasoning,
    });
  }

  // Re-evaluate overall status with semantic results included
  const crossDocFails = result.crossDocResults.filter(
    (r) => r.status === "fail"
  ).length;
  if (crossDocFails > 0 && result.overallStatus === "pass") {
    result.overallStatus = "fail";
  }

  // Update status to validating (orchestrator will move to next step)
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `JOB#${jobId}`, sk: "META" },
      UpdateExpression:
        "SET #status = :s, updatedAt = :now, gsi1pk = :gsi1pk, gsi1sk = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":s": "validating",
        ":gsi1pk": "STATUS#validating",
        ":now": now,
      },
    })
  );

  return {
    ...result,
    validationTokenUsage,
  };
};
