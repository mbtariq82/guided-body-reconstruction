import {
  readAvatarReconstructionState,
  requestSelfHostedAvatarReconstruction,
} from "./avatar-reconstruction-service.mjs";

const sessionId = process.argv[2];
const force = process.argv.includes("--force");

if (!sessionId) {
  console.error("Usage: npm run reconstruct-avatar -- <session-id> [--force]");
  process.exit(1);
}

try {
  const result = await requestSelfHostedAvatarReconstruction(sessionId, { force });
  console.log(JSON.stringify(result, null, 2));

  if (result.job?.status === "failed") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Unable to run avatar reconstruction.",
  );
  const state = await readAvatarReconstructionState(sessionId).catch(() => null);

  if (state) {
    console.error(JSON.stringify(state, null, 2));
  }

  process.exit(1);
}
