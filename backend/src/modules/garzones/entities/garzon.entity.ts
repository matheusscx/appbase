import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { TipoGarzon } from '../enums/tipo-garzon.enum';

/**
 * Garzón: identidad operativa liviana dentro de un tenant (restaurante).
 * NO es un usuario del sistema — no tiene login ni JWT. Se identifica por un
 * PIN de 6 dígitos (hasheado con bcrypt) para registrar quién abre/cierra cada
 * cuenta en dispositivos compartidos. Ver docs/features/garzones.md.
 */
@Entity('garzones')
export class Garzon {
  @PrimaryGeneratedColumn('uuid', { name: 'garzon_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  // Hash bcrypt del PIN de 6 dígitos. Nunca se expone por la API.
  @Column({ name: 'pin_hash', type: 'text' })
  pinHash: string;

  @Column({ default: true })
  activo: boolean;

  @Column({ type: 'text', default: TipoGarzon.GARZON })
  tipo: TipoGarzon;

  // Garzón placeholder "Mostrador": recibe la propina del POS con atribución
  // neutra. No opera (activo=false), no se identifica por PIN y se oculta del
  // listado de garzones. Ver docs/features/pagos.md.
  @Column({ name: 'es_placeholder', type: 'boolean', default: false })
  esPlaceholder: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
