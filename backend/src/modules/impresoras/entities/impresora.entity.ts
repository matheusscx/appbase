import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export type RolImpresora = 'comanda' | 'boleta';
export type TipoConexionImpresora = 'red' | 'sistema';

/**
 * Impresora térmica configurada por el tenant. `rol` determina su uso:
 * 'comanda' (cocina/barra, ruteada desde categorias.impresora_id) o
 * 'boleta' (precuenta/boleta). La impresión real ocurre en el navegador vía
 * QZ Tray — esta tabla solo guarda cómo alcanzarla (red TCP o cola del SO).
 * Ver docs/features/impresion-termica.md.
 */
@Entity('impresoras')
export class Impresora {
  @PrimaryGeneratedColumn('uuid', { name: 'impresora_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'text' })
  rol: RolImpresora;

  @Column({ name: 'tipo_conexion', type: 'text' })
  tipoConexion: TipoConexionImpresora;

  @Column({ type: 'varchar', length: 255, nullable: true })
  host: string | null;

  @Column({ type: 'int', nullable: true })
  puerto: number | null;

  @Column({ name: 'nombre_cola', type: 'varchar', length: 100, nullable: true })
  nombreCola: string | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
