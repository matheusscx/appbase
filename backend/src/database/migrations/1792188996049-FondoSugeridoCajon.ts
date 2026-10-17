import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class FondoSugeridoCajon1792188996049 implements MigrationInterface {
  name = 'FondoSugeridoCajon1792188996049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cajones" ADD "fondo_sugerido" numeric(18,4)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cajones" DROP COLUMN "fondo_sugerido"`,
    );
  }
}
