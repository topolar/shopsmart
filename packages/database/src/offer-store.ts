import {
  publishedOfferSchema,
  type PublishedOffer,
} from "@shopsmart/contracts";
import type { DataSource } from "typeorm";

import { OfferRecord } from "./offer-record.js";

export interface OfferStore {
  save(offer: PublishedOffer): Promise<PublishedOffer>;
}

export class TypeOrmOfferStore implements OfferStore {
  constructor(private readonly dataSource: DataSource) {}

  async save(offer: PublishedOffer): Promise<PublishedOffer> {
    return this.dataSource.transaction(async (transactionalEntityManager) => {
      const repository = transactionalEntityManager.getRepository(OfferRecord);
      const saved = await repository.save(
        repository.create({
          id: offer.id,
          contractVersion: offer.contractVersion,
          retailerProductId: offer.retailerProductId,
          sourceScopeId: offer.sourceScopeId,
          canonicalProductClassId: offer.canonicalProductClassId,
          exactName: offer.exactName,
          variantAttributes: offer.variantAttributes,
          package: offer.package,
          priceAmount: offer.price.amount,
          currency: offer.price.currency,
          regularPriceAmount: offer.regularPrice?.amount ?? null,
          discountPercent:
            offer.discountPercent === null
              ? null
              : offer.discountPercent.toFixed(2),
          comparisonUnit: offer.comparisonUnit,
          unitPrices: offer.unitPrices,
          membership: offer.membership,
          channel: offer.channel,
          locality: offer.locality,
          availability: offer.availability,
          validity: offer.validity,
          evidence: offer.evidence,
          parserVersion: offer.parserVersion,
          status: offer.status,
        }),
      );

      return mapPublishedOfferRecord(saved);
    });
  }
}

export function mapPublishedOfferRecord(record: OfferRecord): PublishedOffer {
  return publishedOfferSchema.parse({
    contractVersion: record.contractVersion,
    id: record.id,
    retailerProductId: record.retailerProductId,
    sourceScopeId: record.sourceScopeId,
    canonicalProductClassId: record.canonicalProductClassId,
    exactName: record.exactName,
    variantAttributes: record.variantAttributes,
    package: record.package,
    price: { amount: record.priceAmount, currency: record.currency.trim() },
    regularPrice:
      record.regularPriceAmount === null
        ? null
        : {
            amount: record.regularPriceAmount,
            currency: record.currency.trim(),
          },
    discountPercent:
      record.discountPercent === null ? null : Number(record.discountPercent),
    comparisonUnit: record.comparisonUnit,
    unitPrices: record.unitPrices,
    membership: record.membership,
    channel: record.channel,
    locality: record.locality,
    availability: record.availability,
    validity: record.validity,
    evidence: record.evidence,
    parserVersion: record.parserVersion,
    status: record.status,
  });
}
