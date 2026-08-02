"use client";

import {
  onboardingResponseSchema,
  watchRuleOptionsResponseSchema,
  type WatchRuleOptionsResponse,
} from "@shopsmart/contracts";
import {
  useEffect,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";

import { createGoogleSession } from "../lib/firebase-auth";
import { cs } from "../messages/cs";
import { OffersDashboard } from "./offers-dashboard";
import { WatchRuleForm } from "./watch-rule-form";

export function AuthOnboardingForm() {
  const [tenantId, setTenantId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [watchOptions, setWatchOptions] = useState<WatchRuleOptionsResponse>();
  const [preferencesRevision, setPreferencesRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return undefined;
        return (await response.json()) as {
          user?: { tenantId?: string };
        };
      })
      .then((session) => {
        if (session?.user?.tenantId) setTenantId(session.user.tenantId);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController();
    void fetch(`/api/v1/tenants/${tenantId}/watch-rules/options`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return undefined;
        return watchRuleOptionsResponseSchema.parse(await response.json());
      })
      .then(setWatchOptions)
      .catch(() => undefined);
    return () => controller.abort();
  }, [tenantId, preferencesRevision]);

  async function authenticate() {
    setPending(true);
    setMessage(undefined);
    try {
      const result = await createGoogleSession();
      setTenantId(result.user.tenantId);
    } catch {
      setMessage(cs.authError);
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      setTenantId(undefined);
      setWatchOptions(undefined);
    } finally {
      setPending(false);
    }
  }

  async function saveOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;
    setPending(true);
    setMessage(undefined);
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/v1/tenants/${tenantId}/onboarding`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        locale: "cs",
        locality: {
          city: data.get("city"),
          region: data.get("region"),
          postalCodePrefix: data.get("postalCodePrefix") || null,
        },
        storeIds: data.getAll("storeIds").map(String),
        onlineChannelKeys: data.get("onlineEnabled") ? ["public-web"] : [],
        loyaltyPrograms: data.get("loyaltyProgram")
          ? [data.get("loyaltyProgram")]
          : [],
        notification: {
          emailDigestEnabled: Boolean(data.get("emailDigestEnabled")),
          timezone: "Europe/Prague",
        },
      }),
    });
    const payload: unknown = await response.json();
    const parsed = onboardingResponseSchema.safeParse(payload);
    const saved = response.ok && parsed.success;
    setMessage(saved ? cs.onboardingSaved : cs.onboardingError);
    if (saved) setPreferencesRevision((current) => current + 1);
    setPending(false);
  }

  if (tenantId) {
    return (
      <div className="grid gap-8">
        <div className="flex justify-end">
          <button
            className="rounded-full border border-emerald-800 px-3 py-1 text-sm"
            disabled={pending}
            onClick={() => void signOut()}
            type="button"
          >
            {cs.signOut}
          </button>
        </div>
        <form className="grid gap-4" key="onboarding" onSubmit={saveOnboarding}>
          <h2 className="text-2xl font-bold">{cs.onboardingTitle}</h2>
          <p className="text-sm text-emerald-950/70">{cs.localityPrivacy}</p>
          <Field label={cs.city} name="city" defaultValue="Praha" />
          <Field
            label={cs.region}
            name="region"
            defaultValue="Hlavní město Praha"
          />
          <Field
            label={cs.postalCodePrefix}
            name="postalCodePrefix"
            defaultValue="110"
            pattern="[0-9]{3}"
          />
          {watchOptions && watchOptions.availableStores.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold">
                {cs.reachableStores}
              </legend>
              {watchOptions.availableStores.map((store) => (
                <label className="flex gap-2" key={store.id}>
                  <input
                    defaultChecked={watchOptions.selectedStoreIds.includes(
                      store.id,
                    )}
                    name="storeIds"
                    type="checkbox"
                    value={store.id}
                  />
                  <span>
                    {(cs.storeNames as Readonly<Record<string, string>>)[
                      store.name
                    ] ?? store.name}{" "}
                    ({store.city})
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <label className="flex items-start gap-3">
            <input
              className="mt-1"
              name="onlineEnabled"
              type="checkbox"
              defaultChecked
            />
            <span>{cs.onlineChannel}</span>
          </label>
          <Field
            label={cs.loyaltyProgram}
            name="loyaltyProgram"
            placeholder="např. clubcard"
            pattern="[a-z0-9]+(?:[-:][a-z0-9]+)*"
          />
          <label className="flex items-start gap-3">
            <input
              className="mt-1"
              name="emailDigestEnabled"
              type="checkbox"
              defaultChecked
            />
            <span>{cs.emailDigest}</span>
          </label>
          <Submit pending={pending} label={cs.finishOnboarding} />
          {message ? <p role="status">{message}</p> : null}
        </form>
        <WatchRuleForm tenantId={tenantId} refreshKey={preferencesRevision} />
        <OffersDashboard tenantId={tenantId} />
      </div>
    );
  }

  return (
    <div className="grid gap-4" key="authentication">
      <h2 className="text-2xl font-bold">{cs.signIn}</h2>
      <p className="text-sm text-emerald-950/70">{cs.googleSignInOnly}</p>
      <button
        className="rounded-lg bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-60"
        disabled={pending}
        onClick={() => void authenticate()}
        type="button"
      >
        {pending ? cs.pending : cs.signInWithGoogle}
      </button>
      {message ? (
        <p className="text-red-700" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  ...input
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-semibold">{label}</span>
      <input
        className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2"
        required={input.name !== "loyaltyProgram"}
        {...input}
      />
    </label>
  );
}

function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      className="rounded-lg bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? cs.pending : label}
    </button>
  );
}
