import { aiAssistReviewRequestSchema } from "@shopsmart/contracts";
import { NextResponse } from "next/server";

const apiUrl = process.env.SHOPSMART_API_URL ?? "http://127.0.0.1:8310";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const parsed = aiAssistReviewRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_AI_REVIEW", message: "Neplatné rozhodnutí review." },
      { status: 400 },
    );
  }
  const { proposalId } = await params;
  const incomingUrl = new URL(request.url);
  const response = await fetch(
    `${apiUrl}/api/v1/operator/ai-assist/proposals/${proposalId}/review`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: incomingUrl.origin,
        ...(request.headers.get("cookie")
          ? { cookie: request.headers.get("cookie")! }
          : {}),
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    },
  );
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    },
  });
}
