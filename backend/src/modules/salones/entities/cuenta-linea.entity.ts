import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type { PersonalizacionRecetaSnapshot } from '../../../common/dto/personalizacion-receta.dto';

@Entity('cuenta_lineas')
export class CuentaLinea {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_linea_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cuenta_id', type: 'uuid' })
  cuentaId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({
    name: 'cantidad_presentacion',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  cantidadPresentacion: string | null;

  @Column({ name: 'unidad_codigo_presentacion', type: 'text', nullable: true })
  unidadCodigoPresentacion: string | null;

  // Cuánto de `cantidad` ya se envió a cocina/barra (POST /cuentas/:id/comanda).
  // El diff (cantidad - cantidad_enviada) es lo que se imprime en el próximo envío.
  @Column({
    name: 'cantidad_enviada',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
  })
  cantidadEnviada: string;

  @Column({ type: 'jsonb', nullable: true })
  personalizacion: PersonalizacionRecetaSnapshot | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
