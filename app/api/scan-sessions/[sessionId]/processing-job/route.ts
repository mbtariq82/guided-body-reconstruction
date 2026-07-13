import { NextResponse } from "next/server";
import { readScanProcessingJobStatus } from "@/scripts/process-scan-jobs.mjs";

export const runtime = "nodejs";

type ProcessingJobRouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: ProcessingJobRouteContext) {
  const { sessionId } = await context.params;

  try {
    return NextResponse.json(await readScanProcessingJobStatus(sessionId));
  } catch {
    return NextResponse.json({ error: "Processing job not found." }, { status: 404 });
  }
}
