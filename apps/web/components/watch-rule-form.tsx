"use client";

import {
  createWatchRuleRequestSchema,
  userWatchRuleSchema,
  watchRuleListResponseSchema,
  watchRuleOptionsResponseSchema,
  type CreateWatchRuleRequest,
  type UserWatchRule,
  type WatchRuleOptionsResponse,
} from "@shopsmart/contracts";
import { useEffect, useState, type FormEvent } from "react";

import { cs } from "../messages/cs";

type Draft = Readonly<{
  productId: string;
  maxUnitPriceAmount: string;
  storeIds: readonly string[];
  acceptedMemberships: readonly string[];
}>;

export function WatchRuleForm({
  tenantId,
  refreshKey,
}: Readonly<{ tenantId: string; refreshKey: number }>) {
  const [options, setOptions] = useState<WatchRuleOptionsResponse>();
  const [rules, setRules] = useState<UserWatchRule[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setMessage(undefined);
    void Promise.all([
      fetch(`/api/v1/tenants/${tenantId}/watch-rules/options`, {
        cache: "no-store",
        signal: controller.signal,
      }),
      fetch(`/api/v1/tenants/${tenantId}/watch-rules`, {
        cache: "no-store",
        signal: controller.signal,
      }),
    ])
      .then(async ([optionsResponse, rulesResponse]) => {
        if (!optionsResponse.ok || !rulesResponse.ok)
          throw new Error("LOAD_FAILED");
        return {
          options: watchRuleOptionsResponseSchema.parse(
            await optionsResponse.json(),
          ),
          rules: watchRuleListResponseSchema.parse(await rulesResponse.json()),
        };
      })
      .then((loaded) => {
        setOptions(loaded.options);
        setRules(loaded.rules.items);
        setSelectedProductId((current) =>
          loaded.options.products.some(({ id }) => id === current)
            ? current
            : (loaded.options.products[0]?.id ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMessage(cs.watchRuleLoadError);
        }
      });
    return () => controller.abort();
  }, [tenantId, refreshKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options) return;
    setPending(true);
    setMessage(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const request = buildCreateWatchRuleRequest(options, {
        productId: String(data.get("productId") ?? ""),
        maxUnitPriceAmount: String(data.get("maxUnitPriceAmount") ?? ""),
        storeIds: data.getAll("storeIds").map(String),
        acceptedMemberships: data.getAll("acceptedMemberships").map(String),
      });
      const response = await fetch(`/api/v1/tenants/${tenantId}/watch-rules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error("SAVE_FAILED");
      const saved = userWatchRuleSchema.parse(payload);
      setRules((current) => [...current, saved]);
      setMessage(cs.watchRuleSaved);
    } catch {
      setMessage(cs.watchRuleSaveError);
    } finally {
      setPending(false);
    }
  }

  if (!options) return <p role="status">{message ?? cs.watchRuleLoading}</p>;
  return (
    <WatchRuleFormView
      options={options}
      rules={rules}
      selectedProductId={selectedProductId}
      pending={pending}
      message={message}
      onProductChange={setSelectedProductId}
      onSubmit={submit}
    />
  );
}

export function WatchRuleFormView({
  options,
  rules,
  selectedProductId,
  pending,
  message,
  onProductChange,
  onSubmit,
}: Readonly<{
  options: WatchRuleOptionsResponse;
  rules: readonly UserWatchRule[];
  selectedProductId: string;
  pending: boolean;
  message?: string | undefined;
  onProductChange?: ((id: string) => void) | undefined;
  onSubmit?: ((event: FormEvent<HTMLFormElement>) => void) | undefined;
}>) {
  const product = options.products.find(({ id }) => id === selectedProductId);
  const selectedStores = options.availableStores.filter(({ id }) =>
    options.selectedStoreIds.includes(id),
  );
  return (
    <section className="grid gap-4 border-t border-emerald-900/10 pt-6">
      <h2 className="text-2xl font-bold">{cs.watchRuleTitle}</h2>
      <p className="text-sm text-emerald-950/70">{cs.watchRuleBoundary}</p>
      {selectedStores.length === 0 ? (
        <p role="status">{cs.watchRuleNeedsStore}</p>
      ) : (
        <form className="grid gap-4" onSubmit={onSubmit}>
          <label className="grid gap-1">
            <span className="text-sm font-semibold">{cs.watchedProduct}</span>
            <select
              className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2"
              name="productId"
              {...(onProductChange
                ? {
                    value: selectedProductId,
                    onChange: (event) => onProductChange(event.target.value),
                  }
                : { defaultValue: selectedProductId })}
            >
              {options.products.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {localizedProductName(candidate.slug, candidate.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold">
              {cs.maxUnitPrice}{" "}
              {product ? cs.units[product.comparisonUnit] : ""}
            </span>
            <input
              className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2"
              min="0.01"
              name="maxUnitPriceAmount"
              required
              step="0.01"
              type="number"
            />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">
              {cs.reachableStores}
            </legend>
            {selectedStores.map((store) => (
              <label className="flex gap-2" key={store.id}>
                <input
                  defaultChecked
                  name="storeIds"
                  type="checkbox"
                  value={store.id}
                />
                <span>
                  {localizedStoreName(store.name)} ({store.city})
                </span>
              </label>
            ))}
          </fieldset>
          {options.acceptedMemberships.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold">
                {cs.membershipProgram}
              </legend>
              {options.acceptedMemberships.map((membership) => (
                <label className="flex gap-2" key={membership}>
                  <input
                    name="acceptedMemberships"
                    type="checkbox"
                    value={membership}
                  />
                  <span>{membership.replace(/^(?:loyalty|app):/, "")}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <button
            className="rounded-lg bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-60"
            disabled={pending || !product}
            type="submit"
          >
            {pending ? cs.pending : cs.saveWatchRule}
          </button>
        </form>
      )}
      {message ? <p role="status">{message}</p> : null}
      {rules.length > 0 ? (
        <p>
          {cs.savedWatchRules}: {rules.length}
        </p>
      ) : null}
    </section>
  );
}

function localizedProductName(slug: string, fallback: string): string {
  return (
    (cs.productNames as Readonly<Record<string, string>>)[slug] ?? fallback
  );
}

function localizedStoreName(name: string): string {
  return (cs.storeNames as Readonly<Record<string, string>>)[name] ?? name;
}

export function buildCreateWatchRuleRequest(
  options: WatchRuleOptionsResponse,
  draft: Draft,
): CreateWatchRuleRequest {
  const product = options.products.find(({ id }) => id === draft.productId);
  if (!product) throw new Error("UNKNOWN_PRODUCT");
  return createWatchRuleRequestSchema.parse({
    canonicalProductClassId: product.id,
    maxUnitPrice: {
      amount: draft.maxUnitPriceAmount,
      currency: "CZK",
      unit: product.comparisonUnit,
    },
    acceptedMemberships: draft.acceptedMemberships,
    channel: "physical",
    storeIds: draft.storeIds,
  });
}
