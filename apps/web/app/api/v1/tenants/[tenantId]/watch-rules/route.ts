import {
  createWatchRuleRequestSchema,
  userWatchRuleSchema,
  watchRuleListResponseSchema,
} from "@shopsmart/contracts";
import { NextResponse } from "next/server";

const apiUrl = process.env.SHOPSMART_API_URL ?? "http://127.0.0.1:8310";

export async function GET(request: Request) {
  return proxy(request, "GET");
}

export async function POST(request: Request) {
  const parsed = createWatchRuleRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "INVALID_WATCH_RULE",
        message: "Neplatné nastavení hlídání.",
      },
      { status: 400 },
    );
  }
  return proxy(request, "POST", parsed.data);
}

async function proxy(request: Request, method: "GET" | "POST", body?: unknown) {
  const incomingUrl = new URL(request.url);
  const response = await fetch(`${apiUrl}${incomingUrl.pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      origin: incomingUrl.origin,
      ...(request.headers.get("cookie")
        ? { cookie: request.headers.get("cookie")! }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const payload: unknown = await response.json();
  if (!response.ok)
    return NextResponse.json(payload, { status: response.status });
  return NextResponse.json(
    method === "GET"
      ? watchRuleListResponseSchema.parse(payload)
      : userWatchRuleSchema.parse(payload),
    { status: response.status },
  );
}
