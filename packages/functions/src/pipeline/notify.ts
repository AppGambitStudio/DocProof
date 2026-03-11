import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

interface NotifyInput {
  jobId: string;
  status: string;
  costUsd?: number;
  resultKey?: string;
}

/**
 * Step 5: Publish EventBridge event for job completion.
 * The EventBridge subscriber (webhook.ts) handles callback delivery.
 */
export const handler = async (event: NotifyInput) => {
  const { jobId, status, costUsd, resultKey } = event;

  console.log(`Notifying job ${jobId} completion: status=${status}`);

  // Load job to get callbackUrl and metadata
  const { Item: job } = await ddb.send(
    new GetCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `JOB#${jobId}`, sk: "META" },
    })
  );

  // Publish to EventBridge
  const detailType =
    status === "completed"
      ? "job.completed"
      : status === "review_required"
        ? "job.review_required"
        : "job.failed";

  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: Resource.DocProofBus.name,
          Source: "docproof.jobs",
          DetailType: detailType,
          Detail: JSON.stringify({
            jobId,
            status,
            costUsd,
            resultKey,
            ruleSetId: job?.ruleSetId,
            externalRef: job?.externalRef,
            callbackUrl: job?.callbackUrl,
          }),
        },
      ],
    })
  );

  console.log(`EventBridge event published: ${detailType} for job ${jobId}`);

  return { jobId, notified: true };
};
