import swagger from "@fastify/swagger";
import {
  jsonSchemaTransform,
  serializerCompiler,
  type ZodTypeProvider,
  validatorCompiler,
} from "@fastify/type-provider-zod";
import {
  normalizationErrorSchema,
  normalizeUnitPriceRequestSchema,
  normalizeUnitPriceResponseSchema,
} from "@shopsmart/contracts";
import type { NormalizationStore } from "@shopsmart/database";
import {
  IncompatibleUnitError,
  InvalidNormalizationInputError,
  normalizeUnitPrice,
} from "@shopsmart/domain";
import Fastify from "fastify";

export async function buildApp(normalizationStore: NormalizationStore) {
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
