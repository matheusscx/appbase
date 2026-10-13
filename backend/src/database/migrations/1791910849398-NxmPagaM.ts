import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * NxM de verdad: "lleva `cada_n`, paga `paga_m`" (owner, 2026-10-13).
 *
 * `migration:generate` solo sacó el `ADD COLUMN`: TypeORM no compara la
 * expresión de un CHECK, así que `chk_promociones_valor_segun_tipo` se
 * recrea a mano con el texto de la entity.
 *
 * El `UPDATE` va antes del CHECK porque el demo de Railway conserva sus filas
 * (ADR-030) y un `nxm` sin `paga_m` lo haría fallar. `cada_n − 1` no es una
 * copia que pueda divergir: es la regla anterior ("la más barata de cada
 * `cada_n`" = "paga `cada_n − 1`"), así que el 2x1 existente cobra igual.
 */
export class NxmPagaM1791910849398 implements MigrationInterface {
  name = 'NxmPagaM1791910849398';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "promociones" ADD "paga_m" smallint`);
    // Sin `eliminado_el IS NULL` a propósito: el CHECK de abajo rige también
    // sobre las filas en la papelera, y una sin `paga_m` lo haría fallar.
    await queryRunner.query(
      `UPDATE "promociones" SET "paga_m" = "cada_n" - 1 WHERE "tipo" = 'nxm'`,
    );
    await queryRunner.query(
      `ALTER TABLE "promociones" DROP CONSTRAINT "chk_promociones_valor_segun_tipo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "promociones" ADD CONSTRAINT "chk_promociones_valor_segun_tipo" CHECK (("tipo" = 'porcentaje' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NULL AND "paga_m" IS NULL AND "valor_monto" IS NULL)
   OR ("tipo" = 'nxm' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NOT NULL AND "paga_m" IS NOT NULL AND "paga_m" >= 1 AND "paga_m" < "cada_n" AND "valor_monto" IS NULL)
   OR ("tipo" = 'precio_fijo' AND "valor_monto" IS NOT NULL AND "valor_porcentaje" IS NULL AND "cada_n" IS NULL AND "paga_m" IS NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "promociones" DROP CONSTRAINT "chk_promociones_valor_segun_tipo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "promociones" ADD CONSTRAINT "chk_promociones_valor_segun_tipo" CHECK (("tipo" = 'porcentaje' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NULL AND "valor_monto" IS NULL)
   OR ("tipo" = 'nxm' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NOT NULL AND "valor_monto" IS NULL)
   OR ("tipo" = 'precio_fijo' AND "valor_monto" IS NOT NULL AND "valor_porcentaje" IS NULL AND "cada_n" IS NULL))`,
    );
    await queryRunner.query(`ALTER TABLE "promociones" DROP COLUMN "paga_m"`);
  }
}
