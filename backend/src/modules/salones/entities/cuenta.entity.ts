import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum EstadoCuenta {
  ABIERTA = 'abierta',
  CERRADA = 'cerrada',
  CANCELADA = 'cancelada',
}

/**
 * `idx_cuentas_venta`: lo pide el `EXISTS` de `VentasService.findOne`, que
 * pregunta si la venta vino de una cuenta con líneas ya despachadas a cocina.
 * Corre en cada `GET /ventas/:id` —o sea cada vez que alguien abre el detalle de
 * una venta— y `cuentas` crece con cada mesa atendida en la historia del tenant,
 * soft-deletes incluidos. Sin él es un seq scan que escala con el volumen del
 * salón. Postgres no indexa las FK por su cuenta, y `venta_id` no tenía ningún
 * lector antes de esa consulta.
 */
@Index('idx_cuentas_venta', ['tenantId', 'ventaId'])
@Index('idx_cuentas_responsable', ['tenantId', 'garzonResponsableId'])
/**
 * `idx_cuentas_estado`: lo pide `ItemsService.comprometidoPorItem`, la consulta
 * que le resta a `disponible`/`stockDisponible` lo que las cuentas ABIERTAS ya
 * pidieron. Cuelga de `GET /items`, o sea del menú del POS, y las pantallas
 * disparan **un `GET /items`** cada vez (`pos.vue:138,141,144` y
 * `salones/index.vue:638-640`). En el POS eso pasa por carga de pantalla; en `/salones`, por cada ráfaga de mutación
 * (`refrescar()` de `useCatalogoVenta`, debounce de 250 ms).
 *
 * ⚠️ **Solo no sirve de nada, y eso está medido con un control**: agregándolo
 * sin `idx_cuenta_lineas_cuenta` la consulta pasa de 13,99 ms a 12,52 ms — sigue
 * barriendo `cuenta_lineas` entera. El que cambia el plan es aquel (1,22 ms);
 * este recorta el lado chico una vez que el grande dejó de ser un seq scan
 * (0,36 ms con los dos, y el scan de `cuentas` cae de 124 buffers a 3). Las
 * cuatro corridas y su escala están en el docblock de `idx_cuenta_lineas_cuenta`.
 * **Va junto con aquel o no va.**
 *
 * `estado` y no solo `tenant_id` porque el filtro selectivo es justamente ese:
 * de 8.031 cuentas del tenant, 31 están abiertas.
 */
@Index('idx_cuentas_estado', ['tenantId', 'estado'])
/**
 * `idx_cuentas_cerrada`: lo pide "lo vendido por garzón" del resumen de
 * anulaciones (`AnulacionesReporteService.resumen`, spec
 * `2026-09-27-porcentaje-anulaciones-por-garzon-design.md` § 5.1), que filtra
 * `tenant_id = $1 AND estado = 'cerrada' AND cerrada_el` entre un rango.
 * Corre en cada `GET /salones/anulaciones/resumen`, o sea cada vez que se
 * abre ese reporte.
 *
 * ⚠️ **Ronda de fix 1 (hallazgo del controlador):** la primera medición se
 * hizo con datos de un solo tenant, que es justo la distribución donde no se
 * nota que la consulta no filtraba `cuentas.tenant_id`/`cuenta_lineas.tenant_id`
 * de forma directa (llegaba acotada solo por el `tenant_id` de
 * `cuenta_linea_reparto`) — sin esa igualdad, un índice `(tenantId, …)` no
 * puede hacer un seek real y como mucho recorre el índice entero. Se agregó
 * `AND cl.tenant_id = $1` al JOIN de `cuenta_lineas` y `AND c.tenant_id = $1`
 * al de `cuentas`, y se remidió con datos de DOS tenants: **20.000 cuentas
 * cerradas, 2.000 (10%) del tenant consultado y 18.000 (90%) de otro tenant**,
 * intercaladas en los mismos 200 días (no en bloques separados) — sin ese
 * reparto, el problema tampoco se ve. `EXPLAIN (ANALYZE, BUFFERS)` sobre un
 * rango de un día, tres corridas:
 *
 * 1. **Sin el índice** (con la consulta ya corregida, `tenant_id` en los dos
 *    JOINs): la planificación usa `idx_cuentas_responsable` como acceso por
 *    tenant y filtra `cerrada_el`/`estado` después — cost 619,50..619,53,
 *    1.519 buffers, 3,356 ms.
 * 2. **Con el índice, la consulta VIEJA** (sin `tenant_id` en `cuentas` ni en
 *    `cuenta_lineas`): el índice se usa, pero solo por `cerrada_el` —recorre
 *    TODO el rango de fecha de TODOS los tenants— y el JOIN a `cuenta_lineas`
 *    cae a un seq scan completo (20.007 filas) porque tampoco tiene con qué
 *    acotar por tenant ahí. Es el peor de los tres: cost 1.258,39..1.319,22,
 *    1.090 buffers (1.069 hit + 21 read), 5,314 ms.
 * 3. **Con el índice, la consulta NUEVA:** `Index Scan using idx_cuentas_cerrada`
 *    con `Index Cond: (tenant_id = $1 AND cerrada_el >= … AND cerrada_el <= …)`
 *    — un seek real por las dos columnas, y `cuenta_lineas` vuelve a resolver
 *    por `idx_cuenta_lineas_cuenta (tenant_id, cuenta_id)`. cost
 *    153,34..157,49, 1.006 buffers, 1,831 ms.
 *
 * El plan cambia y mejora yendo de (1) a (3) —cost 619→157, 3,356→1,831 ms—,
 * así que el índice se queda. La ganancia más grande la da el filtro de
 * tenant en los JOINs (arregla (2), que sin el índice sería aún peor); el
 * índice suma una mejora real arriba de eso, no cosmética.
 */
@Index('idx_cuentas_cerrada', ['tenantId', 'cerradaEl'])
@Entity('cuentas')
export class Cuenta {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'mesa_id', type: 'uuid' })
  mesaId: string;

  // Correlativo por tenant para identificar la cuenta ("Cuenta 85").
  @Column({ type: 'int' })
  numero: number;

  @Column({ type: 'text', nullable: true })
  nombre: string | null;

  @Column({ type: 'text', default: EstadoCuenta.ABIERTA })
  estado: EstadoCuenta;

  // Venta generada al cerrar la cuenta (null mientras está abierta/cancelada).
  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  // Garzón que abrió la cuenta (identificado por PIN). Trazabilidad operativa.
  @Column({ name: 'garzon_apertura_id', type: 'uuid', nullable: true })
  garzonAperturaId: string | null;

  // Garzón responsable vigente. Cambia al transferir; D/E atribuyen a este ID.
  @Column({ name: 'garzon_responsable_id', type: 'uuid', nullable: true })
  garzonResponsableId: string | null;

  // Garzón que cerró la cuenta (identificado por PIN al generar la venta).
  @Column({ name: 'garzon_cierre_id', type: 'uuid', nullable: true })
  garzonCierreId: string | null;

  @Column({ name: 'abierta_el', type: 'timestamptz', default: () => 'now()' })
  abiertaEl: Date;

  @Column({ name: 'cerrada_el', type: 'timestamptz', nullable: true })
  cerradaEl: Date | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
