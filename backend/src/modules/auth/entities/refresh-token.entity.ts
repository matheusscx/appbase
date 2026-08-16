import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Usuario } from '../../users/usuario.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  token: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Usuario;

  @Column({ name: 'active_tenant_id', type: 'uuid', nullable: true })
  activeTenantId: string | null;

  // `type` explícito en las dos fechas (ADR-019). `expires_at` es la que le
  // dio sentido al segundo test: el invariante unit de `common/invariants/`
  // sólo mira las tres columnas de auditoría, así que **a ésta no la veía** —
  // se encontró a mano al migrar `created_at`, y dejarla sin zona habría
  // dejado mixta justo la tabla que decide si un token sigue vivo. Hoy sí la
  // cubre `test/esquema.e2e-spec.ts`, que va sobre el esquema entero
  // precisamente por este caso.
  // La comparación de expiración vive en JS (`auth.service.ts` →
  // `existing.expiresAt < new Date()`), no en SQL: por eso el cambio de tipo
  // no mueve ninguna lógica de tokens (invariante 4, autorizado por el owner).
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /**
   * Sellado al canjearse. `NULL` = vigente.
   *
   * **La fila no se borra al rotar, se marca** — mismo patrón que
   * `TokensAccesoService.quemar()`, que ya resolvía esto acá al lado. Es lo que
   * hace posibles las dos mitades de una sola sentencia:
   *
   * - **canje atómico**: `UPDATE ... WHERE token = $1 AND usado_el IS NULL`
   *   deja que de dos requests simultáneos con la misma cookie sólo uno afecte
   *   una fila. Antes eran `findOne` + `delete` sin mirar `affected`, y **los
   *   dos podían ganar**.
   * - **detección de reuso**: la fila marcada queda de lápida, así que
   *   presentar un token ya rotado deja de ser un 401 indistinguible de un
   *   token inventado. Corta la sesión entera **sólo pasada la ventana de
   *   gracia** — antes de eso es una carrera, no un ataque; ver
   *   `reemplazadoPor` acá abajo.
   *
   * Las filas usadas se podan por `expires_at` al rotar (ver
   * `createRefreshToken`): una lápida vencida ya no distingue nada, porque el
   * reuso de un token vencido no revoca.
   */
  @Column({ name: 'usado_el', type: 'timestamptz', nullable: true })
  usadoEl: Date | null;

  /**
   * La fila que reemplazó a ésta al rotar. `NULL` mientras siga vigente, y
   * también cuando la baja fue una **revocación** y no una rotación.
   *
   * ⚠️ **Es lo que separa al perdedor de una carrera de un atacante**, y sin
   * eso la detección de reuso hace exactamente el daño que venía a evitar: dos
   * pestañas del mismo navegador comparten la cookie y el frontend serializa el
   * refresh **por pestaña** (`useApiFetch.ts`), así que dos tabs despertando de
   * standby canjean el mismo token. Uno gana; el otro llega a un token ya
   * rotado, que es la firma exacta de una sesión copiada. Sin esta columna la
   * única lectura posible era "te robaron la sesión" y se deslogueaba de todos
   * sus dispositivos a alguien que no hizo nada. Un reintento de red —request
   * que llegó, respuesta que se perdió— produce lo mismo.
   *
   * Dentro de `GRACIA_CANJE_MS` el perdedor recibe **el mismo token que ganó el
   * otro** y las dos pestañas siguen vivas. Pasada la ventana ya no hay carrera
   * que explicar, y ahí sí se corta la sesión entera.
   */
  @Column({ name: 'reemplazado_por', type: 'uuid', nullable: true })
  reemplazadoPor: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
