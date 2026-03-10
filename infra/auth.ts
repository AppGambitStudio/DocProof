// --- API Key for Job API (machine-to-machine) ---

export const apiKeySecret = new sst.Secret("DocProofApiKey", "ffa54db8-3b0f-4e12-b4fb-365591e8f8cd");

const apiKeyAuthorizer = new sst.aws.Function("ApiKeyAuthorizer", {
  handler: "packages/functions/src/api/auth/api-key-authorizer.handler",
  link: [apiKeySecret],
  timeout: "10 seconds",
});

// --- Cognito for Admin API ---

const userPool = new sst.aws.CognitoUserPool("DocProofUserPool", {
  usernames: ["email"],
  transform: {
    userPool: {
      passwordPolicy: {
        minimumLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSymbols: false,
      },
      adminCreateUserConfig: {
        allowAdminCreateUserOnly: true,
      },
    },
  }
});

const userPoolClient = userPool.addClient("DocProofWebClient", {
  transform: {
    client: {
      explicitAuthFlows: [
        "ALLOW_USER_SRP_AUTH",
        "ALLOW_REFRESH_TOKEN_AUTH",
      ],
      accessTokenValidity: 1, // 1 hour
      idTokenValidity: 1, // 1 hour
      refreshTokenValidity: 30, // 30 days
      tokenValidityUnits: {
        accessToken: "hours",
        idToken: "hours",
        refreshToken: "days",
      },
      generateSecret: false,
    },
  }
});

export const auth = {
  userPool,
  userPoolClient,
  apiKeySecret,
  apiKeyAuthorizer,
};
