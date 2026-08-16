import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * El nombre del único rol de sistema que existe hoy. Vive acá y no en el
 * service porque la unique parcial de abajo lo usa como identidad: es por
 * `(tenant_id, nombre)` que `RolesService` lo encuentra-o-crea.
 */
export const ROL_OPERADOR_SALON = 'Operador de salón';

@Entity('roles')
// Unique **solo entre roles de sistema**, y por eso no puede chocar con nada
// existente: hoy no hay ninguno. Es lo que hace segura la creación perezosa —
// dos otorgamientos simultáneos en un tenant que todavía no tiene el rol
// crearían dos, y el segundo `INSERT` cae en el `ON CONFLICT DO NOTHING`.
// Los roles normales siguen sin unique de nombre, que es una decisión aparte.
@Index('uq_roles_sistema_tenant_nombre', ['tenantId', 'nombre'], {
  unique: true,
  where: 'es_sistema = true AND eliminado_el IS NULL',
})
export class Rol {
  @PrimaryGeneratedColumn('uuid', { name: 'rol_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column()
  nombre: string;

  @Column({ type: 'varchar', nullable: true })
  descripcion: string | null;

  @Column({ name: 'es_fijo', default: false })
  esFijo: boolean;

  /**
   * La definición de este rol es **de la aplicación**, no del tenant: su
   * nombre, su descripción y —sobre todo— **su lista de permisos** no se
   * editan, y el rol no se borra.
   *
   * ⚠️ **Eje distinto de `esFijo`, no una variante.** `esFijo` es "admin, y por
   * eso acceso total"; `esSistema` es "alguien que no es admin puede repartir
   * este rol, así que su alcance tiene que estar fijado por construcción".
   * Un rol de sistema NO da acceso total y no participa del conteo de
   * administradores.
   *
   * Existe por `Operador de salón`: quien tiene `Salones:Actualizar` puede
   * concedérselo a la cuenta de un garzón sin ser admin del tenant (decisión
   * del owner, 2026-08-15). Si el admin pudiera agregarle permisos, el
   * encargado pasaría a repartir esos también sin enterarse — que es
   * exactamente la escalada que la decisión descartó.
   */
  @Column({ name: 'es_sistema', default: false })
  esSistema: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
