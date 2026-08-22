import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import { EscalaMonedaPipe } from './escala-moneda.pipe';
import { RequestContext } from '../context/request-context';
import { EsCosto, EsMontoCobrado } from '../decorators/escala-moneda.decorator';
import { type MonedasService } from '../../modules/monedas/monedas.service';

class DtoDeMonto {
  @EsMontoCobrado()
  monto: string;
}

class DtoDeCosto {
  @EsCosto()
  costoUnitario: string;
}

class DtoSinMarcas {
  monto: string;
}

class LineaDePago {
  @EsMontoCobrado()
  monto: string;
}

class DtoConLineas {
  pagos: LineaDePago[];
}

const meta = (metatype: unknown): ArgumentMetadata =>
  ({ type: 'body', metatype, data: undefined }) as ArgumentMetadata;

/**
 * El pipe es **singleton** y lee el usuario del `RequestContext`, así que un
 * test tiene que decir dónde empieza y termina cada request — antes eso lo daba
 * el `Scope.REQUEST` gratis.
 *
 * `pipe.transform(...)` = **un request**, con store propio (que es lo que hace
 * el interceptor global). Para varias llamadas dentro del MISMO request está
 * `enRequest(fn)`, que es donde se ve el memo.
 */
function armar(decimales: number) {
  const decimalesOficiales = jest.fn().mockResolvedValue(decimales);
  const monedas = { decimalesOficiales } as unknown as MonedasService;
  const request = {
    user: {
      id: 'u-1',
      email: 'cajero@tenant.cl',
      tenantId: 'tenant-1',
      esSuperadmin: false,
    },
  };
  const contexto = new RequestContext();
  const real = new EscalaMonedaPipe(monedas, contexto);

  const enRequest = <T>(fn: () => Promise<T>): Promise<T> =>
    contexto.correrCon({ user: request.user }, fn);

  const pipe = {
    transform: (valor: unknown, meta: ArgumentMetadata): Promise<unknown> =>
      enRequest(() => real.transform(valor, meta)),
  };

  return { pipe, real, contexto, enRequest, decimalesOficiales, request };
}

const linea = (monto: string): LineaDePago =>
  Object.assign(new LineaDePago(), { monto });

describe('EscalaMonedaPipe', () => {
  it('rechaza un monto con más decimales de los que la moneda admite', async () => {
    const { pipe } = armar(0); // CLP

    await expect(
      pipe.transform({ monto: '1000.5' }, meta(DtoDeMonto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('acepta un entero escrito con ceros a la derecha', async () => {
    // La regla es sobre el VALOR, no sobre la cadena: mil pesos es
    // representable en CLP, y el formato con que se escribió no lo cambia.
    const { pipe } = armar(0); // CLP

    await expect(
      pipe.transform({ monto: '1000.00' }, meta(DtoDeMonto)),
    ).resolves.toEqual({ monto: '1000.00' });
  });

  it('acepta dos decimales en una moneda de dos decimales', async () => {
    const { pipe } = armar(2); // USD

    await expect(
      pipe.transform({ monto: '10.55' }, meta(DtoDeMonto)),
    ).resolves.toEqual({ monto: '10.55' });
  });

  it('valida un costo contra la escala 4, no contra la de la moneda', async () => {
    const { pipe, decimalesOficiales } = armar(0); // CLP: 0 decimales

    // '5.0001' tiene cuatro decimales REALES: es el caso que separa la escala 4
    // de cualquier otra. '5.0000' no serviría — Decimal lo normaliza a cero
    // decimales, así que pasaría también con la escala en 0, 1, 2 o 3 y el test
    // no fijaría nada.
    await expect(
      pipe.transform({ costoUnitario: '5.0001' }, meta(DtoDeCosto)),
    ).resolves.toEqual({ costoUnitario: '5.0001' });
    await expect(
      pipe.transform({ costoUnitario: '5.00001' }, meta(DtoDeCosto)),
    ).rejects.toThrow(BadRequestException);
    // La escala del costo es fija: ni siquiera pregunta por la moneda.
    expect(decimalesOficiales).not.toHaveBeenCalled();
  });

  it('no le echa la culpa a la moneda cuando el que se pasa es un costo', async () => {
    const { pipe } = armar(0);

    // El 4 no es la escala de la moneda (en CLP es 0): es la escala fija de los
    // costos. Un 400 que dijera "la moneda" mandaría a mirar la configuración
    // del tenant por un límite que no depende de ella.
    await expect(
      pipe.transform({ costoUnitario: '5.00001' }, meta(DtoDeCosto)),
    ).rejects.toThrow(/costos y tasas/);
  });

  it('vuelve a preguntar los decimales si cambia el tenant', async () => {
    // El memo se guarda con la clave del tenant, no suelto en la instancia. Hoy
    // el scope request hace que una instancia vea un solo tenant, pero entonces
    // la corrección de la caché dependería enteramente de ese scope: al que le
    // saquen el `Scope.REQUEST` para no pagar el controller request-scoped, los
    // decimales del primer tenant le empezarían a servir a todos los demás, en
    // silencio y sobre plata.
    const { pipe, decimalesOficiales, request } = armar(0);
    decimalesOficiales.mockImplementation((tenantId: string) =>
      Promise.resolve(tenantId === 'tenant-clp' ? 0 : 2),
    );

    request.user.tenantId = 'tenant-clp';
    await expect(
      pipe.transform({ monto: '10.55' }, meta(DtoDeMonto)),
    ).rejects.toThrow(BadRequestException);

    request.user.tenantId = 'tenant-usd';
    await expect(
      pipe.transform({ monto: '10.55' }, meta(DtoDeMonto)),
    ).resolves.toEqual({ monto: '10.55' });

    expect(decimalesOficiales).toHaveBeenNthCalledWith(1, 'tenant-clp');
    expect(decimalesOficiales).toHaveBeenNthCalledWith(2, 'tenant-usd');
  });

  it('deja pasar un valor que no es un número, en vez de romperse', async () => {
    // Rama load-bearing y no cosmética: `precioExtra` usa el string VACÍO como
    // "no tocar este override" —`items/dto/create-item.dto.ts` y
    // `grupos-modificadores/dto/aplicar-overrides.dto.ts`, los dos con
    // `@ValidateIf(o => o.precioExtra !== '')`— y el pipe NO lee `@ValidateIf`:
    // el vacío le llega igual. Lo salva el `catch` de `new Decimal('')`. Si esa
    // rama pasara a tirar, se caerían los overrides en producción con un 500 y
    // ningún otro test lo diría: los dos casos que mandan `''` van por
    // `validate()`, que no ejerce el pipe.
    const { pipe } = armar(0); // CLP

    await expect(
      pipe.transform({ monto: '' }, meta(DtoDeMonto)),
    ).resolves.toEqual({ monto: '' });
    await expect(
      pipe.transform({ costoUnitario: 'no-es-un-numero' }, meta(DtoDeCosto)),
    ).resolves.toEqual({ costoUnitario: 'no-es-un-numero' });
  });

  it('deja pasar intacto un DTO sin campos marcados', async () => {
    const { pipe, decimalesOficiales } = armar(0);

    await expect(
      pipe.transform({ monto: '1000.5' }, meta(DtoSinMarcas)),
    ).resolves.toEqual({ monto: '1000.5' });
    expect(decimalesOficiales).not.toHaveBeenCalled();
  });

  it('alcanza los campos marcados dentro de listas anidadas', async () => {
    const { pipe } = armar(0); // CLP
    const dto = Object.assign(new DtoConLineas(), {
      pagos: [linea('1000'), linea('500.5')],
    });

    await expect(pipe.transform(dto, meta(DtoConLineas))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('pregunta los decimales de la moneda una sola vez por request', async () => {
    const { real, enRequest, decimalesOficiales } = armar(0);
    const dto = Object.assign(new DtoConLineas(), {
      pagos: [linea('1000'), linea('2000'), linea('3000')],
    });

    // Las dos llamadas dentro del MISMO request: es el caso que el memo cubre.
    await enRequest(async () => {
      await real.transform(dto, meta(DtoConLineas));
      await real.transform({ monto: '10' }, meta(DtoDeMonto));
    });

    expect(decimalesOficiales).toHaveBeenCalledTimes(1);
    expect(decimalesOficiales).toHaveBeenCalledWith('tenant-1');
  });

  /**
   * El peligro que un memo de instancia SÍ produce, y que la concurrencia no
   * alcanza a mostrar: **quedarse pegado**. Con el pipe singleton, un memo en la
   * instancia —aunque lleve la clave del tenant— cachea para siempre, así que un
   * tenant que cambia la moneda oficial de su configuración seguiría validando
   * con la escala vieja hasta que alguien reinicie el proceso. Sobre plata.
   *
   * El memo vive en el store del request justamente para que su vida sea la del
   * request. Este test lo fija: dos requests del MISMO tenant preguntan dos
   * veces.
   */
  it('el memo no sobrevive al request: el siguiente vuelve a preguntar', async () => {
    const { pipe, decimalesOficiales } = armar(0);

    await pipe.transform({ monto: '10' }, meta(DtoDeMonto));
    await pipe.transform({ monto: '20' }, meta(DtoDeMonto));

    expect(decimalesOficiales).toHaveBeenCalledTimes(2);
  });

  /**
   * La propiedad que sostiene todo lo demás: el pipe es **una sola instancia**
   * para todos los requests, así que si el memo se le escapara a la instancia,
   * dos tenants concurrentes se pisarían y uno validaría su plata con la escala
   * del otro. Se mide con requests **entrelazados**, no secuenciales: uno abre
   * su contexto, cede el control, y recién después valida.
   */
  it('dos requests concurrentes de tenants distintos no se pisan', async () => {
    const { real, contexto, decimalesOficiales } = armar(0);
    decimalesOficiales.mockImplementation((tenantId: string) =>
      Promise.resolve(tenantId === 'tenant-clp' ? 0 : 2),
    );

    const usuario = (tenantId: string) => ({
      id: 'u-1',
      email: 'x@y.cl',
      tenantId,
      esSuperadmin: false,
    });

    const enCurso = (tenantId: string, monto: string) =>
      contexto.correrCon({ user: usuario(tenantId) }, async () => {
        // Cede el turno DESPUÉS de abrir el contexto: si el store se compartiera
        // entre requests, acá es donde se rompería.
        await new Promise((r) => setTimeout(r, 0));
        return real.transform({ monto }, meta(DtoDeMonto));
      });

    const [clp, usd] = await Promise.allSettled([
      enCurso('tenant-clp', '10.55'),
      enCurso('tenant-usd', '10.55'),
    ]);

    // CLP no admite decimales → rechaza. USD sí → pasa. Cada uno con SU escala.
    expect(clp.status).toBe('rejected');
    expect(usd.status).toBe('fulfilled');
  });

  it('LIMITACIÓN CONOCIDA: un anidado sin @Type() no se valida', async () => {
    // El recorrido reconoce al hijo por su `constructor`. Sin `@Type()`, el
    // ValidationPipe global no lo convierte en instancia de su clase: queda
    // como objeto plano, su constructor es Object y las marcas no corren.
    // Queda fijado acá, en verde y a la vista, porque el peor modo de falla de
    // un validador es no ejecutarse en silencio: si mañana alguien marca un DTO
    // anidado y se olvida del @Type(), este test dice dónde mirar.
    const { pipe, decimalesOficiales } = armar(0); // CLP
    const dto = Object.assign(new DtoConLineas(), {
      pagos: [{ monto: '500.5' }], // objeto plano, NO una LineaDePago
    });

    await expect(pipe.transform(dto, meta(DtoConLineas))).resolves.toBe(dto);
    expect(decimalesOficiales).not.toHaveBeenCalled();
  });

  it('no se cae con un objeto libre que trae la llave "constructor"', async () => {
    // `Reflect.getMetadata` tira TypeError si el target no es un objeto, y el
    // cliente elige las llaves de los campos `@IsObject()` libres (que
    // `whitelist: true` no limpia por dentro — p. ej. `configuracion` en
    // pasarela/dto/create-tenant-pasarela.dto.ts:23). Sin blindaje, ese body
    // convierte un 400 en un 500.
    const { pipe } = armar(0);
    const dto = {
      configuracion: JSON.parse('{"constructor": "x"}') as unknown,
    };

    await expect(pipe.transform(dto, meta(DtoSinMarcas))).resolves.toBe(dto);
  });

  it('corta con 400 un anidamiento más profundo del que inspecciona', async () => {
    // La recursión baja sincrónicamente y la profundidad la elige el cliente:
    // con el límite de body por defecto entran decenas de miles de niveles, y
    // eso es un RangeError —un 500— en vez de un rechazo. Se corta con 400
    // explícito: quedarse callado sería no validar sin avisar.
    const { pipe } = armar(0);
    let hondo: Record<string, unknown> = { monto: '1000' };
    for (let i = 0; i < 40; i++) hondo = { anidado: hondo };

    await expect(pipe.transform(hondo, meta(DtoSinMarcas))).rejects.toThrow(
      BadRequestException,
    );
  });
});
