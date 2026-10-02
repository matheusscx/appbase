import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('tipos_documento_tributario')
/**
 * Una sola nota de crédito por país. La resolución del flujo de reembolso toma
 * la primera fila marcada: con dos, el tipo congelado en la venta dependería del
 * orden que elija el planner. Mismo patrón que `uq_sesion_garzon_abierta`.
 */
@Index('uq_tipo_documento_nota_credito_pais', ['paisId'], {
  unique: true,
  where: `"es_nota_credito" = true AND "eliminado_el" IS NULL`,
})
/**
 * Una sola boleta por país: "la boleta del país" es lo que se pone cuando la
 * venta no trae tipo y lo único que admite una venta online. Con dos filas
 * marcadas, la elegida dependería del orden que devuelva el planner. Gemelo del
 * índice de la nota de crédito, de arriba.
 */
@Index('uq_tipo_documento_boleta_pais', ['paisId'], {
  unique: true,
  where: `"es_boleta" = true AND "eliminado_el" IS NULL`,
})
export class TipoDocumentoTributario {
  @PrimaryGeneratedColumn('uuid', { name: 'tipo_documento_id' })
  id: string;

  @Column({ name: 'pais_id', type: 'uuid' })
  paisId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  codigo: string | null;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ default: true })
  activo: boolean;

  @Column({ name: 'customer_requerido', default: false })
  customerRequerido: boolean;

  /**
   * Marca cuál fila de este país es la nota de crédito, para que el flujo de
   * reembolso la resuelva desde el catálogo en vez de una constante.
   *
   * Hasta el 2026-09-03 acá había un `TIPO_DOCUMENTO_NC_ID` hardcodeado con la
   * fila **chilena** código 61, y se usaba sin mirar el país: un reembolso en un
   * tenant argentino congelaba un documento de otro país, que es justo lo que
   * ADR-010 dice que después no se puede corregir. El owner decidió ese día que
   * AR/CO/MX **van a emitir de verdad, progresivamente**, y que mientras tanto
   * cada país tiene su propia nota de crédito **interna** (sin emisión, sin
   * código tributario) — no un documento inventado desde el seeder.
   *
   * Sembrada `activo: false`: no aparece en el selector del POS.
   */
  @Column({ name: 'es_nota_credito', default: false })
  esNotaCredito: boolean;

  /**
   * Marca cuál fila de este país es la boleta: el documento al consumidor final.
   * Es lo que separa "el documento sigue la regla del medio de pago" de "lo hace
   * siempre el sistema", y lo que resuelve "la boleta del país" cuando la venta
   * no trae tipo (o es online y no puede traer otro). Hasta acá la única forma
   * de encontrarla era el orden alfabético del selector.
   *
   * Sembrada `true` solo en la Boleta chilena (código 39). AR/CO/MX no tienen
   * boleta sembrada: el tipo de la venta queda en `null`, como hoy, hasta que
   * abra el frente fiscal de cada país.
   */
  @Column({ name: 'es_boleta', type: 'boolean', default: false })
  esBoleta: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
