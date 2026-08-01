import { aiAssistReviewQueueResponseSchema } from "@shopsmart/contracts";
import { NextResponse } from "next/server";

const apiUrl = process.env.SHOPSMART_API_URL ?? "http://127.0.0.1:8310";

export async function GET(request: Request) {
  const incomingUrl = new URL(request.url);
  const response = await fetch(`${apiUrl}${incomingUrl.pathname}`, {
    headers: {
      origin: incomingUrl.origin,
      ...(request.headers.get("cookie")
        ? { cookie: request.headers.get("cookie")! }
        : {}),
    },
    cache: "no-store",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    return NextResponse.json(payload, { status: response.status });
  }
  return NextResponse.json(aiAssistReviewQueueResponseSchema.parse(payload));
}
