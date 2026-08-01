"use client";

import {
  aiAssistReviewQueueResponseSchema,
  type AiAssistReviewQueueResponse,
} from "@shopsmart/contracts";
import { useEffect, useState, type FormEvent } from "react";

import { cs } from "../messages/cs";

type ReviewDecision = "approved" | "rejected";

export function AiAssistReviewQueue() {
  const [queue, setQueue] = useState<AiAssistReviewQueueResponse>();
  const [error, setError] = useState<string>();
  const [pendingId, setPendingId] = useState<string>();

  async function load(signal?: AbortSignal) {
    const response = await fetch("/api/v1/operator/ai-assist/proposals", {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error("AI_REVIEW_QUEUE_FAILED");
    setQueue(aiAssistReviewQueueResponseSchema.parse(await response.json()));
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((reason: unknown) => {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(cs.aiReviewLoadError);
      }
    });
    return () => controller.abort();
  }, []);

  async function review(
    proposalId: string,
    decision: ReviewDecision,
    reason: string,
  ) {
    setPendingId(proposalId);
    setError(undefined);
    const response = await fetch(
      `/api/v1/operator/ai-assist/proposals/${proposalId}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      },
    );
    if (!response.ok) {
      setError(cs.aiReviewSaveError);
      setPendingId(undefined);
      return;
    }
    await load();
    setPendingId(undefined);
  }

  if (error && !queue) return <p role="alert">{error}</p>;
  if (!queue) return <p role="status">{cs.aiReviewLoading}</p>;
  return (
    <>
      <AiAssistReviewQueueView
        queue={queue}
        pendingId={pendingId}
        onReview={review}
      />
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

export function AiAssistReviewQueueView({
  queue,
  pendingId,
  onReview,
}: {
  queue: AiAssistReviewQueueResponse;
  pendingId?: string | undefined;
  onReview?: (
    proposalId: string,
    decision: ReviewDecision,
    reason: string,
  ) => Promise<void> | void;
}) {
  return (
    <section aria-labelledby="ai-review-heading" className="grid gap-5">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold" id="ai-review-heading">
          {cs.aiReviewTitle}
        </h1>
        <p className="max-w-3xl text-emerald-950/70">{cs.aiReviewBoundary}</p>
      </header>
      {queue.items.length === 0 ? <p>{cs.aiReviewEmpty}</p> : null}
      {queue.items.map((proposal) => (
        <article
          className="grid gap-4 rounded-2xl border border-emerald-900/10 bg-white p-5 shadow-sm"
          key={proposal.id}
        >
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">{proposal.taskKey}</h2>
              <p className="text-sm text-emerald-950/65">
                {proposal.payload.kind} · {proposal.promptVersion}
              </p>
            </div>
            <p className="font-semibold">
              {new Intl.NumberFormat("cs-CZ", { style: "percent" }).format(
                proposal.confidence,
              )}
            </p>
          </div>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            <Fact
              label={cs.aiModel}
              value={`${proposal.model.provider} / ${proposal.model.name} / ${proposal.model.version}`}
            />
            <Fact
              label={cs.aiSourceSnapshot}
              value={proposal.sourceSnapshotId}
            />
            <Fact
              label={cs.aiUsage}
              value={`${proposal.usage.inputTokens} + ${proposal.usage.outputTokens} tokenů · ${new Intl.NumberFormat("cs-CZ").format(proposal.usage.costMicros)} μKč`}
            />
            <Fact
              label={cs.aiEvidenceSpans}
              value={proposal.evidenceSpans
                .map(({ field, start, end }) => `${field}: ${start}–${end}`)
                .join(", ")}
            />
            <Fact
              label={cs.aiValidation}
              value={
                proposal.reasonCodes.length > 0
                  ? proposal.reasonCodes.join(", ")
                  : proposal.validationStatus
              }
            />
          </dl>
          <pre className="overflow-auto rounded-lg bg-emerald-950/5 p-3 text-xs">
            {JSON.stringify(proposal.payload, null, 2)}
          </pre>
          <form
            className="grid gap-3"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const decision = form.get("decision");
              const reason = form.get("reason");
              if (
                (decision === "approved" || decision === "rejected") &&
                typeof reason === "string"
              ) {
                void onReview?.(proposal.id, decision, reason);
              }
            }}
          >
            <label className="grid gap-1">
              <span className="text-sm font-semibold">{cs.aiReviewReason}</span>
              <textarea
                className="min-h-20 rounded-lg border border-emerald-900/20 p-3"
                maxLength={1_000}
                name="reason"
                required
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-40"
                disabled={
                  pendingId === proposal.id ||
                  proposal.validationStatus === "quarantined"
                }
                name="decision"
                type="submit"
                value="approved"
              >
                {cs.aiApprove}
              </button>
              <button
                className="rounded-lg border border-red-800 px-4 py-2 font-semibold text-red-800 disabled:opacity-40"
                disabled={pendingId === proposal.id}
                name="decision"
                type="submit"
                value="rejected"
              >
                {cs.aiReject}
              </button>
            </div>
          </form>
        </article>
      ))}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-semibold">{label}</dt>
      <dd className="break-all">{value}</dd>
    </>
  );
}
