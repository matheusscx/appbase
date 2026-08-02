import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';

export type UnidadCat = {
  codigo: string;
  magnitud: string;
  factorBase: string;
};

export function assertPresentacionPareada(
  cantidadPresentacion?: string | null,
  unidadCodigoPresentacion?: string | null,
): void {
  const tieneCantidad =
    cantidadPresentacion !== undefined &&
    cantidadPresentacion !== null &&
    cantidadPresentacion !== '';
  const tieneUnidad =
    unidadCodigoPresentacion !== undefined &&
    unidadCodigoPresentacion !== null &&
    unidadCodigoPresentacion !== '';

  if (tieneCantidad !== tieneUnidad) {
    throw new BadRequestException(
      'cantidadPresentacion y unidadCodigoPresentacion deben enviarse juntos o ninguno',
    );
  }
}

function buscarUnidad(
  catalogo: UnidadCat[],
  codigo: string,
): UnidadCat | undefined {
  return catalogo.find((u) => u.codigo === codigo);
}

function validarCantidadConteo(cantidad: string): void {
  let decimal: Decimal;
  try {
    decimal = new Decimal(cantidad);
  } catch {
    throw new BadRequestException('La cantidad de presentación no es válida');
  }

  if (!decimal.isInteger() || decimal.lessThan(1)) {
    throw new BadRequestException(
      'La cantidad de presentación debe ser un entero mayor o igual a 1',
    );
  }
}

/**
 * Los dos parámetros que `resolverCantidadDesdePresentacion` necesita del ítem:
 * contra qué unidad se convierte la presentación y si esa cantidad tiene que
 * ser un entero.
 *
 * `receta` y `combo` no tienen unidad de medida propia —solo `producto` e
 * `ingrediente` tienen fila en `item_producto`, que es de donde sale
 * `unidadMedida`—, así que se venden de a uno y en enteros: media receta o
 * 1,5 combos no son cantidades vendibles.
 *
 * Existe porque los tres carritos (venta, checkout online y salones) derivaban
 * esto por su cuenta y **habían divergido en el texto**: la venta contaba el
 * `combo` como conteo y los otros dos no.
 * ⚠️ Esa divergencia **no** cambiaba ningún resultado, verificado antes de
 * unificar: un combo no tiene fila en `item_producto`, así que el
 * `?? 'unidad'` daba la misma unidad base por el otro camino, y con base
 * `'unidad'` el resolver ya exige que la presentación sea de magnitud `conteo`
 * —es la única que matchea— y valida el entero igual, con `forzarConteo` o sin
 * él. Era duplicación cuya equivalencia dependía de dos invariantes de otro
 * archivo, no un bug con síntoma. Unificarla es lo que la vuelve verdad por
 * construcción.
 *
 * ⚠️ Gemela de `unidadBaseItem` en
 * `frontend/app/utils/cantidad-presentacion.ts`, que decide la unidad del
 * carrito: **la misma regla, duplicada** mientras backend y frontend no
 * compartan workspace. Cambiar una sin la otra abre una deriva silenciosa.
 */
export function resolverUnidadBaseDeItem(item: {
  tipo: string;
  unidadMedida?: string | null;
}): { unidadBaseCodigo: string; forzarConteo: boolean } {
  const seVendePorUnidadEntera =
    item.tipo === 'receta' || item.tipo === 'combo';
  return {
    unidadBaseCodigo: seVendePorUnidadEntera
      ? 'unidad'
      : (item.unidadMedida ?? 'unidad'),
    forzarConteo: seVendePorUnidadEntera,
  };
}

export function resolverCantidadDesdePresentacion(params: {
  cantidadPresentacion: string;
  unidadCodigoPresentacion: string;
  unidadBaseCodigo: string;
  catalogo: UnidadCat[];
  forzarConteo?: boolean;
}): {
  cantidadCanonica: string;
  cantidadPresentacion: string;
  unidadCodigoPresentacion: string;
} {
  const {
    cantidadPresentacion,
    unidadCodigoPresentacion,
    unidadBaseCodigo,
    catalogo,
    forzarConteo = false,
  } = params;

  const desde = buscarUnidad(catalogo, unidadCodigoPresentacion);
  if (!desde) {
    throw new BadRequestException(
      `Unidad de medida no reconocida: ${unidadCodigoPresentacion}`,
    );
  }

  const hacia = buscarUnidad(catalogo, unidadBaseCodigo);
  if (!hacia) {
    throw new BadRequestException(
      `Unidad de medida no reconocida: ${unidadBaseCodigo}`,
    );
  }

  if (desde.magnitud !== hacia.magnitud) {
    throw new BadRequestException(
      `No se puede convertir de ${desde.magnitud} a ${hacia.magnitud}`,
    );
  }

  if (forzarConteo || desde.magnitud === 'conteo') {
    validarCantidadConteo(cantidadPresentacion);
  }

  let cantidadCanonica: string;
  if (unidadCodigoPresentacion === unidadBaseCodigo) {
    cantidadCanonica = cantidadPresentacion;
  } else {
    const factorDesde = new Decimal(desde.factorBase);
    const factorHacia = new Decimal(hacia.factorBase);
    if (
      factorDesde.lessThanOrEqualTo(0) ||
      factorHacia.lessThanOrEqualTo(0) ||
      factorDesde.isNaN() ||
      factorHacia.isNaN()
    ) {
      throw new BadRequestException(
        'El factor de conversión de la unidad debe ser mayor a 0',
      );
    }

    let original: Decimal;
    try {
      original = new Decimal(cantidadPresentacion);
    } catch {
      throw new BadRequestException('La cantidad de presentación no es válida');
    }

    if (original.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'La cantidad de presentación debe ser mayor a 0',
      );
    }

    const convertida = original
      .mul(factorDesde)
      .div(factorHacia)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    if (convertida.isZero() && original.greaterThan(0)) {
      throw new BadRequestException(
        `La cantidad convertida (${original.toString()} ${unidadCodigoPresentacion} → ${unidadBaseCodigo}) es menor a la precisión de stock (4 decimales)`,
      );
    }

    cantidadCanonica = convertida.toString();
  }

  return {
    cantidadCanonica,
    cantidadPresentacion,
    unidadCodigoPresentacion,
  };
}
