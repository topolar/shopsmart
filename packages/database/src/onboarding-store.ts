import {
  onboardingRequestSchema,
  onboardingResponseSchema,
  type OnboardingRequest,
  type OnboardingResponse,
} from "@shopsmart/contracts";
import { EntitySchema, In, type DataSource } from "typeorm";

export class StoreRecord {
  id!: string;
  retailerId!: string;
  officialName!: string;
  city!: string;
  sourceUrl!: string;
  createdAt!: Date;
}

export class OnboardingProfileRecord {
  tenantId!: string;
  userId!: string;
  locale!: "cs";
  locality!: OnboardingRequest["locality"];
  onlineChannelKeys!: string[];
  completedAt!: Date;
  updatedAt!: Date;
}

export class UserStoreAccessRecord {
  id!: string;
  tenantId!: string;
  storeId!: string;
  createdAt!: Date;
}

export class LoyaltyMembershipRecord {
  id!: string;
  tenantId!: string;
  programKey!: string;
  createdAt!: Date;
}

export class NotificationPreferenceRecord {
  tenantId!: string;
  emailDigestEnabled!: boolean;
  locale!: "cs";
  timezone!: "Europe/Prague";
  updatedAt!: Date;
}

export const storeRecordSchema = new EntitySchema<StoreRecord>({
  name: "StoreRecord",
  tableName: "stores",
  target: StoreRecord,
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid" },
    retailerId: { name: "retailer_id", type: "uuid" },
    officialName: { name: "official_name", type: "varchar", length: 240 },
    city: { type: "varchar", length: 120 },
    sourceUrl: { name: "source_url", type: "varchar", length: 1_000 },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
});

export const onboardingProfileRecordSchema =
  new EntitySchema<OnboardingProfileRecord>({
    name: "OnboardingProfileRecord",
    tableName: "user_profiles",
    target: OnboardingProfileRecord,
    columns: {
      tenantId: { name: "tenant_id", type: "uuid", primary: true },
      userId: { name: "user_id", type: "text", unique: true },
      locale: { type: "varchar", length: 12 },
      locality: { type: "jsonb" },
      onlineChannelKeys: {
        name: "online_channel_keys",
        type: "varchar",
        array: true,
        default: "{}",
      },
      completedAt: { name: "completed_at", type: "timestamptz" },
      updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
    },
  });

export const userStoreAccessRecordSchema =
  new EntitySchema<UserStoreAccessRecord>({
    name: "UserStoreAccessRecord",
    tableName: "user_store_access",
    target: UserStoreAccessRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      tenantId: { name: "tenant_id", type: "uuid" },
      storeId: { name: "store_id", type: "uuid" },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    },
    uniques: [
      {
        name: "uq_user_store_access_tenant_store",
        columns: ["tenantId", "storeId"],
      },
    ],
  });

export const loyaltyMembershipRecordSchema =
  new EntitySchema<LoyaltyMembershipRecord>({
    name: "LoyaltyMembershipRecord",
    tableName: "loyalty_memberships",
    target: LoyaltyMembershipRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      tenantId: { name: "tenant_id", type: "uuid" },
      programKey: { name: "program_key", type: "varchar", length: 120 },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    },
    uniques: [
      {
        name: "uq_loyalty_memberships_tenant_program",
        columns: ["tenantId", "programKey"],
      },
    ],
  });

export const notificationPreferenceRecordSchema =
  new EntitySchema<NotificationPreferenceRecord>({
    name: "NotificationPreferenceRecord",
    tableName: "notification_preferences",
    target: NotificationPreferenceRecord,
    columns: {
      tenantId: { name: "tenant_id", type: "uuid", primary: true },
      emailDigestEnabled: {
        name: "email_digest_enabled",
        type: "boolean",
      },
      locale: { type: "varchar", length: 12 },
      timezone: { type: "varchar", length: 80 },
      updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
    },
  });

export class UnknownStoreSelectionError extends Error {
  readonly code = "UNKNOWN_STORE_SELECTION";

  constructor() {
    super("One or more selected stores do not exist.");
    this.name = "UnknownStoreSelectionError";
  }
}

export class TypeOrmOnboardingStore {
  constructor(private readonly dataSource: DataSource) {}

  async save(
    userId: string,
    tenantId: string,
    input: unknown,
  ): Promise<OnboardingResponse> {
    const onboarding = onboardingRequestSchema.parse(input);

    return this.dataSource.transaction(async (manager) => {
      if (onboarding.storeIds.length > 0) {
        const count = await manager
          .getRepository(StoreRecord)
          .countBy({ id: In(onboarding.storeIds) });
        if (count !== new Set(onboarding.storeIds).size) {
          throw new UnknownStoreSelectionError();
        }
      }

      await manager.getRepository(OnboardingProfileRecord).save({
        tenantId,
        userId,
        locale: onboarding.locale,
        locality: onboarding.locality,
        onlineChannelKeys: [...new Set(onboarding.onlineChannelKeys)],
        completedAt: new Date(),
      });
      await replaceSelections(
        manager.getRepository(UserStoreAccessRecord),
        tenantId,
        [...new Set(onboarding.storeIds)].map((storeId) => ({ storeId })),
      );
      await replaceSelections(
        manager.getRepository(LoyaltyMembershipRecord),
        tenantId,
        [...new Set(onboarding.loyaltyPrograms)].map((programKey) => ({
          programKey,
        })),
      );
      await manager.getRepository(NotificationPreferenceRecord).save({
        tenantId,
        emailDigestEnabled: onboarding.notification.emailDigestEnabled,
        locale: onboarding.locale,
        timezone: onboarding.notification.timezone,
      });

      return onboardingResponseSchema.parse({
        ...onboarding,
        storeIds: [...new Set(onboarding.storeIds)],
        onlineChannelKeys: [...new Set(onboarding.onlineChannelKeys)],
        loyaltyPrograms: [...new Set(onboarding.loyaltyPrograms)],
        tenantId,
        completed: true,
      });
    });
  }
}

async function replaceSelections<T extends { tenantId: string }>(
  repository: {
    delete(criteria: { tenantId: string }): Promise<unknown>;
    save(records: T[]): Promise<unknown>;
  },
  tenantId: string,
  selections: Omit<T, "tenantId">[],
) {
  await repository.delete({ tenantId });
  if (selections.length > 0) {
    await repository.save(
      selections.map((selection) => ({ ...selection, tenantId }) as T),
    );
  }
}
