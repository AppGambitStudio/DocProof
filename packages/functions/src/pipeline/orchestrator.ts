import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { handler as receive } from "./receive";
import { handler as extract } from "./extract";
import { handler as validate } from "./validate";
import { handler as compile } from "./compile";
import { handler as notify } from "./notify";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

interface OrchestratorInput {
  jobId: string;
}

/**
 * Single Lambda orchestrator for the DocProof pipeline.
 *
 * Runs all steps sequentially in one Lambda execution:
 *   Receive → Extract (parallel) → Validate → Compile → Notify
 *
 * This approach works well for workloads with up to ~10 documents per job
 * (typically under 10 minutes). For heavier workloads, consider switching
 * to Step Functions or increasing the Lambda timeout (max 15 min).
 */
export const handler = async (event: OrchestratorInput) => {
  const { jobId } = event;

  console.log(`Pipeline started for job ${jobId}`);

  try {
    // Step 1: Receive — load job + ruleset, update status, prepare extraction tasks
    const receiveResult = await receive({ jobId });

    console.log(
      `Job ${jobId}: ${receiveResult.extractionTasks.length} files to extract`
    );

    // Step 2: Extract — process all files in parallel
    const extractions = await Promise.all(
      receiveResult.extractionTasks.map((task: Parameters<typeof extract>[0]) => extract(task))
    );

    console.log(
      `Job ${jobId}: extraction complete, ${extractions.length} results`
    );

    // Step 3: Validate — run rule engine + semantic cross-doc validation
    const validateResult = await validate({
      jobId: receiveResult.jobId,
      ruleSetId: receiveResult.ruleSetId,
      ruleSetVersion: receiveResult.ruleSetVersion,
      extractions,
    });

    console.log(
      `Job ${jobId}: validation complete, status=${validateResult.overallStatus}`
    );

    // Step 4: Compile — aggregate tokens, calculate cost, store results
    const compileResult = await compile({
      jobId: validateResult.jobId,
      overallStatus: validateResult.overallStatus,
      summary: validateResult.summary,
      documents: validateResult.documents,
      crossDocResults: validateResult.crossDocResults,
      anomalies: validateResult.anomalies,
      validationTokenUsage: validateResult.validationTokenUsage,
    });

    console.log(
      `Job ${jobId}: compiled, cost=$${compileResult.costUsd.toFixed(6)}`
    );

    // Step 5: Notify — publish EventBridge event
    await notify(compileResult);

    console.log(`Pipeline completed for job ${jobId}`);

    return { jobId, status: compileResult.status, costUsd: compileResult.costUsd };
  } catch (err) {
    console.error(`Pipeline failed for job ${jobId}:`, err);

    // Update job status to failed
    try {
      const now = new Date().toISOString();
      await ddb.send(
        new UpdateCommand({
          TableName: Resource.DocProofTable.name,
          Key: { pk: `JOB#${jobId}`, sk: "META" },
          UpdateExpression:
            "SET #status = :s, updatedAt = :now, gsi1pk = :gsi1pk, gsi1sk = :now, failureReason = :reason",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":s": "failed",
            ":gsi1pk": "STATUS#failed",
            ":now": now,
            ":reason": err instanceof Error ? err.message : "Unknown error",
          },
        })
      );

      // Publish failure event
      await eventBridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "docproof.jobs",
              DetailType: "job.failed",
              Detail: JSON.stringify({
                jobId,
                status: "failed",
                error: err instanceof Error ? err.message : "Unknown error",
              }),
            },
          ],
        })
      );
    } catch (updateErr) {
      console.error(
        `Failed to update job ${jobId} status after pipeline error:`,
        updateErr
      );
    }

    throw err;
  }
};
