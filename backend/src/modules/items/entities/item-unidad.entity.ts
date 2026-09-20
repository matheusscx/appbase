import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Los blancos que **no cuentan en los bordes** de una serie, como literal de
 * Postgres: espacio, tab, LF, CR, form feed, tab vertical y NBSP.
 *
 * ⚠️ Están enumerados uno por uno, y no es pereza: **`btrim(serie)` sin lista
 * recorta solo el espacio ASCII**. Medido contra Postgres: con `ABC123` viva,
 * `\tABC123\t` NO colisionaba y entraba como una segunda unidad — el mismo
 * duplicado silencioso que este invariante existe para cerrar, entrando por un
 * borde que no es el espacio. Lo levantó la revisión de seguridad.
 *
 * La alternativa —`regexp_replace` con `[[:space:]]`— **depende de la collation
 * de la base**, y un índice cuya semántica cambia entre el Postgres local y el de
 * Railway es peor que uno estrecho: la lista explícita es determinística.
 *
 * El NBSP entra porque llega pegando desde una página o un Excel, que es el
 * camino real por el que aparece.
 *
 * 📌 **El borde declarado:** los espacios Unicode exóticos (U+2000–U+200A,
 * U+3000, …) NO están, a propósito — no salen de un teclado ni de un lector de
 * códigos. Si alguien pega uno **al borde**, esa serie se trata como distinta. Lo
 * que no puede pasar es una serie que sea SOLO blancos: el `@Matches(/\S/)` de
 * las tres DTO usa el `\s` de JS, que sí los cubre todos.
 */
const BLANCOS_DE_BORDE = String.raw`E' \t\n\r\f\x0b\u00a0'`;

/**
 * La serie normalizada **para comparar**, en SQL: la forma que indexa
 * `uq_unidad_item_serie` y la misma que usa el guard de
 * `InventarioService.assertSeriesLibres`.
 *
 * Vive en un solo lugar a propósito, y es una excepción deliberada al "duplicar
 * dos veces es aceptable" de `CLAUDE.md`: son dos SQL escritas a mano —una en el
 * seeder, otra en el service— que tienen que ser **idénticas** o el guard deja
 * pasar lo que el índice rechaza, y eso no se ve al escribirlo: vuelve como un
 * 500. El criterio de duplicar vale para código que, si deriva, alguien nota.
 */
export const serieNormalizadaSql = (columna: string): string =>
  `lower(btrim(${columna}, ${BLANCOS_DE_BORDE}))`;

@Entity('item_unidad')
// ⚠️ **El índice único de `serie` NO se declara acá**, y la razón es la regla:
// la serie es única por producto **comparada sin espacios de los bordes y sin
// distinguir mayúsculas** —`ABC123` y `abc123 ` son la misma— (owner,
// 2026-09-20). Eso es un índice **sobre una expresión**,
// `(item_id, lower(btrim(serie, <blancos>)))` —ver `serieNormalizadaSql` acá
// arriba—, y **TypeORM no sabe expresar una función en
// `@Index`**: declarado acá, `synchronize` crearía uno sobre la columna pelada,
// que acepta `ABC123` y `abc123` como dos series distintas. O sea, el índice
// equivocado, que es justo el modo de falla que ya pasó con los nombres únicos.
//
// Lo crea `SeederService.seedItemUnidadSerieIndex()` con SQL cruda, mismo molde
// que `seedPromocionesIndices()` y `seedGruposModificadores()`. Contrapartida
// conocida y aceptada de ese molde: en dev, `synchronize` puede dejar la tabla
// SIN el índice hasta que el seeder lo recree, así que la red del lado de la
// base depende de que el seeder corra y no falle.
//
// Entre el 2026-09-19 y el 2026-09-20 sí vivió acá, como `@Index` de columnas
// peladas: era la regla anterior —unicidad exacta—, que el owner cambió.
//
// El 400 que nombra la serie repetida lo da `InventarioService.moverSerie`, el
// único lugar que inserta unidades, comparando con la MISMA normalización.
export class ItemUnidad {
  @PrimaryGeneratedColumn('uuid', { name: 'unidad_id' })
  unidadId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'lote_id', type: 'uuid', nullable: true })
  loteId: string | null;

  @Column({ type: 'text' })
  serie: string;

  @Column({ type: 'text', default: 'disponible' })
  estado: string; // 'disponible' | 'reservado' | 'vendido' | 'baja'

  @Column({ type: 'text', default: 'nuevo' })
  condicion: string; // 'nuevo' | 'usado' | 'reacondicionado'

  @Column({ name: 'garantia_hasta', type: 'timestamptz', nullable: true })
  garantiaHasta: Date | null;

  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  /** Dónde está físicamente esta unidad. Una unidad está en un solo lugar. */
  @Column({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
