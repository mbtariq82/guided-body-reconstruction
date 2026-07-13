import { NextResponse } from "next/server";
import { processScanSession } from "@/scripts/process-scan-jobs.mjs";

export const runtime = "nodejs";

type ProcessSessionRouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(_request: Request, context: ProcessSessionRouteContext) {
  const { sessionId } = await context.params;

  try {
    return NextResponse.json(await processScanSession(sessionId));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to process scan session.",
      },
      { status: 404 },
    );
  }
}
