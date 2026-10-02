import {
  Check,
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Quién emite el documento de lo que se cobra con este medio (spec
 * `2026-10-01-emision-por-venta`, § 3.1): `'sistema'` arma la boleta,
 * `'maquina'` la emite el POS de tarjeta (su voucher/boleta), `'nadie'` deja la
 * venta sin documento y la responsabilidad es del comercio.
 */
export type EmisorMedio = 'sistema' | 'maquina' | 'nadie';

@Entity('tenant_metodo_pago')
@Check(
  'chk_tenant_metodo_pago_emisor',
  `"emisor" IN ('sistema','maquina','nadie')`,
)
export class TenantMetodoPago {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @PrimaryColumn({ name: 'metodo_pago_id', type: 'uuid' })
  metodoPagoId: string;

  @Column({ name: 'permite_vuelto', default: false })
  permiteVuelto: boolean;

  @Column({ default: false })
  habilitada: boolean;

  // Política operativa por tenant: fuerza el conteo obligatorio de un método
  // no-efectivo al cerrar. obligatorio = es_efectivo OR requiere_conteo.
  @Column({ name: 'requiere_conteo', default: false })
  requiereConteo: boolean;

  /**
   * Quién documenta lo cobrado con este medio. Un comercio nuevo trae
   * `'sistema'` en todos (E3): es el error barato, se corrige con NC. El `type`
   * es explícito: la unión entra por `export type` en este mismo archivo, pero
   * sin él `design:type` quedaría en `Object` si alguien la importa con
   * `import type` (ver `tenant.entity.ts`, `modoRedondeo`).
   */
  @Column({ type: 'text', default: 'sistema' })
  emisor: EmisorMedio;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
