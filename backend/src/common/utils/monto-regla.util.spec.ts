import { BadRequestException } from '@nestjs/common';
import {
  validarMontosDeRegla,
  validarMinimosDeTramos,
} from './monto-regla.util';

describe('validarMontosDeRegla', () => {
  describe('el valor plano', () => {
    it('acepta un porcentaje en decimal', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorPorcentaje: '0.10' }),
      ).not.toThrow();
    });

    it('rechaza un porcentaje >= 1', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorPorcentaje: '50' }),
      ).toThrow(BadRequestException);
    });

    it('acepta el mismo número como monto fijo', () => {
      // Lo que decide ya no es el modo leyendo un valor ambiguo: es la COLUMNA
      // en la que vino. `50` en `valorMonto` son cincuenta pesos y nada más.
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: '50' }),
      ).not.toThrow();
    });

    it.each(['0', '-1', 'abc'])('rechaza %s', (valor) => {
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: valor }),
      ).toThrow(BadRequestException);
    });

    it.each([null, undefined, ''])(
      'un valor ausente (%p) no es error: qué tipo lo exige lo decide el service',
      (valor) => {
        expect(() =>
          validarMontosDeRegla('porcentaje', { valorPorcentaje: valor }),
        ).not.toThrow();
      },
    );

    it('no acepta un objeto vacío como error: la regla por tramos no trae valor plano', () => {
      expect(() => validarMontosDeRegla('porcentaje', {})).not.toThrow();
    });
  });

  describe('la unidad la dice la columna, no el modo', () => {
    it('rechaza que vengan las dos columnas a la vez', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', {
          valorMonto: '1000',
          valorPorcentaje: '0.10',
        }),
      ).toThrow(/una sola unidad/);
    });

    it('rechaza la columna que no corresponde al modo', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorMonto: '1000' }),
      ).toThrow(/valorPorcentaje/);
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorPorcentaje: '0.10' }),
      ).toThrow(/valorMonto/);
    });

    it('un monto fijo grande es válido y NO se lee como porcentaje', () => {
      // El bug que este cambio mata: `5000` como monto es plata; leído como
      // tasa habría sido 500.000%. Ahora ni siquiera es expresable.
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: '5000' }),
      ).not.toThrow();
    });
  });

  describe('los tramos', () => {
    // El caso que originó la extracción: la validación existía y no alcanzaba
    // a los tramos, así que un "50%" cargado como 50 producía un 5000%.
    it('rechaza un tramo en porcentaje con valor >= 1', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', {}, [
          { valorPorcentaje: '0.10' },
          { valorPorcentaje: '50' },
        ]),
      ).toThrow(/decimal/);
    });

    it('el mismo número en la columna de monto es válido', () => {
      // Antes esto se expresaba como "los mismos tramos con otro modo pasan".
      // Ahora no hay reinterpretación: es otra columna, es otro dato.
      expect(() =>
        validarMontosDeRegla('monto_fijo', {}, [
          { valorMonto: '0.10' },
          { valorMonto: '50' },
        ]),
      ).not.toThrow();
    });

    it('rechaza un tramo en 0 o negativo', () => {
      expect(() =>
        validarMontosDeRegla('monto_fijo', {}, [{ valorMonto: '-5' }]),
      ).toThrow(/mayor a 0/);
    });

    it('rechaza un tramo cuya columna no corresponde al modo de la regla', () => {
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: '100' }, [
          { valorPorcentaje: '0.10' },
        ]),
      ).toThrow(/valorMonto/);
    });

    it('sin tramos, o con la lista vacía, no pasa nada', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorPorcentaje: '0.10' }),
      ).not.toThrow();
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorPorcentaje: '0.10' }, []),
      ).not.toThrow();
    });

    it('un tramo SIN importe es error, y esto no era así antes', () => {
      // Hasta que el `valor` se partió en dos, esto lo tapaba el DTO: `valor`
      // era obligatorio en `TramoDto`. Los dos campos nuevos son por fuerza
      // opcionales —cuál corresponde depende del hermano `modo`—, así que sin
      // este chequeo un tramo vacío llegaba al CHECK de tabla y salía un 500.
      expect(() => validarMontosDeRegla('porcentaje', {}, [{}])).toThrow(
        /tiene que expresar su importe/,
      );
      expect(() =>
        validarMontosDeRegla('porcentaje', {}, [{ valorPorcentaje: null }]),
      ).toThrow(/tiene que expresar su importe/);
      expect(() => validarMontosDeRegla('monto_fijo', {}, [{}])).toThrow(
        /valorMonto/,
      );
    });
  });
});

describe('validarMinimosDeTramos', () => {
  it('por_mayor exige el mínimo en cantidad y rechaza el de monto', () => {
    expect(() =>
      validarMinimosDeTramos('por_mayor', [{ minimoCantidad: '10' }]),
    ).not.toThrow();
    expect(() =>
      validarMinimosDeTramos('por_mayor', [{ minimoMonto: '10' }]),
    ).toThrow(/minimoCantidad/);
  });

  it('el resto de los tipos exige el mínimo en monto y rechaza el de cantidad', () => {
    // La negativa es la que caza el mutante: si la lista de códigos por
    // cantidad se ensanchara —o si el chequeo se invirtiera— este tipo pasaría
    // a aceptar un umbral en unidades sin que ningún otro test se entere.
    expect(() =>
      validarMinimosDeTramos('por_monto_venta', [{ minimoMonto: '100000' }]),
    ).not.toThrow();
    expect(() =>
      validarMinimosDeTramos('por_monto_venta', [{ minimoCantidad: '100000' }]),
    ).toThrow(/minimoMonto/);
  });

  it('las dos columnas a la vez es error, en cualquier tipo', () => {
    expect(() =>
      validarMinimosDeTramos('por_mayor', [
        { minimoCantidad: '10', minimoMonto: '10' },
      ]),
    ).toThrow(BadRequestException);
  });

  it('un tramo SIN mínimo es error, y el mensaje nombra la columna del tipo', () => {
    // Mismo hueco que tenía el importe: los dos campos son opcionales en el
    // DTO —cuál corresponde depende del tipo, que un decorador no puede leer—,
    // así que sin este chequeo un tramo sin mínimo llegaría al CHECK de tabla
    // y saldría un 500 de Postgres en vez del 400 que corresponde.
    expect(() => validarMinimosDeTramos('por_mayor', [{}])).toThrow(
      /minimoCantidad/,
    );
    expect(() => validarMinimosDeTramos('por_monto_venta', [{}])).toThrow(
      /minimoMonto/,
    );
    expect(() =>
      validarMinimosDeTramos('por_monto_venta', [{ minimoMonto: null }]),
    ).toThrow(/minimoMonto/);
  });

  it('el cero es un mínimo legítimo: "desde cero"', () => {
    // El seed tiene un recargo que arranca justo en 0 ("bajo $20.000 recarga
    // $2.000"), así que esto protege un caso real del producto.
    // ⚠️ Este test NO distingue `!!valor` de un chequeo contra null/undefined/'':
    // se probó con el mutante y los dos pasan, porque `'0'` es truthy COMO
    // STRING. Fija la conducta, no la forma.
    expect(() =>
      validarMinimosDeTramos('por_monto_venta', [{ minimoMonto: '0' }]),
    ).not.toThrow();
  });

  it('un mínimo negativo es error', () => {
    expect(() =>
      validarMinimosDeTramos('por_monto_venta', [{ minimoMonto: '-1' }]),
    ).toThrow(/mayor o igual a 0/);
  });

  it('con `codigo` null valida la forma pero NO la columna del tipo', () => {
    // El caso que lo hizo falta: un PATCH que cambia el tipo a uno SIN tramos
    // deja huérfanos los guardados. Exigirles la columna de un tipo que no mide
    // nada rechazaba un PATCH legítimo (lo cazó el e2e `ancla positiva`).
    expect(() =>
      validarMinimosDeTramos(null, [{ minimoCantidad: '10' }]),
    ).not.toThrow();
    expect(() =>
      validarMinimosDeTramos(null, [{ minimoMonto: '10' }]),
    ).not.toThrow();

    // Pero la FORMA se sigue exigiendo: es lo que evita que un tramo inválido
    // llegue al CHECK de tabla y salga un 500 de Postgres en vez de un 400.
    expect(() => validarMinimosDeTramos(null, [{}])).toThrow(
      /tiene que expresar su mínimo/,
    );
    expect(() =>
      validarMinimosDeTramos(null, [
        { minimoCantidad: '10', minimoMonto: '10' },
      ]),
    ).toThrow(/una sola unidad/);
    expect(() => validarMinimosDeTramos(null, [{ minimoMonto: '-1' }])).toThrow(
      /mayor o igual a 0/,
    );
  });

  it('mezclar unidades entre tramos de una regla es error, incluso con codigo null', () => {
    // Medido antes de cerrarlo: un POST a un tipo SIN tramos (`directo`) con un
    // tramo en cantidad y otro en monto entraba con 201. El motor los evalúa
    // igual —ramifica por `tramos.length` antes que por el código— y entonces
    // `seleccionarTramo` comparaba "500 unidades" contra "$100" para decidir
    // cuál gana, que no significa nada.
    expect(() =>
      validarMinimosDeTramos(null, [
        { minimoCantidad: '500' },
        { minimoMonto: '100' },
      ]),
    ).toThrow(/miden lo mismo/);
    expect(() =>
      validarMinimosDeTramos('por_mayor', [
        { minimoCantidad: '500' },
        { minimoCantidad: '100' },
      ]),
    ).not.toThrow();
  });

  it('sin tramos no hay nada que validar', () => {
    expect(() => validarMinimosDeTramos('directo')).not.toThrow();
    expect(() => validarMinimosDeTramos('directo', [])).not.toThrow();
  });
});
