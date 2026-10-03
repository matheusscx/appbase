import Decimal from 'decimal.js';

/**
 * El orden de la grilla de venta (`GET /items?orden=disponibilidad`). Es el que
 * calculaba `compararCatalogo` en `CatalogoGrid.vue` hasta el 2026-10-03, ahora en
 * el servidor: paginar con el orden en el cliente lo cambiaba de una página a la
 * otra. Spec: docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md § 3.2.
 */
const COLLATOR = new Intl.Collator('es');

export function esPedible(
  tipo: string,
  disponible: number | null | undefined,
  stockDisponible: string | null | undefined,
): boolean {
  if (tipo === 'receta' || tipo === 'combo') return (disponible ?? 1) > 0;
  if (tipo === 'producto' || tipo === 'ingrediente') {
    return (
      stockDisponible != null && new Decimal(stockDisponible).greaterThan(0)
    );
  }
  return false;
}

/**
 * Comparador sobre filas con `pedible` ya calculado (`esPedible` una vez por fila,
 * no una por comparación del sort: crea un `Decimal` cada vez).
 */
export function compararPorDisponibilidad(
  a: { item_id: string; nombre: string; pedible: boolean },
  b: { item_id: string; nombre: string; pedible: boolean },
): number {
  if (a.pedible !== b.pedible) return a.pedible ? -1 : 1;
  return (
    COLLATOR.compare(a.nombre, b.nombre) ||
    (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0)
  );
}
