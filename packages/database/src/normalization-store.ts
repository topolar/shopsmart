import type {
  NormalizeUnitPriceRequest,
  NormalizeUnitPriceResponse,
} from "@shopsmart/contracts";
import type { NormalizedUnitPrice } from "@shopsmart/domain";
import type { DataSource } from "typeorm";

import { NormalizationRecord } from "./normalization-record.js";

export interface NormalizationStore {
  save(
    request: NormalizeUnitPriceRequest,
    normalized: NormalizedUnitPrice,
  ): Promise<NormalizeUnitPriceResponse>;
}

export class TypeOrmNormalizationStore implements NormalizationStore {
  constructor(private readonly dataSource: DataSource) {}

  async save(
    request: NormalizeUnitPriceRequest,
    normalized: NormalizedUnitPrice,
  ): Promise<NormalizeUnitPriceResponse> {
    return this.dataSource.transaction(async (transactionalEntityManager) => {
      const repository =
        transactionalEntityManager.getRepository(NormalizationRecord);
      const record = repository.create({
        packagePrice: request.packagePrice,
        currency: request.currency,
        packageQuantityAmount: request.packageQuantity.amount,
        packageQuantityUnit: request.packageQuantity.unit,
        comparisonUnit: request.comparisonUnit,
        normalizedAmount: normalized.amount,
      });
      const saved = await repository.save(record);

      return {
        id: saved.id,
        normalizedUnitPrice: {
          amount: saved.normalizedAmount,
          currency: saved.currency,
          unit: request.comparisonUnit,
        },
        createdAt: saved.createdAt.toISOString(),
      };
    });
  }
}
