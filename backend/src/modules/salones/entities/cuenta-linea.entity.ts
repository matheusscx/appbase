import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type { PersonalizacionRecetaSnapshot } from '../../../common/dto/personalizacion-receta.dto';
import type { ReglasCongeladas } from '../../../common/dto/reglas-congeladas.dto';

/**
 * `idx_cuenta_lineas_personalizacion` (GIN): lo pide la SEGUNDA rama `'cuenta'`
 * de `ItemsService.obtenerUsoItem` —la que busca el ítem **adentro** de
 * `personalizacion`, no en `item_id`— y lo van a pedir los guards de
 * `PATCH /items/:id` y `PATCH /grupos-modificadores/:id`, que hacen la misma
 * pregunta. Es un `@>` sobre `jsonb`: ningún btree lo resuelve.
 *
 * Medido contra el Postgres del compose, con coincidencia real: 60.315 líneas
 * (tabla de 14 MB = 1.828 páginas), 6.031 cuentas de las que 31 están abiertas,
 * 14 mesas vivas en el tenant.
 *
 *   sin índice   778 ms   25.635 buffers
 *   con GIN      0,14 ms      24 buffers
 *
 * Los 25.592 buffers de `cuenta_lineas` sin índice son 1.828 × 14: el
 * planificador **rebarre la tabla entera una vez por mesa**, porque el `JOIN` a
 * cuentas abiertas no acota nada — el filtro `jsonb` se evalúa antes. Ese ×14
 * es lo que crece: no con las mesas sentadas, sino con la historia del tenant.
 *
 * Cuesta espacio: 7,3 MB de índice sobre 14 MB de tabla, y `cuenta_lineas` se
 * escribe en cada producto que entra a una mesa. GIN amortigua eso con
 * `fastupdate`, y la alternativa era peor: sin índice, `GET /items/:id/uso`
 * —que el frontend dispara antes de abrir el modal de borrado— escanea la
 * historia entera del tenant.
 *
 * Va sin opclass a propósito: `jsonb_path_ops` es más chico y más rápido, pero
 * TypeORM no expresa el opclass (`IndexOptions` tiene `type`, no `ops`), y el
 * `jsonb_ops` por defecto resuelve `@>` igual. El esquema de este proyecto sale
 * de las entidades (`synchronize`), no de migraciones.
 */
@Index('idx_cuenta_lineas_personalizacion', ['personalizacion'], {
  type: 'gin',
})
/**
 * `idx_cuenta_lineas_item`: lo pide la PRIMERA rama `'cuenta'` del mismo
 * `obtenerUsoItem`, que busca por `item_id` para bloquear el borrado de un ítem
 * pedido en una cuenta abierta. Corre en cada `DELETE /items/:id` y en cada
 * `GET /items/:id/uso`, y `cuenta_lineas` crece con cada producto pedido en la
 * historia del tenant, soft-deletes incluidos. Sin él es un seq scan que escala
 * con el volumen transaccional. Postgres no indexa las FK por su cuenta.
 */
@Index('idx_cuenta_lineas_item', ['itemId'])
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

  /**
   * **Lo que la mesa paga por una unidad de esta línea, congelado al pedirla.**
   * Decisión del owner (2026-08-30): *"¿cuál carta? si la hamburguesa se pidió
   * en 5 mil se paga en 5 mil"*. Hasta acá el precio salía del catálogo vivo
   * cada vez que se tasaba la línea, así que repreciar un ítem con la mesa
   * sentada le movía la cuenta sin que nadie se enterara.
   *
   * Es `precioBase + Σ precioExtra de la personalización`, **ya convertido a la
   * moneda oficial del tenant** con su `modo_redondeo` — no la moneda del ítem.
   * Esa distinción no es cosmética: el bug de la moneda del extra
   * (`resueltos.md`, 2026-08-26) fue exactamente guardar/mostrar el número sin
   * convertir, y una receta en USD se veía en dólares y se cobraba en pesos.
   *
   * ⚠️ **Impuestos y reglas NO están acá adentro.** Se congela lo que ENTRA al
   * motor, no lo que sale: el pipeline completo (descuentos, recargos,
   * impuestos) se sigue corriendo al cobrar. Congelar el total de la línea
   * metería lo fiscal adentro del congelado por la ventana, que es lo que
   * ADR-010 no quiere.
   */
  @Column({ name: 'precio_unitario', type: 'numeric', precision: 18, scale: 4 })
  precioUnitario: string;

  /**
   * **Los descuentos y recargos de catálogo que regían sobre el ítem cuando se
   * pidió esta línea**, resueltos (con su valor, sus tramos y su vigencia ya
   * decidida). Decisión del owner (2026-08-30): poner un 20% con la mesa
   * sentada **no** le llega a esa mesa, y sacarlo tampoco se lo quita.
   *
   * Se guardan **resueltos y no por id** porque congelar solo los ids dejaría
   * pasar el cambio de un 20% a un 30%: la regla seguiría siendo la misma y el
   * valor no. Los produce `CalculoPreciosService.congelarReglasDeItem`.
   *
   * ⚠️ Igual que `precioUnitario`, **todavía no manda al cobrar**: `cerrarCuenta`
   * sigue re-tasando contra el catálogo vivo. Hoy lo único que cambian es si dos
   * pedidos son una línea o dos.
   *
   * ⚠️ **Impuestos no están acá.** Son fiscales y se siguen leyendo vivos al
   * cobrar (ADR-010): congelarlos es otro frente, con su propia sesión.
   */
  @Column({ name: 'reglas_congeladas', type: 'jsonb' })
  reglasCongeladas: ReglasCongeladas;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
