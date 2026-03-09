// --- API Key for Job API (machine-to-machine) ---

export const apiKeySecret = new sst.Secret("DocProofApiKey");

const apiKeyAuthorizer = new sst.aws.Function("ApiKeyAuthorizer", {
  handler: "packages/functions/src/api/auth/api-key-authorizer.handler",
  link: [apiKeySecret],
  timeout: "10 seconds",
});

// --- Cognito for Admin API ---

const userPool = new sst.aws.CognitoUserPool("DocProofUserPool", {
  aliases: ["email"],
});

const userPoolClient = userPool.addClient("DocProofWebClient");

export const auth = {
  userPool,
  userPoolClient,
  apiKeySecret,
  apiKeyAuthorizer,
};
