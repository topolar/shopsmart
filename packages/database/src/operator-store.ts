import { z } from "zod";
import type { DataSource } from "typeorm";

const operatorEmailSchema = z.string().trim().toLowerCase().email().max(320);

type OperatorRow = Readonly<{
  id: string;
  role: string;
}>;

export class TypeOrmOperatorStore {
  constructor(private readonly dataSource: DataSource) {}

  async grantByEmail(email: string): Promise<Readonly<{ userId: string }>> {
    const normalizedEmail = operatorEmailSchema.parse(email);
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT "id", "role"
         FROM "user"
         WHERE LOWER("email") = $1
         FOR UPDATE`,
        [normalizedEmail],
      )) as OperatorRow[];
      if (rows.length !== 1) throw new Error("OPERATOR_USER_NOT_FOUND");
      const user = rows[0]!;
      if (user.role !== "operator") {
        await manager.query(
          `UPDATE "user" SET "role" = 'operator', "updatedAt" = NOW()
           WHERE "id" = $1`,
          [user.id],
        );
      }
      return { userId: user.id };
    });
  }
}
