import {
  normalizationErrorSchema,
  normalizeUnitPriceRequestSchema,
  normalizeUnitPriceResponseSchema,
} from "@shopsmart/contracts";
import { NextResponse } from "next/server";

const apiUrl = process.env.SHOPSMART_API_URL ?? "http://127.0.0.1:8310";

export async function POST(request: Request) {
  const parsedRequest = normalizeUnitPriceRequestSchema.safeParse(
    await request.json(),
  );
  if (!parsedRequest.success) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "Invalid normalization request." },
      { status: 400 },
    );
  }

  const response = await fetch(`${apiUrl}/api/v1/normalizations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsedRequest.data),
    cache: "no-store",
  });
  const payload: unknown = await response.json();

  if (response.status === 422) {
    const error = normalizationErrorSchema.parse(payload);
    return NextResponse.json(error, { status: 422 });
  }

  const normalized = normalizeUnitPriceResponseSchema.parse(payload);
  return NextResponse.json(normalized, { status: response.status });
}
