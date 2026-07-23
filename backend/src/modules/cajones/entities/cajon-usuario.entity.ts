import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

// Índice único parcial: una habilitación viva (cajón, usuario) no se repite.
// Al quitar y re-habilitar, la fila anterior queda soft-deleted y se crea una nueva
// (el WHERE eliminado_el IS NULL lo permite).
@Entity('cajon_usuario')
@Index('ux_cajon_usuario_cajon_usuario', ['cajonId', 'usuarioId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class CajonUsuario {
  @PrimaryGeneratedColumn('uuid', { name: 'cajon_usuario_id' })
  id: string;

  @Column({ name: 'cajon_id', type: 'uuid' })
  cajonId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
