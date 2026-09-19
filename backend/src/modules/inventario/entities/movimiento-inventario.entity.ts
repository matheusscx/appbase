import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Generated,
} from 'typeorm';

/**
 * Índice por venta: lo usan los tres lectores de esta tabla por `venta_id` en
 * `ventas.service.ts` —el contador de unidades ya devueltas
 * (`unidadesComprometidasPorItem`, que entró al camino de lectura caliente con la
 * nota de crédito por línea), los costos de salida (`costosDeSalidaPorItem`) y la
 * reposición de stock al cancelar (`cancelarUnaVez`)—. Medido con 30.000
 * movimientos: 2,9 ms → 0,07 ms.
 *
 * **Va sin filtrar por `motivo`**, y la alternativa se midió. Un índice **parcial**
 * por `motivo = 'devolucion'` sí sirve mientras la consulta tenga el `OR` que
 * apagaba el índice completo (3,8 ms → 1,4–1,9 ms con un 20% de filas `devolucion`),
 * pero es la salida chica: sacando el `OR` —que es lo que se hizo— el índice
 * completo deja ese mismo **nodo** en 0,10 ms (la consulta entera, en 0,35–0,42 ms),
 * sin un segundo índice que mantener. ⚠️ La primera versión de este comentario decía que el parcial "no
 * cambia el plan": era falso y venía de medirlo con un seed donde el 99% de los
 * movimientos eran devoluciones, o sea donde el parcial no filtra nada. Lo levantó
 * la revisión.
 */
@Index('idx_movimientos_inventario_venta', ['ventaId'])
/**
 * Índice por traslado: mismo patrón de acceso que `venta_id` —"traeme los
 * movimientos de este documento"— y los dos lectores nuevos lo usan
 * (`TrasladosService.findOne`, que además corre DENTRO de la transacción del
 * traslado, o sea reteniendo el lock ancla de `item_producto`, y el
 * `COUNT(DISTINCT item_id)` del listado). Sin el índice ese conteo es un scan
 * del kardex entero que crece sin techo y se paga con toda venta del producto
 * encolada detrás.
 */
@Index('idx_movimientos_inventario_traslado', ['trasladoId'])
/** Por línea de compra: "los movimientos de esta línea" (la entrada y sus correcciones). */
@Index('idx_movimientos_inventario_compra_linea', ['compraLineaId'])
/**
 * El recorrido de "rehacer la cuenta" (spec compras-recepcion § 4.3): los
 * movimientos de UN producto desde una secuencia en adelante, en orden.
 */
@Index('idx_movimientos_inventario_item_secuencia', ['itemId', 'secuencia'])
@Entity('movimientos_inventario')
export class MovimientoInventario {
  @PrimaryGeneratedColumn('uuid', { name: 'movimiento_id' })
  movimientoId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  /**
   * Dónde ocurrió el movimiento. `stock_anterior` y `stock_resultante` pasan a
   * ser los saldos **de esta ubicación**, no del tenant — que es la razón por
   * la que un traslado son dos filas y no una con origen y destino: en una
   * sola no hay dónde escribir los dos saldos (`docs/features/bodegas-y-traslados.md`,
   * «Por qué un traslado son dos filas de kardex, no una»).
   */
  @Column({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  @Column({ type: 'text' })
  tipo: string; // 'entrada' | 'salida' | 'ajuste'

  @Column({ type: 'text' })
  motivo: string; // 'compra' | 'venta' | 'devolucion' | 'anulacion' | 'merma' | 'ajuste_manual' | 'inventario_inicial' | 'ajuste_costo' | 'correccion_compra' | 'recuento' | 'traslado'

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ name: 'stock_anterior', type: 'numeric', precision: 18, scale: 4 })
  stockAnterior: string;

  @Column({
    name: 'stock_resultante',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  stockResultante: string;

  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ type: 'text', nullable: true })
  comentario: string | null;

  @Column({
    name: 'costo_unitario',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoUnitario: string | null;

  @Column({
    name: 'costo_anterior',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoAnterior: string | null;

  @Column({ name: 'motivo_baja_id', type: 'uuid', nullable: true })
  motivoBajaId: string | null;

  /**
   * La anulación (parte 2) que generó este consumo, cuando el motivo es
   * `merma` porque el plato salió de una línea de cuenta anulada. Nulo en
   * el resto — incluida una merma que no vino de anular nada.
   * Trazabilidad para la parte 3: une este movimiento con su fila de
   * `cuenta_linea_anulaciones`.
   */
  @Column({ name: 'cuenta_linea_anulacion_id', type: 'uuid', nullable: true })
  cuentaLineaAnulacionId: string | null;

  @Column({ name: 'motivo_diferencia_id', type: 'uuid', nullable: true })
  motivoDiferenciaId: string | null;

  /**
   * El documento interno que generó este movimiento. Nulo salvo en los dos
   * movimientos de un traslado, que comparten el mismo valor: es lo que
   * permite reconstruir "estos 5 kg salieron de acá y entraron allá" a
   * partir del kardex.
   */
  @Column({ name: 'traslado_id', type: 'uuid', nullable: true })
  trasladoId: string | null;

  /**
   * La línea de compra que generó este movimiento: su entrada original, las
   * diferencias de una corrección de cantidad, la salida de una anulación y las
   * `correccion_compra` de costo. Nulo en todo lo demás, incluida la entrada
   * `compra` del atajo del ajuste de stock, que no tiene documento.
   */
  @Column({ name: 'compra_linea_id', type: 'uuid', nullable: true })
  compraLineaId: string | null;

  /**
   * El orden REAL en que se aplicaron los movimientos. `creado_el` no sirve para
   * eso: es la hora en que EMPEZÓ la transacción, y dos que compiten por el lock
   * del mismo producto pueden aplicarse en el orden inverso. La secuencia se toma
   * en el `INSERT`, que corre con el lock de `item_producto` ya tomado, así que
   * sobre un mismo producto respeta el orden de aplicación. La usa "rehacer la
   * cuenta" (spec compras-recepcion § 4.3).
   */
  @Column({ type: 'bigint' })
  @Generated('increment')
  secuencia: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
