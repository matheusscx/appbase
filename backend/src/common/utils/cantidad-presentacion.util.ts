import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';

export type UnidadCat = { codigo: string; magnitud: string; factorBase: string };

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
