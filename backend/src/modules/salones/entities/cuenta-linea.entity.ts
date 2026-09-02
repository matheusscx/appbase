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
/**
 * `idx_cuenta_lineas_cuenta`: lo pide `ItemsService.comprometidoPorItem` —la
 * consulta que le resta a `disponible`/`stockDisponible` lo que las cuentas
 * ABIERTAS ya pidieron—, que corre en cada `GET /items`, y las pantallas
 * disparan **tres listados en paralelo** cada vez (`pos.vue:138,141,144` y
 * `salones/index.vue:638-640`).
 *
 * En el POS son tres por carga de pantalla. En `/salones` son tres **por cada
 * ráfaga de mutación**: desde que el catálogo se refresca solo (`refrescarItems`,
 * debounce de 250 ms) la consulta no corre una vez al entrar sino cada vez que
 * el garzón agrega, edita o quita algo.
 *
 * Sin él el plan es un **seq scan de `cuenta_lineas` entera** para devolver las
 * pocas líneas que están en una mesa hoy, y esta tabla crece con la historia
 * transaccional del tenant, soft-deletes incluidos: lo que se barre no son las
 * mesas sentadas, es todo lo que alguna vez se pidió.
 *
 * `EXPLAIN (ANALYZE, BUFFERS)` contra el Postgres del compose, con 60.217
 * líneas / 8.031 cuentas / 31 abiertas / 16 MB, devolviendo 248 filas:
 *
 *   sin ninguno de los dos          13,99 ms  1.525 buffers  (barre las 60.217)
 *   + este                           1,22 ms    434 buffers
 *   + `idx_cuentas_estado`           0,36 ms    313 buffers
 *   solo `idx_cuentas_estado`       12,52 ms  1.404 buffers  ← vuelve al seq scan
 *
 * **Este es el que cambia el plan** (de Hash Join + seq scan a Nested Loop); la
 * última fila es el control que lo prueba: el de `cuentas` solo deja el barrido
 * igual, porque el lado caro del join es éste. Van los dos o ninguno.
 *
 * `(tenant_id, cuenta_id)` y no `cuenta_id` solo: la consulta filtra por tenant
 * en las dos tablas, y ese es además el orden en que se acota. Postgres no
 * indexa las FK por su cuenta.
 */
@Index('idx_cuenta_lineas_cuenta', ['tenantId', 'cuentaId'])
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
   * El mismo precio, **en la moneda del ítem** y sin convertir, más la tasa con
   * la que se convirtió. Son los dos que `venta_detalles` persiste al lado del
   * final (`precio_unitario_origen`, `tasa_cambio`) para poder explicar por qué
   * se cobró eso.
   *
   * ⚠️ **Van congelados o el registro de la venta se contradice.** Medido el
   * 2026-08-31: con solo el final congelado, un ítem en USD repreciado de 10 a
   * 20 se cobraba 9.500 —correcto— y la venta declaraba "20 USD a tasa 950", que
   * son 19.000. La trazabilidad decía una cosa y el cobro otra.
   */
  @Column({
    name: 'precio_unitario_origen',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  precioUnitarioOrigen: string;

  @Column({ name: 'tasa_cambio', type: 'numeric', precision: 18, scale: 6 })
  tasaCambio: string;

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
   * Igual que `precioUnitario`, **son lo que se cobra**: el motor las usa tal
   * cual y no mira las asociaciones vivas del ítem. Deciden además si dos
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
