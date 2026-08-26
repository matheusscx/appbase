import { BadRequestException } from '@nestjs/common';
import {
  validarMontosDeRegla,
  validarMinimosDeTramos,
  validarFormaDeImporte,
  validarValorUnico,
  validarSoloEscalones,
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

    it.each(['-1', 'abc'])('rechaza %s', (valor) => {
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: valor }),
      ).toThrow(BadRequestException);
    });

    it('rechaza 0, y desde el 2026-08-24 eso es una DECISIÓN, no un descarte', () => {
      // Sale del `it.each` de arriba a propósito: `-1` y `abc` se rechazan
      // porque no son un importe, y este `0` sí lo es. Lo que lo rechaza es
      // que una regla plana en 0 se aplicaría en cada venta sin cobrar nada,
      // que ya se dice pausándola —y pausada el POS *avisa*—. La asimetría con
      // el tramo (ver abajo) es todo el cambio, así que si alguien afloja el
      // piso para los dos, este test es el que tiene que frenarlo.
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: '0' }),
      ).toThrow(/mayor a 0/);
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

    it('un tramo SÍ puede valer cero: es "envío gratis sobre $30.000"', () => {
      // Decisión del owner (2026-08-24). Es la forma del caso más común y la
      // única disponible: los tramos son abiertos hacia arriba —no hay
      // `maximo`—, así que el escalón que no cobra se expresa poniéndolo en 0,
      // no acotando el de abajo.
      //
      // Este test también cubre que `validarTramo` no lo confunda con un tramo
      // SIN importe: `'0'` es truthy como string, y si dejara de serlo el cero
      // sería inexpresable igual, por el otro chequeo.
      expect(() =>
        validarMontosDeRegla('monto_fijo', {}, [
          { valorMonto: '2000' },
          { valorMonto: '0' },
        ]),
      ).not.toThrow();
    });

    it('y en porcentaje también: un 0% es un tramo que no descuenta', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', {}, [
          { valorPorcentaje: '0.10' },
          { valorPorcentaje: '0' },
        ]),
      ).not.toThrow();
    });

    it('pero un tramo negativo se sigue rechazando', () => {
      // El piso bajó de `> 0` a `>= 0`, no desapareció: ninguna regla aporta
      // una magnitud negativa —el signo lo pone el TIPO de regla, nunca el
      // valor—, así que un tramo en -5 no significa nada en ninguna lectura.
      expect(() =>
        validarMontosDeRegla('monto_fijo', {}, [{ valorMonto: '-5' }]),
      ).toThrow(/mayor o igual a 0/);
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

/**
 * Los tipos que admiten las dos formas de cobrar tienen que elegir una
 * (decisión del owner, 2026-08-25). Lo que sostiene esto no es cosmético:
 * `evaluarRegla` ramifica por `tramos.length > 0` antes de mirar el valor
 * plano, así que una fila con las dos llenas cobraría por escalones y dejaría
 * el valor único muerto sin aviso.
 */
describe('validarFormaDeImporte', () => {
  const tramo = [{ minimoMonto: '0', valorPorcentaje: '0.03' }];

  it('acepta valor único sin escalones', () => {
    expect(() => validarFormaDeImporte('0.03')).not.toThrow();
    expect(() => validarFormaDeImporte('0.03', [])).not.toThrow();
  });

  it('acepta escalones sin valor único', () => {
    expect(() => validarFormaDeImporte(null, tramo)).not.toThrow();
    expect(() => validarFormaDeImporte(undefined, tramo)).not.toThrow();
  });

  it('rechaza las dos juntas', () => {
    expect(() => validarFormaDeImporte('0.03', tramo)).toThrow(
      BadRequestException,
    );
  });

  it('rechaza ninguna de las dos', () => {
    expect(() => validarFormaDeImporte(null)).toThrow(BadRequestException);
    expect(() => validarFormaDeImporte(null, [])).toThrow(BadRequestException);
    expect(() => validarFormaDeImporte('')).toThrow(BadRequestException);
  });
});

/**
 * Los tipos que **no** eligen: cada uno tiene una sola forma posible y la otra
 * es un 400. Decisión del owner del 2026-08-25 —cerrar, no abrir—, tomada
 * sabiendo que la simétrica (los dos de método de pago, acá arriba) se había
 * abierto ese mismo día.
 *
 * Hasta el 2026-08-26 los **nueve** códigos que no eligen aceptaban las dos
 * formas juntas con 201 — los nueve ejecutados uno por uno con una sonda sobre
 * el harness de los service specs, antes y después del arreglo. El número se
 * escribe medido y no deducido por dos antecedentes: la entrada de backlog que
 * abrió este frente nombraba mal los tipos, y la primera redacción de la doc de
 * la feature dijo "seis", contando solo los que se habían sondeado hasta ahí.
 */
describe('validarValorUnico', () => {
  const tramo = [{ minimoMonto: '0', valorPorcentaje: '0.03' }];

  it('acepta el valor único solo', () => {
    expect(() => validarValorUnico('0.03')).not.toThrow();
    expect(() => validarValorUnico('0.03', [])).not.toThrow();
  });

  it('rechaza los escalones aunque el valor único venga', () => {
    expect(() => validarValorUnico('0.03', tramo)).toThrow(
      /no admite escalones/,
    );
  });

  // El orden de los dos chequeos importa y por eso tiene test propio: quien
  // manda escalones se entera de que este tipo no los admite, no de que "el
  // valor es requerido" —cierto, pero no es lo que hizo mal—.
  it('y lo dice también cuando el valor único falta', () => {
    expect(() => validarValorUnico(null, tramo)).toThrow(/no admite escalones/);
  });

  it('sigue exigiendo el valor único, con el texto que ya estaba en la API', () => {
    expect(() => validarValorUnico(null)).toThrow(
      'El valor es requerido para este tipo',
    );
    expect(() => validarValorUnico('')).toThrow(BadRequestException);
    expect(() => validarValorUnico(undefined, [])).toThrow(BadRequestException);
  });
});

/**
 * El dual. Ojo con el tamaño del daño que tapa, que es **menor**: para estos
 * tipos el valor plano nunca se leyó —el motor devuelve `SIN_VALOR` cuando
 * ningún escalón alcanza, no cae al valor plano—, así que lo que entraba era
 * un número decorativo, no una tasa que alguien creyera estar cobrando.
 */
describe('validarSoloEscalones', () => {
  it('acepta que no haya valor plano', () => {
    expect(() => validarSoloEscalones(null)).not.toThrow();
    expect(() => validarSoloEscalones(undefined)).not.toThrow();
    expect(() => validarSoloEscalones('')).not.toThrow();
  });

  it('rechaza el valor plano', () => {
    expect(() => validarSoloEscalones('0.50')).toThrow(
      /no admite un valor único/,
    );
  });
});
