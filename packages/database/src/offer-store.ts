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

      return publishedOfferSchema.parse({
        contractVersion: saved.contractVersion,
        id: saved.id,
        retailerProductId: saved.retailerProductId,
        sourceScopeId: saved.sourceScopeId,
        canonicalProductClassId: saved.canonicalProductClassId,
        exactName: saved.exactName,
        variantAttributes: saved.variantAttributes,
        package: saved.package,
        price: { amount: saved.priceAmount, currency: saved.currency.trim() },
        regularPrice:
          saved.regularPriceAmount === null
            ? null
            : {
                amount: saved.regularPriceAmount,
                currency: saved.currency.trim(),
              },
        discountPercent:
          saved.discountPercent === null ? null : Number(saved.discountPercent),
        comparisonUnit: saved.comparisonUnit,
        unitPrices: saved.unitPrices,
        membership: saved.membership,
        channel: saved.channel,
        locality: saved.locality,
        availability: saved.availability,
        validity: saved.validity,
        evidence: saved.evidence,
        parserVersion: saved.parserVersion,
        status: saved.status,
      });
    });
  }
}
