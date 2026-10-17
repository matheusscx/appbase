import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ComandaHoraDeSalida1792200000000 implements MigrationInterface {
  name = 'ComandaHoraDeSalida1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cuenta_lineas" ADD "enviada_el" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cuenta_lineas" DROP COLUMN "enviada_el"`,
    );
  }
}
