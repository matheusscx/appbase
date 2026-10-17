import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ItemFavorito1792300000001 implements MigrationInterface {
  name = 'ItemFavorito1792300000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" ADD "favorito" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "items" DROP COLUMN "favorito"`);
  }
}
