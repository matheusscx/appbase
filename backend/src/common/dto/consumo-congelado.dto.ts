/**
 * **Lo que un plato consume, congelado al pedirlo** (owner, 2026-09-29): la
 * rebanada del catálogo que la expansión de una línea de cuenta lee para
 * descontar stock. Anular el plato con un motivo que descuenta, y cobrar la
 * cuenta, leen esto en vez del catálogo de hoy: si después alguien edita la
 * receta, cambia un componente del combo o saca una opción del grupo y la
 * borra, la mesa igual consume lo que pidió. Es la misma idea que el precio y
 * las reglas congeladas de la línea.
 *
 * Se congela **la forma del catálogo y no el consumo ya multiplicado** a
 * propósito: la expansión necesita la estructura para decidir quién frena a
 * quién (bloqueante o no), qué componente de un combo no se sirvió y en qué
 * orden se bloquea. Un consumo plano perdería eso, y el cobro lo usa.
 *
 * Vive en `common/` por lo mismo que `ReglasCongeladas`: lo comparten la
 * entidad que lo persiste (`cuenta_lineas`), el service que lo produce
 * (`ItemsService.congelarConsumos`) y los que lo leen (salones, ventas).
 *
 * Spec: `docs/superpowers/specs/2026-10-11-consumo-congelado-linea-cuenta-design.md`.
 */
export interface IngredienteCongelado {
  ingredienteItemId: string;
  ingredienteNombre: string;
  /** Unidad de stock del ingrediente (`item_producto.unidad_medida`). */
  ingredienteUnidadMedida: string;
  /** Por UNA unidad de la receta, en `unidadCodigo`. */
  cantidad: string;
  unidadCodigo: string;
  bloqueante: boolean;
}

export interface ComponenteCongelado {
  componenteItemId: string;
  nombre: string;
  tipo: string;
  /** Por UNA unidad del combo. */
  cantidad: string;
  bloqueante: boolean;
  /** `null` para una receta o un servicio: no tienen fila en `item_producto`. */
  unidadMedida: string | null;
}

export interface ItemCongelado {
  tipo: string;
  nombre: string;
  unidadMedida: string | null;
}

export interface ConsumoCongelado {
  /**
   * Ingredientes de cada receta que la expansión de la línea recorre: el plato
   * mismo, sus componentes receta y sus opciones de grupo que son receta.
   */
  recetas: Record<string, IngredienteCongelado[]>;
  /** Componentes del combo, ordenados por id. `[]` si la línea es una receta. */
  componentes: ComponenteCongelado[];
  /** Cada extra y cada opción de grupo elegidos, por id. */
  items: Record<string, ItemCongelado>;
}
