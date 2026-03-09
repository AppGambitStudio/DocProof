/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "docproof",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "ap-south-1",
        },
      },
    };
  },
  async run() {
    const { storage } = await import("./infra/storage");
    const { auth } = await import("./infra/auth");
    const { api } = await import("./infra/api");
    const { pipeline } = await import("./infra/jobs");
    const { events } = await import("./infra/events");
    const { web } = await import("./infra/web");

    return {
      apiUrl: api.url,
      webUrl: web.url,
      bucketName: storage.bucket.name,
      tableName: storage.table.name,
      userPoolId: auth.userPool.id,
      userPoolClientId: auth.userPoolClient.id,
    };
  },
});
