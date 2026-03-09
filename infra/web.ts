import { api } from "./api";
import { auth } from "./auth";

export const web = new sst.aws.StaticSite("DocProofWeb", {
  path: "packages/web",
  build: {
    command: "pnpm run build",
    output: "dist",
  },
  environment: {
    VITE_API_URL: api.url,
    VITE_USER_POOL_ID: auth.userPool.id,
    VITE_USER_POOL_CLIENT_ID: auth.userPoolClient.id,
  },
});
