"use client";

import { normalizeUnitPriceResponseSchema } from "@shopsmart/contracts";
import { useState, type FormEvent } from "react";

import { cs } from "../messages/cs";

export function NormalizationForm() {
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setResult(undefined);

    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/normalizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packagePrice: data.get("packagePrice"),
        currency: "CZK",
        packageQuantity: {
          amount: data.get("packageAmount"),
          unit: data.get("packageUnit"),
        },
        comparisonUnit: data.get("comparisonUnit"),
      }),
    });

    const payload: unknown = await response.json();
    if (!response.ok) {
      setError(cs.error);
      setPending(false);
      return;
    }

    const parsed = normalizeUnitPriceResponseSchema.safeParse(payload);
    if (!parsed.success) {
      setError(cs.error);
      setPending(false);
      return;
    }

    setResult(
      `${parsed.data.normalizedUnitPrice.amount} Kč / ${parsed.data.normalizedUnitPrice.unit}`,
    );
    setPending(false);
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <label className="grid gap-1">
        <span className="text-sm font-semibold">{cs.packagePrice}</span>
        <input
          className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2"
          name="packagePrice"
          defaultValue="49.90"
          inputMode="decimal"
          required
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-semibold">{cs.packageAmount}</span>
        <input
          className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2"
          name="packageAmount"
          defaultValue="250"
          inputMode="decimal"
          required
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-semibold">{cs.packageUnit}</span>
        <select
          className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2"
          name="packageUnit"
          defaultValue="gram"
        >
          <option value="gram">gram</option>
          <option value="kilogram">kilogram</option>
          <option value="piece">kus</option>
          <option value="roll">role</option>
          <option value="metre">metr</option>
          <option value="millilitre">mililitr</option>
          <option value="litre">litr</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-semibold">{cs.comparisonUnit}</span>
        <select
          className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2"
          name="comparisonUnit"
          defaultValue="100-gram"
        >
          <option value="100-gram">100 g</option>
          <option value="250-gram">250 g</option>
          <option value="kilogram">kilogram</option>
          <option value="piece">kus</option>
          <option value="roll">role</option>
          <option value="metre">metr</option>
          <option value="litre">litr</option>
        </select>
      </label>
      <button
        className="rounded-lg bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? cs.pending : cs.submit}
      </button>
      {result ? (
        <output className="rounded-lg bg-emerald-100 p-4 font-semibold">
          {cs.result}: {result}
        </output>
      ) : null}
      {error ? <p className="text-red-700">{error}</p> : null}
    </form>
  );
}
