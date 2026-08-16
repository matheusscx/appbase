import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum TipoTokenAcceso {
  /** Cuenta creada por un admin: la persona todavía no eligió contraseña. */
  INVITACION = 'invitacion',
  /** "Olvidé mi contraseña": la cuenta ya existe y funciona. */
  RESET = 'reset',
  /**
   * La cuenta **ya existe y ya tiene contraseña**, y un admin la está sumando a
   * su tenant. A diferencia de los otros dos, no termina en "elegí una
   * contraseña": termina en "sí, este correo es mío y acepto entrar a X".
   *
   * Existe porque "el correo coincide" dejó de ser prueba de identidad
   * (decisión del owner, 2026-08-15). Antes el alta **adoptaba** la cuenta
   * preexistente tal cual, así que quien hubiera registrado el correo de un
   * futuro empleado heredaba los roles que el admin eligiera.
   */
  CONFIRMACION = 'confirmacion',
  /**
   * Auto-registro público: la persona ya eligió su contraseña, falta probar que
   * la dirección es suya. Sella `usuarios.correo_verificado_el`.
   *
   * No es una `INVITACION` aunque se le parezca: ahí la cuenta **no tiene**
   * contraseña y el link sirve para elegirla. Acá la cuenta ya está completa y
   * lo único que falta es la prueba del correo.
   */
  VERIFICACION = 'verificacion',
}

/**
 * Token de un solo uso que termina en "elegí tu contraseña".
 *
 * **Una sola tabla para invitación y reset** porque son el mismo mecanismo:
 * token con vencimiento, que se quema al usarse, y una pantalla idéntica al
 * final. Separarlas duplicaría la lógica de expiración y de quemado, que es
 * justo donde un bug no se nota hasta que alguien reusa un link.
 *
 * ⚠️ **Se guarda el HASH, no el token.** Mismo criterio que la contraseña y el
 * PIN del garzón: si la base se filtra, los tokens vivos no le sirven a nadie.
 * El token en claro existe **solo** dentro del link del mail.
 *
 * **SHA-256 y no bcrypt**, a diferencia del PIN. No es descuido: bcrypt es
 * lento a propósito para credenciales de baja entropía —un PIN son 10⁶
 * posibilidades y hay que encarecer cada intento—. Un token es de 256 bits al
 * azar: no se adivina por fuerza bruta ni con hardware dedicado, así que
 * encarecer el intento no compra nada. Y sí compra algo importante: un hash
 * determinista **se puede indexar**, o sea que validar un token es UNA búsqueda
 * por índice. Con bcrypt habría que recorrer los tokens vivos comparando uno
 * por uno — exactamente la amplificación que se sacó del PIN del garzón.
 */
@Entity('tokens_acceso')
export class TokenAcceso {
  @PrimaryGeneratedColumn('uuid', { name: 'token_id' })
  id: string;

  /** SHA-256 en hex del token que viaja en el link. Único e indexado. */
  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash: string;

  @Column({ type: 'text' })
  tipo: TipoTokenAcceso;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'expira_el', type: 'timestamptz' })
  expiraEl: Date;

  /** Sellado al usarse. Un token usado no vuelve a servir. */
  @Column({ name: 'usado_el', type: 'timestamptz', nullable: true })
  usadoEl: Date | null;

  /**
   * Lo que hay que hacer **cuando** el token se confirme. Sólo lo usa
   * `CONFIRMACION`; en los otros dos tipos es `null`.
   *
   * Está acá y no en `usuarios_tenants` a propósito. La alternativa era crear
   * la membresía marcada como "pendiente", y eso obligaba a que las **nueve**
   * lecturas de membresía del backend (`TenantGuard`, `switchTenant`,
   * `getMyTenants`, roles, garzones ×2, cajones, tenants ×2) filtraran el
   * estado nuevo: un solo olvido deja operar a alguien que nunca confirmó.
   * Guardando la intención acá, quien no confirmó **no es miembro por
   * construcción** y no hace falta tocar ninguna de las nueve.
   *
   * Los `rolIds` se congelan al momento del alta: son los que el admin eligió.
   * Se revalidan contra el tenant al confirmar, porque entre el mail y el clic
   * puede pasar una semana y un rol puede haberse borrado.
   */
  @Column({ name: 'datos', type: 'jsonb', nullable: true })
  datos: { tenantId: string; rolIds: string[] } | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
