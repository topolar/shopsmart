"use client";

import { onboardingResponseSchema } from "@shopsmart/contracts";
import {
  useEffect,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";

import { cs } from "../messages/cs";
import { OffersDashboard } from "./offers-dashboard";

type AuthMode = "sign-up" | "sign-in";

export function AuthOnboardingForm() {
  const [mode, setMode] = useState<AuthMode>("sign-up");
  const [tenantId, setTenantId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/get-session", {
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

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    const data = new FormData(event.currentTarget);
    const payload = {
      email: data.get("email"),
      password: data.get("password"),
      ...(mode === "sign-up" ? { name: data.get("name") } : {}),
    };
    const response = await fetch(`/api/auth/${mode}/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as {
      user?: { tenantId?: string };
      message?: string;
    };
    if (!response.ok || !result.user?.tenantId) {
      setMessage(result.message ?? cs.authError);
      setPending(false);
      return;
    }
    setTenantId(result.user.tenantId);
    setPending(false);
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
        storeIds: [],
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
    setMessage(
      response.ok && parsed.success ? cs.onboardingSaved : cs.onboardingError,
    );
    setPending(false);
  }

  if (tenantId) {
    return (
      <div className="grid gap-8">
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
        <OffersDashboard tenantId={tenantId} />
      </div>
    );
  }

  return (
    <form className="grid gap-4" key="authentication" onSubmit={authenticate}>
      <div className="flex gap-2">
        {(["sign-up", "sign-in"] as const).map((candidate) => (
          <button
            className="rounded-full border border-emerald-800 px-3 py-1 text-sm"
            key={candidate}
            onClick={() => setMode(candidate)}
            type="button"
          >
            {candidate === "sign-up" ? cs.signUp : cs.signIn}
          </button>
        ))}
      </div>
      <h2 className="text-2xl font-bold">
        {mode === "sign-up" ? cs.createAccount : cs.signIn}
      </h2>
      {mode === "sign-up" ? <Field label={cs.name} name="name" /> : null}
      <Field label={cs.email} name="email" type="email" />
      <Field
        label={cs.password}
        name="password"
        type="password"
        minLength={12}
      />
      <Submit
        pending={pending}
        label={mode === "sign-up" ? cs.signUp : cs.signIn}
      />
      {message ? (
        <p className="text-red-700" role="alert">
          {message}
        </p>
      ) : null}
    </form>
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
