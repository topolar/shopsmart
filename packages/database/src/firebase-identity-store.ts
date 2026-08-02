import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

export type VerifiedFirebaseIdentity = Readonly<{
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}>;

export type AuthenticatedLocalUser = Readonly<{
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  tenantId: string;
  role: "user" | "operator";
}>;

export class TypeOrmFirebaseIdentityStore {
  constructor(private readonly dataSource: DataSource) {}

  async provision(
    identity: VerifiedFirebaseIdentity,
  ): Promise<AuthenticatedLocalUser> {
    if (!identity.emailVerified) {
      throw new Error("FIREBASE_EMAIL_NOT_VERIFIED");
    }

    return this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `firebase:${identity.uid}:${identity.email.toLowerCase()}`,
      ]);

      const byUid = await findUser(manager, "firebaseUid", identity.uid);
      if (byUid) {
        await manager.query(
          `UPDATE "user"
           SET "name" = $2, "email" = $3, "emailVerified" = true,
               "image" = $4, "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1`,
          [
            byUid.id,
            displayName(identity),
            identity.email.toLowerCase(),
            identity.picture ?? null,
          ],
        );
        return (await findUser(manager, "firebaseUid", identity.uid))!;
      }

      const byEmail = await findUser(
        manager,
        "email",
        identity.email.toLowerCase(),
      );
      if (byEmail) {
        await manager.query(
          `UPDATE "user"
           SET "firebaseUid" = $2, "name" = $3, "emailVerified" = true,
               "image" = $4, "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1 AND "firebaseUid" IS NULL`,
          [
            byEmail.id,
            identity.uid,
            displayName(identity),
            identity.picture ?? null,
          ],
        );
        const linked = await findUser(manager, "firebaseUid", identity.uid);
        if (!linked) throw new Error("FIREBASE_IDENTITY_LINK_CONFLICT");
        return linked;
      }

      const tenantId = randomUUID();
      const userId = randomUUID();
      await manager.query(
        `INSERT INTO "tenants" ("id", "name") VALUES ($1, $2)`,
        [tenantId, "Personal tenant"],
      );
      await manager.query(
        `INSERT INTO "user"
          ("id", "name", "email", "emailVerified", "image", "tenantId", "role", "firebaseUid")
         VALUES ($1, $2, $3, true, $4, $5, 'user', $6)`,
        [
          userId,
          displayName(identity),
          identity.email.toLowerCase(),
          identity.picture ?? null,
          tenantId,
          identity.uid,
        ],
      );

      return (await findUser(manager, "firebaseUid", identity.uid))!;
    });
  }

  async findByFirebaseUid(
    firebaseUid: string,
  ): Promise<AuthenticatedLocalUser | undefined> {
    return findUser(this.dataSource.manager, "firebaseUid", firebaseUid);
  }
}

type LookupColumn = "firebaseUid" | "email";

async function findUser(
  manager: Pick<EntityManager, "query">,
  column: LookupColumn,
  value: string,
): Promise<AuthenticatedLocalUser | undefined> {
  const rows = (await manager.query(
    `SELECT "id", "firebaseUid", "email", "name", "tenantId", "role"
     FROM "user" WHERE "${column}" = $1`,
    [value],
  )) as AuthenticatedLocalUser[];
  return rows[0];
}

function displayName(identity: VerifiedFirebaseIdentity) {
  const name = identity.name?.trim();
  return name || identity.email;
}
