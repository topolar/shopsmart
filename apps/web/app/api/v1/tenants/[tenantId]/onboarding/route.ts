import { onboardingRequestSchema } from "@shopsmart/contracts";
import { NextResponse } from "next/server";

const apiUrl = process.env.SHOPSMART_API_URL ?? "http://127.0.0.1:8310";

export async function PUT(request: Request) {
  const parsed = onboardingRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_ONBOARDING", message: "Neplatné nastavení profilu." },
      { status: 400 },
    );
  }

  const incomingUrl = new URL(request.url);
  const response = await fetch(`${apiUrl}${incomingUrl.pathname}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: incomingUrl.origin,
      ...(request.headers.get("cookie")
        ? { cookie: request.headers.get("cookie")! }
        : {}),
    },
    body: JSON.stringify(parsed.data),
    cache: "no-store",
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    },
  });
}
