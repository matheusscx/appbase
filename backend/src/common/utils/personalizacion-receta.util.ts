import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import type { PersonalizacionRecetaSnapshot } from '../dto/personalizacion-receta.dto';

export type { PersonalizacionRecetaSnapshot };

export function hashPersonalizacion(
  p: PersonalizacionRecetaSnapshot | null | undefined,
): string {
  const normalized = p ?? { omitidos: [], extras: [] };
  const canonical = {
    omitidos: [...normalized.omitidos].sort(),
    extras: [...normalized.extras]
      .map((e) => ({ ...e, unidades: e.unidades ?? '1' }))
      .sort((a, b) => a.ingredienteItemId.localeCompare(b.ingredienteItemId)),
    ...(normalized.comentario !== undefined
      ? { comentario: normalized.comentario }
      : {}),
    // Dos combos/recetas con distinta opción de grupo elegida (p. ej. bebida
    // distinta) nunca deben fusionarse en la misma línea de cuenta.
    grupos: [...(normalized.grupos ?? [])]
      .map((g) => ({
        grupoId: g.grupoId,
        opciones: [...g.opciones]
          .map((o) => ({
            itemId: o.itemId,
            unidades: o.unidades ?? '1',
            // El precio de la opción distingue selecciones (igual que en extras):
            // dos opciones iguales a distinto precio no deben fusionarse en la línea.
            precioExtra: o.precioExtra ?? '0',
          }))
          .sort((a, b) => a.itemId.localeCompare(b.itemId)),
      }))
      .sort((a, b) => a.grupoId.localeCompare(b.grupoId)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Huella de las reglas de catálogo congeladas en una línea de cuenta. Es el
 * **tercer término** del criterio que decide si dos pedidos del mismo plato son
 * una línea de cantidad 2 o dos líneas — los otros dos son la personalización y
 * el precio unitario congelado.
 *
 * Lo que la escena del owner obliga a distinguir (2026-08-30): la mesa pide una
 * hamburguesa, sale un 20% en hamburguesas, pide otra — *"esa sí sale con el
 * descuento"*. El precio de lista **no se movió**, así que sin esta huella las
 * dos se fusionaban y la segunda perdía su descuento.
 *
 * ⚠️ **Serializa la regla ENTERA menos el nombre, y esa forma es deliberada.**
 * La primera versión elegía campos a mano y se dejó afuera `codigo` —la
 * estrategia de evaluación del motor—: cambiarle el tipo a un descuento de
 * `directo` a `pronto_pago` dejaba todos los demás campos idénticos, así que la
 * huella no se movía y dos líneas que valen distinto se fusionaban (medido por
 * API: la segunda se quedaba con un 20% que ya no le tocaba). Una lista blanca
 * de campos falla en silencio cada vez que el motor gana uno; el `rest` no.
 *
 * `nombre` es la única exclusión, y por el lado seguro: renombrar una regla no
 * mueve un peso, y si entrara, un rename partiría en dos una línea que el garzón
 * espera ver junta.
 *
 * **Nada que sea orden puede mover la huella**: se ordenan las claves de cada
 * objeto, las reglas por `id`, y **los elementos de todo array**. Lo último no
 * es teórico: `metodoPagoIds` sale de un `find` sin `ORDER BY`
 * (`descuentos.service.ts`), así que un `UPDATE` sobre su fila puente —el soft
 * delete y la restauración de papelera escriben ahí— la manda al final del heap
 * y el array vuelve al revés. Medido: la misma regla, con los mismos dos
 * métodos y los mismos valores, partía en dos una línea que debía ir junta.
 *
 * Tratar todo array como **conjunto** es deliberado y es lo que esta huella
 * puede prometer: en una regla congelada ningún array lleva significado en su
 * orden —ni los métodos de pago ni los tramos, que se evalúan por umbral—. Si
 * alguna vez se hashea algo donde el orden **sí** signifique, esta función no
 * sirve para eso.
 *
 * Un `null`/`undefined` cuenta como "sin reglas", igual que `hashPersonalizacion`
 * trata la personalización ausente.
 *
 * Es genérica y no toma la `ReglaResuelta` del motor porque este util vive en
 * `common/` y no puede importar de `modules/`. Lo único que le exige a una regla
 * es un `id` para ordenar.
 */
export function hashReglasCongeladas<T extends { id: string }>(
  r: { descuentos: T[]; recargos: T[] } | null | undefined,
): string {
  const canonizar = (reglas: T[] | undefined) =>
    [...(reglas ?? [])]
      .map((regla) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { nombre: _nombre, ...resto } = regla as T & { nombre?: unknown };
        return resto;
      })
      .sort((x, y) => x.id.localeCompare(y.id));
  return createHash('sha256')
    .update(
      estable({
        descuentos: canonizar(r?.descuentos),
        recargos: canonizar(r?.recargos),
      }),
    )
    .digest('hex');
}

/**
 * Serialización canónica: claves de objeto ordenadas y **elementos de array
 * ordenados por su propia forma canónica**, en profundidad. Las dos cosas por el
 * mismo motivo — nada que sea orden puede decidir si dos líneas se fusionan— y
 * la de los arrays con un caso medido detrás, ver `hashReglasCongeladas`.
 *
 * Una clave con valor `undefined` se **omite**, no se emite como `undefined`.
 * Eso alinea la huella de lo que está por guardarse con la de lo que vuelve de
 * la base: `jsonb` borra esas claves en el round-trip, así que emitirlas haría
 * que la huella fresca y la guardada no coincidieran nunca y nada volviera a
 * fusionarse.
 */
function estable(valor: unknown): string {
  if (valor === undefined) return 'null';
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) {
    return `[${valor.map(estable).sort().join(',')}]`;
  }
  const registro = valor as Record<string, unknown>;
  const entradas = Object.keys(registro)
    .filter((k) => registro[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${estable(registro[k])}`);
  return `{${entradas.join(',')}}`;
}

export function textoComandaPersonalizacion(
  p: PersonalizacionRecetaSnapshot | null | undefined,
  nombres: Map<string, string>,
): string {
  if (!p) return '';

  const partes: string[] = [];

  for (const id of p.omitidos) {
    partes.push(`Sin ${nombres.get(id) ?? id}`);
  }

  for (const extra of p.extras) {
    const nombre =
      nombres.get(extra.ingredienteItemId) ?? extra.ingredienteItemId;
    const unidades = Number(extra.unidades ?? '1');
    partes.push(
      unidades > 1 ? `Extra ${nombre} x${unidades}` : `Extra ${nombre}`,
    );
  }

  if (p.comentario) {
    partes.push(p.comentario);
  }

  return partes.join(' · ');
}

export interface PersonalizacionDetalleLinea {
  nombre: string;
  tipo: 'omitido' | 'extra';
  unidades?: number;
  monto: string;
}

/**
 * Detalle priceado de la personalización para boleta/precuenta (transparencia
 * ante reclamos): omitidos primero, siempre en $0 (nunca tienen costo);
 * extras después, con monto = precioExtra × unidades.
 */
export function detallePersonalizacion(
  p: PersonalizacionRecetaSnapshot | null | undefined,
  nombres: Map<string, string>,
): PersonalizacionDetalleLinea[] {
  if (!p) return [];

  const detalle: PersonalizacionDetalleLinea[] = [];

  for (const id of p.omitidos) {
    detalle.push({
      nombre: nombres.get(id) ?? id,
      tipo: 'omitido',
      monto: '0',
    });
  }

  for (const extra of p.extras) {
    const nombre =
      nombres.get(extra.ingredienteItemId) ?? extra.ingredienteItemId;
    const unidades = Number(extra.unidades ?? '1');
    const monto = new Decimal(extra.precioExtra || '0')
      .times(unidades)
      .toString();
    detalle.push({ nombre, tipo: 'extra', unidades, monto });
  }

  return detalle;
}
