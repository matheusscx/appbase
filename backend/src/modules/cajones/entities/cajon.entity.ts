import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

// Índice único parcial: nombre único por tenant entre no-borrados. Es la garantía
// dura (bajo concurrencia el check de `count` del service podría saltearse); el
// service igual valida primero para devolver un 409 con mensaje amable.
//
// ⚠️ `ux_cajones_tenant_nombre` NO se declara acá CON SUS COLUMNAS: tiene que
// ser sobre `LOWER("nombre")` —la unicidad de nombre es case-insensitive en
// todo el proyecto (docs/PRODUCTO.md)— y **TypeORM no sabe expresar una
// función en `@Index`**. Declarado con columnas, `synchronize` creaba en dev
// un índice sobre `nombre` PELADO y la base enforzaba otra regla que el código.
// Lo crea la migración con SQL cruda, mismo patrón que `grupos_modificadores`,
// `motivo_baja` y los dos `motivos_diferencia`.
//
// Lo que sí se declara acá es solo el NOMBRE, con `synchronize: false`: sin
// columnas, para que `migration:generate` no lo proponga borrar (ADR-030).
@Index('ux_cajones_tenant_nombre', { synchronize: false })
// Una sola principal por tenant, entre las vivas: backstop duro bajo concurrencia
// (el service desmarca la anterior en la misma transacción, pero dos PATCH
// simultáneos sobre cajones distintos no competirían por nada sin este índice).
@Index('ux_cajones_principal_por_tenant', ['tenantId'], {
  unique: true,
  where: '"principal" = true AND "eliminado_el" IS NULL',
})
@Entity('cajones')
export class Cajon {
  @PrimaryGeneratedColumn('uuid', { name: 'cajon_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ default: true })
  activo: boolean;

  // Con cuánto suele abrirse este cajón: la apertura lo precarga y la cajera lo
  // edita (03.28). Es una sugerencia, no una regla: `null` = sin fondo sugerido
  // (la apertura arranca vacía) y el saldo inicial real lo sigue fijando
  // `AbrirCajaDto.saldoInicial`.
  @Column({
    name: 'fondo_sugerido',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  fondoSugerido: string | null;

  // El cajón donde entran los cobros de mesa del garzón (02.2, owner 2026-10-17):
  // las cajas son del local, no del garzón. A lo sumo uno por tenant, lo marca el
  // admin en Configuración → Cajas. Si su sesión no está abierta, el cobro cae en
  // otra caja abierta del local (`CajaService.cajasParaCobroDeMesa`).
  @Column({ type: 'boolean', default: false })
  principal: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
