import swagger from "@fastify/swagger";
import {
  jsonSchemaTransform,
  serializerCompiler,
  type ZodTypeProvider,
  validatorCompiler,
} from "@fastify/type-provider-zod";
import {
  offersDashboardResponseSchema,
  onboardingRequestSchema,
  onboardingResponseSchema,
  normalizationErrorSchema,
  normalizeUnitPriceRequestSchema,
  normalizeUnitPriceResponseSchema,
  aiAssistReviewQueueResponseSchema,
  aiAssistReviewRequestSchema,
  aiAssistReviewResponseSchema,
  aiAssistReviewErrorSchema,
  operatorAuthorizationErrorSchema,
  tenantAuthorizationErrorSchema,
  createWatchRuleRequestSchema,
  userWatchRuleSchema,
  watchRuleListResponseSchema,
  watchRuleSelectionErrorSchema,
  watchRuleOptionsResponseSchema,
} from "@shopsmart/contracts";
import type {
  NormalizationStore,
  OffersDashboardStore,
  TypeOrmOnboardingStore,
  TypeOrmAiAssistStore,
  WatchRuleApplicationStore,
} from "@shopsmart/database";
import { WatchRuleSelectionError } from "@shopsmart/database";
import {
  IncompatibleUnitError,
  InvalidNormalizationInputError,
  normalizeUnitPrice,
} from "@shopsmart/domain";
import Fastify from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod/v4";

import type { ShopSmartAuth } from "./auth.js";

type AppDependencies = Readonly<{
  auth: ShopSmartAuth;
  onboardingStore: TypeOrmOnboardingStore;
  dashboardStore?: OffersDashboardStore;
  aiAssistStore?: TypeOrmAiAssistStore;
  watchRuleStore?: WatchRuleApplicationStore;
}>;

export async function buildApp(
  normalizationStore: NormalizationStore,
  dependencies?: AppDependencies,
) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      info: {
        title: "ShopSmart API",
        version: "0.1.0",
      },
    },
    transform: jsonSchemaTransform,
  });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get("/health", async () => ({ status: "ok" }));

  if (dependencies) {
    typedApp.route({
      method: ["GET", "POST"],
      url: "/api/auth/*",
      async handler(request, reply) {
        const origin = request.headers.origin ?? "http://127.0.0.1";
        const authRequest = new Request(new URL(request.url, origin), {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(!["GET", "HEAD"].includes(request.method) && request.body
            ? { body: JSON.stringify(request.body) }
            : {}),
        });
        const response = await dependencies.auth.handler(authRequest);

        response.headers.forEach((value, name) => {
          if (name !== "set-cookie") reply.header(name, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) reply.header("set-cookie", cookies);
        const body = await response.text();
        reply.code(response.status);
        return response.headers
          .get("content-type")
          ?.includes("application/json")
          ? JSON.parse(body)
          : body;
      },
    });

    typedApp.put(
      "/api/v1/tenants/:tenantId/onboarding",
      {
        schema: {
          params: z.object({ tenantId: z.uuid() }),
          body: onboardingRequestSchema,
          response: {
            200: onboardingResponseSchema,
            401: tenantAuthorizationErrorSchema,
            403: tenantAuthorizationErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const session = await dependencies.auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.code(401).send({
            code: "UNAUTHENTICATED",
            message: "A valid session is required.",
          });
        }
        if (session.user.tenantId !== request.params.tenantId) {
          return reply.code(403).send({
            code: "TENANT_SCOPE_VIOLATION",
            message: "The requested tenant is outside the active session.",
          });
        }

        const saved = await dependencies.onboardingStore.save(
          session.user.id,
          session.user.tenantId,
          request.body,
        );
        return reply.code(200).send(saved);
      },
    );

    const watchRuleStore = dependencies.watchRuleStore;
    if (watchRuleStore) {
      typedApp.get(
        "/api/v1/tenants/:tenantId/watch-rules/options",
        {
          schema: {
            params: z.object({ tenantId: z.uuid() }),
            response: {
              200: watchRuleOptionsResponseSchema,
              401: tenantAuthorizationErrorSchema,
              403: tenantAuthorizationErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const session = await dependencies.auth.api.getSession({
            headers: fromNodeHeaders(request.headers),
          });
          if (!session) {
            return reply.code(401).send({
              code: "UNAUTHENTICATED",
              message: "A valid session is required.",
            });
          }
          if (session.user.tenantId !== request.params.tenantId) {
            return reply.code(403).send({
              code: "TENANT_SCOPE_VIOLATION",
              message: "The requested tenant is outside the active session.",
            });
          }
          return reply
            .code(200)
            .send(await watchRuleStore.options(session.user.tenantId));
        },
      );

      typedApp.post(
        "/api/v1/tenants/:tenantId/watch-rules",
        {
          schema: {
            params: z.object({ tenantId: z.uuid() }),
            body: createWatchRuleRequestSchema,
            response: {
              201: userWatchRuleSchema,
              401: tenantAuthorizationErrorSchema,
              403: tenantAuthorizationErrorSchema,
              422: watchRuleSelectionErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const session = await dependencies.auth.api.getSession({
            headers: fromNodeHeaders(request.headers),
          });
          if (!session) {
            return reply.code(401).send({
              code: "UNAUTHENTICATED",
              message: "A valid session is required.",
            });
          }
          if (session.user.tenantId !== request.params.tenantId) {
            return reply.code(403).send({
              code: "TENANT_SCOPE_VIOLATION",
              message: "The requested tenant is outside the active session.",
            });
          }
          try {
            return reply
              .code(201)
              .send(
                await watchRuleStore.create(
                  session.user.tenantId,
                  request.body,
                ),
              );
          } catch (error) {
            if (error instanceof WatchRuleSelectionError) {
              return reply.code(422).send({
                code: "WATCH_RULE_SELECTION_INVALID",
                message: error.message,
              });
            }
            throw error;
          }
        },
      );

      typedApp.get(
        "/api/v1/tenants/:tenantId/watch-rules",
        {
          schema: {
            params: z.object({ tenantId: z.uuid() }),
            response: {
              200: watchRuleListResponseSchema,
              401: tenantAuthorizationErrorSchema,
              403: tenantAuthorizationErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const session = await dependencies.auth.api.getSession({
            headers: fromNodeHeaders(request.headers),
          });
          if (!session) {
            return reply.code(401).send({
              code: "UNAUTHENTICATED",
              message: "A valid session is required.",
            });
          }
          if (session.user.tenantId !== request.params.tenantId) {
            return reply.code(403).send({
              code: "TENANT_SCOPE_VIOLATION",
              message: "The requested tenant is outside the active session.",
            });
          }
          return reply.code(200).send({
            items: await watchRuleStore.list(session.user.tenantId),
          });
        },
      );
    }

    const dashboardStore = dependencies.dashboardStore;
    if (dashboardStore) {
      typedApp.get(
        "/api/v1/tenants/:tenantId/offers",
        {
          schema: {
            params: z.object({ tenantId: z.uuid() }),
            response: {
              200: offersDashboardResponseSchema,
              401: tenantAuthorizationErrorSchema,
              403: tenantAuthorizationErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const session = await dependencies.auth.api.getSession({
            headers: fromNodeHeaders(request.headers),
          });
          if (!session) {
            return reply.code(401).send({
              code: "UNAUTHENTICATED",
              message: "A valid session is required.",
            });
          }
          if (session.user.tenantId !== request.params.tenantId) {
            return reply.code(403).send({
              code: "TENANT_SCOPE_VIOLATION",
              message: "The requested tenant is outside the active session.",
            });
          }
          return reply
            .code(200)
            .send(await dashboardStore.list(session.user.tenantId));
        },
      );
    }

    const aiAssistStore = dependencies.aiAssistStore;
    if (aiAssistStore) {
      typedApp.get(
        "/api/v1/operator/ai-assist/proposals",
        {
          schema: {
            response: {
              200: aiAssistReviewQueueResponseSchema,
              401: operatorAuthorizationErrorSchema,
              403: operatorAuthorizationErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const session = await dependencies.auth.api.getSession({
            headers: fromNodeHeaders(request.headers),
          });
          if (!session) {
            return reply.code(401).send({
              code: "UNAUTHENTICATED",
              message: "A valid session is required.",
            });
          }
          if (session.user.role !== "operator") {
            return reply.code(403).send({
              code: "OPERATOR_REQUIRED",
              message: "An operator session is required.",
            });
          }
          return reply.code(200).send({
            items: await aiAssistStore.listReviewQueue(),
          });
        },
      );

      typedApp.post(
        "/api/v1/operator/ai-assist/proposals/:proposalId/review",
        {
          schema: {
            params: z.object({ proposalId: z.uuid() }),
            body: aiAssistReviewRequestSchema,
            response: {
              200: aiAssistReviewResponseSchema,
              401: operatorAuthorizationErrorSchema,
              403: operatorAuthorizationErrorSchema,
              409: aiAssistReviewErrorSchema,
            },
          },
        },
        async (request, reply) => {
          const session = await dependencies.auth.api.getSession({
            headers: fromNodeHeaders(request.headers),
          });
          if (!session) {
            return reply.code(401).send({
              code: "UNAUTHENTICATED",
              message: "A valid session is required.",
            });
          }
          if (session.user.role !== "operator") {
            return reply.code(403).send({
              code: "OPERATOR_REQUIRED",
              message: "An operator session is required.",
            });
          }
          const reviewedAt = new Date().toISOString();
          try {
            await aiAssistStore.review({
              proposalId: request.params.proposalId,
              decision: request.body.decision,
              reason: request.body.reason,
              reviewerUserId: session.user.id,
              reviewedAt,
            });
          } catch (error) {
            const code = aiReviewConflictCode(error);
            if (code) {
              return reply.code(409).send({
                code,
                message: "The proposal can no longer accept this decision.",
              });
            }
            throw error;
          }
          return reply.code(200).send({
            proposalId: request.params.proposalId,
            reviewStatus: request.body.decision,
            reviewedAt,
          });
        },
      );
    }
  }

  typedApp.post(
    "/api/v1/normalizations",
    {
      schema: {
        body: normalizeUnitPriceRequestSchema,
        response: {
          201: normalizeUnitPriceResponseSchema,
          422: normalizationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const normalized = normalizeUnitPrice(request.body);
        const saved = await normalizationStore.save(request.body, normalized);
        return reply.code(201).send(saved);
      } catch (error) {
        if (
          error instanceof IncompatibleUnitError ||
          error instanceof InvalidNormalizationInputError
        ) {
          return reply.code(422).send({
            code: error.code,
            message: error.message,
          });
        }

        throw error;
      }
    },
  );

  typedApp.get("/api/v1/openapi.json", async () => app.swagger());

  return app;
}

const aiReviewConflictCodes = [
  "AI_PROPOSAL_ALREADY_REVIEWED",
  "QUARANTINED_PROPOSAL_CANNOT_BE_APPROVED",
  "AI_TASK_ALREADY_APPROVED",
  "MAPPING_ALREADY_REVIEWED",
  "STALE_MAPPING_PROPOSAL",
  "MAPPING_ATTRIBUTE_MISMATCH",
] as const;

function aiReviewConflictCode(error: unknown) {
  if (!(error instanceof Error)) return null;
  return aiReviewConflictCodes.find((code) => code === error.message) ?? null;
}
