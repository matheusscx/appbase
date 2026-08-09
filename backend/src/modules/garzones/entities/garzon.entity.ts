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

  /**
   * Vínculo **opcional** con una cuenta del sistema (modo personal: el garzón
   * tiene su propia tablet, así que el JWT ya dice quién es y no se le pide
   * PIN). Sin vínculo todo funciona como siempre — que es justamente lo que
   * permite sumar personal temporal sin crearle una cuenta, el objetivo con el
   * que nació el PIN.
   *
   * Único por tenant sobre filas vivas (`uq_garzones_usuario_tenant`): si una
   * cuenta fuera dos garzones vivos, resolver el actuante por JWT elegiría uno
   * al azar.
   */
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
