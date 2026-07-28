/**
 * The current deployment's identity — used to detect "the backend redeployed
 * while this page was open", which is the REAL cause of the bulk-upload "Failed
 * to fetch" (a redeploy invalidates the Server Action references baked into an
 * already-loaded page; the next action POST then fails at the network layer).
 *
 * The page embeds this at render time; the client polls /api/deploy-version and
 * compares. A mismatch means a new deployment is live → prompt a reload BEFORE
 * the operator loses an upload. Locally there is no Vercel id, so it resolves to
 * "dev" on both sides and never false-fires.
 */
export function deployVersion(): string {
  return (
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_BUILD_ID ??
    "dev"
  );
}
