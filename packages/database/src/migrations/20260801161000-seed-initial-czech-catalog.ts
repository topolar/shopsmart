import type { MigrationInterface, QueryRunner } from "typeorm";

export class SeedInitialCzechCatalog20260801161000 implements MigrationInterface {
  name = "SeedInitialCzechCatalog20260801161000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "canonical_product_classes" (
        "id", "contract_version", "slug", "name", "comparison_unit",
        "required_attributes", "excluded_attributes"
      ) VALUES
        ('a1000000-0000-8000-8000-000000000001', '1', 'unscented-toilet-paper', 'Unscented toilet paper', 'roll', '{"scent":"unscented"}', '{}'),
        ('a1000000-0000-8000-8000-000000000002', '1', 'low-fat-curd', 'Low-fat curd', '250-gram', '{"fatClass":"low-fat"}', '{}'),
        ('a1000000-0000-8000-8000-000000000003', '1', 'fresh-chicken-breast-fillets', 'Fresh chicken breast fillets', 'kilogram', '{"cut":"breast-fillet","state":"fresh"}', '{}'),
        ('a1000000-0000-8000-8000-000000000004', '1', 'balkan-cheese', 'Balkan cheese', '100-gram', '{"style":"balkan"}', '{}'),
        ('a1000000-0000-8000-8000-000000000005', '1', 'brined-mozzarella', 'Brined mozzarella', '100-gram', '{"style":"brined"}', '{"form":"shredded"}'),
        ('a1000000-0000-8000-8000-000000000006', '1', 'fresh-tomatoes', 'Fresh tomatoes', 'kilogram', '{"state":"fresh"}', '{}'),
        ('a1000000-0000-8000-8000-000000000007', '1', 'fresh-peppers', 'Fresh peppers', 'kilogram', '{"state":"fresh"}', '{}'),
        ('a1000000-0000-8000-8000-000000000008', '1', 'salad-cucumbers', 'Salad cucumbers', 'piece', '{"state":"fresh"}', '{}'),
        ('a1000000-0000-8000-8000-000000000009', '1', 'fresh-bananas', 'Fresh bananas', 'kilogram', '{"state":"fresh"}', '{}'),
        ('a1000000-0000-8000-8000-000000000010', '1', 'greek-yogurt', 'Greek yogurt', '100-gram', '{"style":"greek"}', '{"style":"greek-style"}'),
        ('a1000000-0000-8000-8000-000000000011', '1', 'cheddar', 'Cheddar', '100-gram', '{"cheeseType":"cheddar"}', '{}'),
        ('a1000000-0000-8000-8000-000000000012', '1', 'fresh-blueberries', 'Fresh blueberries', '100-gram', '{"state":"fresh"}', '{"state":"frozen"}'),
        ('a1000000-0000-8000-8000-000000000013', '1', 'fresh-chicken-eggs', 'Fresh chicken eggs', 'piece', '{"species":"chicken","state":"fresh"}', '{}')
      ON CONFLICT ("slug") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "canonical_product_classes"
      WHERE "id" IN (
        'a1000000-0000-8000-8000-000000000001',
        'a1000000-0000-8000-8000-000000000002',
        'a1000000-0000-8000-8000-000000000003',
        'a1000000-0000-8000-8000-000000000004',
        'a1000000-0000-8000-8000-000000000005',
        'a1000000-0000-8000-8000-000000000006',
        'a1000000-0000-8000-8000-000000000007',
        'a1000000-0000-8000-8000-000000000008',
        'a1000000-0000-8000-8000-000000000009',
        'a1000000-0000-8000-8000-000000000010',
        'a1000000-0000-8000-8000-000000000011',
        'a1000000-0000-8000-8000-000000000012',
        'a1000000-0000-8000-8000-000000000013'
      )
    `);
  }
}
