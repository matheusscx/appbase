import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  PaquetesService,
  SELECT_PAQUETE_FILA,
  type PaqueteFilaRow,
} from './paquetes.service';

const TENANT = 't1';
const ID = 'p1';
const TERCERO = '11111111-1111-4111-8111-111111111111';

const filaSql = (cambios: Partial<PaqueteFilaRow> = {}): PaqueteFilaRow => ({
  id: ID,
  codigo: '461',
  destinatario_nombre: null,
  destinatario_telefono: null,
  direccion: null,
  comuna: null,
  nota: null,
  remitente_tercero_id: null,
  remitente_nombre: null,
  cobro_en_destino: false,
  tarifa_pago_id: null,
  tarifa_pago_nombre: null,
  tarifa_envio_id: null,
  tarifa_envio_nombre: null,
  estado: 'disponible',
  hoja_ruta_id: null,
  repartidor_nombre: null,
  bloqueado: false,
  ...cambios,
});

describe('PaquetesService', () => {
  const db = {
    query: jest.fn(),
    transaccion: jest.fn((cb: () => unknown) => cb()),
  };
  const tarifasMock = {
    exigirActivaDelTenant: jest.fn(),
    exigirDefecto: jest.fn(),
  };
  const envioMock = {
    exigirActivaDelTenant: jest.fn(),
    exigirDefecto: jest.fn(),
  };
  const service = new PaquetesService(
    db as never,
    tarifasMock as never,
    envioMock as never,
  );

  const sqlDe = (n: number) => db.query.mock.calls[n][0] as string;
  const paramsDe = (n: number) => db.query.mock.calls[n][1] as unknown[];

  beforeEach(() => {
    db.query.mockReset();
    db.transaccion.mockClear();
    tarifasMock.exigirActivaDelTenant.mockReset().mockResolvedValue(undefined);
    tarifasMock.exigirDefecto.mockReset().mockResolvedValue(undefined);
    envioMock.exigirActivaDelTenant.mockReset().mockResolvedValue(undefined);
    envioMock.exigirDefecto.mockReset().mockResolvedValue(undefined);
  });

  describe('SELECT_PAQUETE_FILA', () => {
    it('cada tabla unida filtra tenant y borrado', () => {
      for (const alias of ['t', 'tp', 'te', 'l', 'h', 'r']) {
        expect(SELECT_PAQUETE_FILA).toMatch(
          new RegExp(`${alias}\\.tenant_id = p\\.tenant_id`),
        );
        expect(SELECT_PAQUETE_FILA).toMatch(
          new RegExp(`${alias}\\.eliminado_el IS NULL`),
        );
      }
    });
  });

  describe('findAll', () => {
    it('filtra tenant y borrado, y devuelve la página con su meta', async () => {
      db.query.mockResolvedValueOnce([{ total: 31 }]);
      db.query.mockResolvedValueOnce([filaSql()]);
      const res = await service.findAll(TENANT, { page: 2, pageSize: 10 });
      expect(res.meta).toEqual({
        page: 2,
        pageSize: 10,
        total: 31,
        totalPages: 4,
      });
      expect(res.data).toHaveLength(1);
      expect(sqlDe(0)).toMatch(
        /p\.tenant_id = \$1 AND p\.eliminado_el IS NULL/,
      );
      expect(sqlDe(1)).toMatch(/ORDER BY p\.creado_el DESC/);
      expect(paramsDe(1)).toEqual([TENANT, 10, 10]);
    });

    it.each([
      [
        'en_ruta',
        { estado: 'en_ruta', hoja_ruta_id: 'h1', repartidor_nombre: 'Juan' },
        { estado: 'en_ruta', hojaRutaId: 'h1', repartidorNombre: 'Juan' },
      ],
      [
        'entregado',
        { estado: 'entregado', hoja_ruta_id: 'h1', bloqueado: false },
        { estado: 'entregado', hojaRutaId: 'h1', bloqueado: false },
      ],
      [
        'bloqueado',
        { estado: 'entregado', hoja_ruta_id: 'h1', bloqueado: true },
        { estado: 'entregado', bloqueado: true },
      ],
    ] as const)(
      'mapea la fila derivada %s a la respuesta',
      async (_n, sql, esperado) => {
        db.query.mockResolvedValueOnce([{ total: 1 }]);
        db.query.mockResolvedValueOnce([filaSql(sql)]);
        const res = await service.findAll(TENANT, {});
        expect(res.data[0]).toMatchObject(esperado);
      },
    );

    it('estado, cobro en destino y por completar se filtran en SQL', async () => {
      db.query.mockResolvedValueOnce([{ total: 0 }]);
      db.query.mockResolvedValueOnce([]);
      await service.findAll(TENANT, {
        estado: 'en_ruta',
        cobroEnDestino: 'true',
        porCompletar: 'true',
      });
      expect(sqlDe(0)).toContain("COALESCE(ruta.estado, 'disponible') = $2");
      expect(sqlDe(0)).toContain('p.cobro_en_destino = $3');
      expect(sqlDe(0)).toContain(
        '(p.direccion IS NULL OR p.destinatario_nombre IS NULL)',
      );
      expect(paramsDe(0)).toEqual([TENANT, 'en_ruta', true]);
    });

    it('q con el QR en JSON busca por el código normalizado', async () => {
      db.query.mockResolvedValueOnce([{ total: 0 }]);
      db.query.mockResolvedValueOnce([]);
      await service.findAll(TENANT, { q: ' {"id":"461"} ' });
      expect(paramsDe(0)).toEqual([TENANT, '461', '%461%']);
      expect(sqlDe(0)).toMatch(
        /p\.codigo = \$2 OR p\.codigo ILIKE \$3 OR p\.destinatario_nombre ILIKE \$3/,
      );
    });

    it('q escapa los comodines de LIKE', async () => {
      db.query.mockResolvedValueOnce([{ total: 0 }]);
      db.query.mockResolvedValueOnce([]);
      await service.findAll(TENANT, { q: '50%_x' });
      expect(paramsDe(0)).toEqual([TENANT, '50%_x', '%50\\%\\_x%']);
    });

    it('q vacío no filtra', async () => {
      db.query.mockResolvedValueOnce([{ total: 0 }]);
      db.query.mockResolvedValueOnce([]);
      await service.findAll(TENANT, { q: '   ' });
      expect(paramsDe(0)).toEqual([TENANT]);
    });
  });

  describe('filaPorId', () => {
    it('filtra tenant y borrado; 404 si no hay fila', async () => {
      db.query.mockResolvedValueOnce([]);
      await expect(service.filaPorId(TENANT, ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(sqlDe(0)).toMatch(
        /p\.paquete_id = \$1 AND p\.tenant_id = \$2 AND p\.eliminado_el IS NULL/,
      );
      expect(paramsDe(0)).toEqual([ID, TENANT]);
    });
  });

  describe('validarTercero', () => {
    it('404 si no es de este tenant', async () => {
      db.query.mockResolvedValueOnce([]);
      await expect(service.validarTercero(TENANT, TERCERO)).rejects.toThrow(
        NotFoundException,
      );
      expect(sqlDe(0)).toMatch(/tenant_id = \$2 AND eliminado_el IS NULL/);
    });

    it('400 si está pausado', async () => {
      db.query.mockResolvedValueOnce([{ nombre: 'Tienda', activo: false }]);
      await expect(service.validarTercero(TENANT, TERCERO)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('create', () => {
    it('sin tarifas propias exige que haya una por defecto de cada una y no copia ningún precio', async () => {
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([filaSql()]);
      await service.create(TENANT, {
        codigo: ' {"id":"461"} ',
        cobroEnDestino: false,
      });
      expect(sqlDe(0)).toMatch(
        /ON CONFLICT \(tenant_id, codigo\) WHERE eliminado_el IS NULL\s+DO NOTHING/,
      );
      expect(sqlDe(0)).not.toMatch(/precio_envio/);
      expect(paramsDe(0)).toEqual([
        TENANT,
        '461',
        null,
        null,
        null,
        null,
        null,
        null,
        false,
        null,
        null,
      ]);
      expect(tarifasMock.exigirDefecto).toHaveBeenCalledWith(TENANT);
      expect(envioMock.exigirDefecto).toHaveBeenCalledWith(TENANT);
      expect(tarifasMock.exigirActivaDelTenant).not.toHaveBeenCalled();
      expect(envioMock.exigirActivaDelTenant).not.toHaveBeenCalled();
    });

    it('con tarifaPagoId y tarifaEnvioId las valida con cerrojo dentro de la transacción (pago, después envío) y las guarda', async () => {
      const orden: string[] = [];
      tarifasMock.exigirActivaDelTenant.mockImplementation(() => {
        orden.push('pago');
        return Promise.resolve();
      });
      envioMock.exigirActivaDelTenant.mockImplementation(() => {
        orden.push('envio');
        return Promise.resolve();
      });
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([filaSql()]);
      await service.create(TENANT, {
        codigo: '461',
        cobroEnDestino: false,
        tarifaPagoId: 'tarifa-1',
        tarifaEnvioId: 'envio-1',
      });
      expect(db.transaccion).toHaveBeenCalledTimes(1);
      expect(orden).toEqual(['pago', 'envio']);
      expect(tarifasMock.exigirActivaDelTenant).toHaveBeenCalledWith(
        TENANT,
        'tarifa-1',
        { bloquear: true },
      );
      expect(envioMock.exigirActivaDelTenant).toHaveBeenCalledWith(
        TENANT,
        'envio-1',
        { bloquear: true },
      );
      expect(tarifasMock.exigirDefecto).not.toHaveBeenCalled();
      expect(envioMock.exigirDefecto).not.toHaveBeenCalled();
      expect(paramsDe(0).slice(-2)).toEqual(['tarifa-1', 'envio-1']);
    });

    it('sin ninguna tarifa de pago cargada: 400 y no se inserta', async () => {
      tarifasMock.exigirDefecto.mockRejectedValue(
        new BadRequestException('Carga al menos una tarifa de pago'),
      );
      await expect(
        service.create(TENANT, { codigo: '461', cobroEnDestino: false }),
      ).rejects.toThrow(/Carga al menos una tarifa/);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('sin tarifa de envío por defecto (RF4): 400 y no se inserta', async () => {
      envioMock.exigirDefecto.mockRejectedValue(
        new BadRequestException('Carga una tarifa de envío por defecto'),
      );
      await expect(
        service.create(TENANT, { codigo: '461', cobroEnDestino: false }),
      ).rejects.toThrow(/tarifa de envío por defecto/);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('una tarifa de pago o de envío ajena o inactiva: 400 y no se inserta', async () => {
      tarifasMock.exigirActivaDelTenant.mockRejectedValue(
        new BadRequestException('La tarifa de pago no existe o está inactiva'),
      );
      await expect(
        service.create(TENANT, {
          codigo: '461',
          cobroEnDestino: false,
          tarifaPagoId: 'ajena',
        }),
      ).rejects.toThrow(BadRequestException);
      envioMock.exigirActivaDelTenant.mockRejectedValue(
        new BadRequestException('La tarifa de envío no existe o está inactiva'),
      );
      await expect(
        service.create(TENANT, {
          codigo: '461',
          cobroEnDestino: false,
          tarifaEnvioId: 'ajena',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('código repetido: 409 con el código normalizado', async () => {
      db.query.mockResolvedValueOnce([[], 0]);
      const intento = service.create(TENANT, {
        codigo: '{"id":"461"}',
        cobroEnDestino: false,
      });
      await expect(intento).rejects.toThrow(ConflictException);
      await expect(intento).rejects.toThrow(
        'Ya existe un paquete con el código 461.',
      );
    });

    it('el remitente ajeno (404) frena el alta antes de insertar', async () => {
      db.query.mockResolvedValueOnce([]);
      await expect(
        service.create(TENANT, {
          codigo: '461',
          cobroEnDestino: false,
          remitenteTerceroId: TERCERO,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('un código vacío tras normalizar es 400', async () => {
      await expect(
        service.create(TENANT, { codigo: '   ', cobroEnDestino: false }),
      ).rejects.toThrow(BadRequestException);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    // La primera sentencia de `update` es el `FOR SHARE` sobre la hoja: no devuelve nada que se use.
    const bloqueoDeHoja = () => db.query.mockResolvedValueOnce([]);

    it('abre la transacción y toma el FOR SHARE de la hoja ANTES de leer la fila', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      await service.update(TENANT, ID, {});
      expect(db.transaccion).toHaveBeenCalledTimes(1);
      expect(sqlDe(0)).toMatch(/FOR SHARE OF h/);
      expect(sqlDe(0)).toMatch(
        /h\.tenant_id = \$2 AND h\.eliminado_el IS NULL/,
      );
      expect(sqlDe(0)).toMatch(
        /l\.tenant_id = \$2 AND l\.eliminado_el IS NULL/,
      );
      expect(sqlDe(0)).toMatch(/l\.estado IN \('en_ruta', 'entregado'\)/);
      expect(paramsDe(0)).toEqual([ID, TENANT]);
      expect(sqlDe(1)).toContain('p.paquete_id = $1 AND p.tenant_id = $2');
      expect(sqlDe(1)).not.toMatch(/FOR SHARE/);
    });

    it('el UPDATE corre después de leer la fila, dentro de la misma transacción', async () => {
      const orden: string[] = [];
      db.transaccion.mockImplementationOnce(async (cb: () => unknown) => {
        orden.push('abre');
        const r = await cb();
        orden.push('cierra');
        return r;
      });
      db.query.mockImplementation((sql: string) => {
        orden.push(
          sql.includes('FOR SHARE')
            ? 'cerrojo'
            : sql.startsWith('UPDATE')
              ? 'update'
              : 'lectura',
        );
        if (sql.startsWith('UPDATE'))
          return Promise.resolve([[{ paquete_id: ID }], 1]);
        if (sql.includes('FOR SHARE')) return Promise.resolve([]);
        return Promise.resolve([filaSql()]);
      });
      await service.update(TENANT, ID, { direccion: 'x' });
      expect(orden).toEqual([
        'abre',
        'cerrojo',
        'lectura',
        'update',
        'lectura',
        'cierra',
      ]);
    });

    it('un paquete entregado en hoja rendida: 400 al tocar montos o cobro en destino', async () => {
      for (const dto of [
        { tarifaEnvioId: 'envio-1' },
        { tarifaPagoId: 'tarifa-1' },
        { cobroEnDestino: true },
      ]) {
        db.query.mockReset();
        bloqueoDeHoja();
        db.query.mockResolvedValueOnce([filaSql({ bloqueado: true })]);
        await expect(service.update(TENANT, ID, dto)).rejects.toThrow(
          'ya se rindió',
        );
        expect(db.query).toHaveBeenCalledTimes(2);
      }
    });

    it('cambiar la tarifa valida con cerrojo, la guarda y vuelve a resolver la línea entregada de una hoja abierta', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([[], 0]); // la re-resolución
      db.query.mockResolvedValueOnce([filaSql({ tarifa_pago_id: 'tarifa-1' })]);
      await service.update(TENANT, ID, { tarifaPagoId: 'tarifa-1' });
      expect(tarifasMock.exigirActivaDelTenant).toHaveBeenCalledWith(
        TENANT,
        'tarifa-1',
        { bloquear: true },
      );
      expect(sqlDe(2)).toMatch(/SET tarifa_pago_id = \$3/);
      expect(paramsDe(2)).toEqual([ID, TENANT, 'tarifa-1']);
      // Misma regla que al entregar, solo sobre hojas abiertas.
      expect(sqlDe(3)).toMatch(/SET tarifa_pago_id = tr\.tarifa_pago_id/);
      expect(sqlDe(3)).toMatch(/l\.estado = 'entregado'/);
      expect(sqlDe(3)).toMatch(/h\.estado = 'abierta'/);
      expect(sqlDe(3)).toMatch(/t1\.tarifa_pago_id = p\.tarifa_pago_id/);
    });

    it('reenviar la MISMA tarifa no re-resuelve la línea entregada (RF1)', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql({ tarifa_pago_id: 'tarifa-1' })]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([filaSql({ tarifa_pago_id: 'tarifa-1' })]);
      await service.update(TENANT, ID, {
        tarifaPagoId: 'tarifa-1',
        direccion: 'x',
      });
      expect(db.query).toHaveBeenCalledTimes(4);
      expect(
        db.query.mock.calls.some((c) =>
          /SET tarifa_pago_id = tr\.tarifa_pago_id/.test(c[0] as string),
        ),
      ).toBe(false);
    });

    it('quitar la tarifa (null) no valida nada y también re-resuelve', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql({ tarifa_pago_id: 'tarifa-1' })]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([[], 0]);
      db.query.mockResolvedValueOnce([filaSql()]);
      await service.update(TENANT, ID, { tarifaPagoId: null });
      expect(tarifasMock.exigirActivaDelTenant).not.toHaveBeenCalled();
      expect(paramsDe(2)).toEqual([ID, TENANT, null]);
      expect(sqlDe(3)).toMatch(/SET tarifa_pago_id = tr\.tarifa_pago_id/);
    });

    it('cambiar SOLO la tarifa de envío valida con cerrojo, la guarda y re-resuelve solo el precio de la línea entregada', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([[], 0]); // la re-resolución
      db.query.mockResolvedValueOnce([filaSql({ tarifa_envio_id: 'envio-1' })]);
      await service.update(TENANT, ID, { tarifaEnvioId: 'envio-1' });
      expect(envioMock.exigirActivaDelTenant).toHaveBeenCalledWith(
        TENANT,
        'envio-1',
        { bloquear: true },
      );
      expect(tarifasMock.exigirActivaDelTenant).not.toHaveBeenCalled();
      expect(sqlDe(2)).toMatch(/SET tarifa_envio_id = \$3/);
      expect(sqlDe(3)).toMatch(
        /SET tarifa_envio_id = te\.tarifa_envio_id, precio_envio = te\.monto/,
      );
      // La mitad del pago no se toca.
      expect(sqlDe(3)).not.toMatch(/pago_repartidor/);
      expect(sqlDe(3)).toMatch(/l\.estado = 'entregado'/);
      expect(sqlDe(3)).toMatch(/h\.estado = 'abierta'/);
      expect(sqlDe(3)).toMatch(/e1\.tarifa_envio_id = p\.tarifa_envio_id/);
    });

    it('cambiar SOLO la de pago no toca el precio de la línea', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([[], 0]);
      db.query.mockResolvedValueOnce([filaSql({ tarifa_pago_id: 'tarifa-1' })]);
      await service.update(TENANT, ID, { tarifaPagoId: 'tarifa-1' });
      expect(sqlDe(3)).not.toMatch(/precio_envio|tarifas_envio/);
    });

    it('cambiar las dos resuelve pago y precio en UNA sentencia', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([[], 0]);
      db.query.mockResolvedValueOnce([filaSql()]);
      await service.update(TENANT, ID, {
        tarifaPagoId: 'tarifa-1',
        tarifaEnvioId: 'envio-1',
      });
      expect(db.query).toHaveBeenCalledTimes(5);
      expect(sqlDe(3)).toMatch(/pago_repartidor = tr\.monto/);
      expect(sqlDe(3)).toMatch(/precio_envio = te\.monto/);
    });

    it('reenviar la MISMA tarifa de envío (o null → null) no re-resuelve la línea entregada (RF3)', async () => {
      for (const [actual, enviada] of [
        ['envio-1', 'envio-1'],
        [null, null],
      ] as const) {
        db.query.mockReset();
        bloqueoDeHoja();
        db.query.mockResolvedValueOnce([filaSql({ tarifa_envio_id: actual })]);
        db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
        db.query.mockResolvedValueOnce([filaSql({ tarifa_envio_id: actual })]);
        await service.update(TENANT, ID, {
          tarifaEnvioId: enviada,
          direccion: 'x',
        });
        expect(db.query).toHaveBeenCalledTimes(4);
        expect(envioMock.exigirActivaDelTenant).not.toHaveBeenCalled();
        expect(
          db.query.mock.calls.some((c) =>
            /precio_envio = te\.monto/.test(c[0] as string),
          ),
        ).toBe(false);
      }
    });

    it('quitar la tarifa de envío (null) no valida nada y re-resuelve el precio', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql({ tarifa_envio_id: 'envio-1' })]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([[], 0]);
      db.query.mockResolvedValueOnce([filaSql()]);
      await service.update(TENANT, ID, { tarifaEnvioId: null });
      expect(envioMock.exigirActivaDelTenant).not.toHaveBeenCalled();
      expect(paramsDe(2)).toEqual([ID, TENANT, null]);
      expect(sqlDe(3)).toMatch(/precio_envio = te\.monto/);
    });

    it('una tarifa de envío ajena o inactiva: 400 y no se escribe el paquete', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      envioMock.exigirActivaDelTenant.mockRejectedValue(
        new BadRequestException('La tarifa de envío no existe o está inactiva'),
      );
      await expect(
        service.update(TENANT, ID, { tarifaEnvioId: 'ajena' }),
      ).rejects.toThrow(BadRequestException);
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('una tarifa ajena o inactiva: 400 y no se escribe el paquete', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      tarifasMock.exigirActivaDelTenant.mockRejectedValue(
        new BadRequestException('La tarifa de pago no existe o está inactiva'),
      );
      await expect(
        service.update(TENANT, ID, { tarifaPagoId: 'ajena' }),
      ).rejects.toThrow(BadRequestException);
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('cambiar el cobro en destino ajusta el medio de la línea entregada: efectivo al activarlo, limpio al quitarlo', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql({ cobro_en_destino: false })]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([[], 0]);
      db.query.mockResolvedValueOnce([filaSql({ cobro_en_destino: true })]);
      await service.update(TENANT, ID, { cobroEnDestino: true });
      expect(sqlDe(3)).toMatch(/SET medio_cobro = CASE WHEN \$3::boolean/);
      expect(sqlDe(3)).toMatch(/h\.estado = 'abierta'/);
      expect(paramsDe(3)).toEqual([ID, TENANT, true]);
    });

    it('mandar el mismo cobro en destino que ya tiene no toca el medio elegido', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql({ cobro_en_destino: true })]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([filaSql({ cobro_en_destino: true })]);
      await service.update(TENANT, ID, { cobroEnDestino: true });
      expect(db.query).toHaveBeenCalledTimes(4);
    });

    it('un paquete rendido sí deja completar la dirección', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql({ bloqueado: true })]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([
        filaSql({ bloqueado: true, direccion: 'Av. Siempreviva 742' }),
      ]);
      await expect(
        service.update(TENANT, ID, { direccion: 'Av. Siempreviva 742' }),
      ).resolves.toMatchObject({ direccion: 'Av. Siempreviva 742' });
      expect(sqlDe(2)).toMatch(/SET direccion = \$3, actualizado_el = now\(\)/);
      expect(sqlDe(2)).toMatch(/tenant_id = \$2 AND eliminado_el IS NULL/);
    });

    it('solo toca lo que llegó: null vacía, ausente no aparece en el SET', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([filaSql()]);
      await service.update(TENANT, ID, { nota: null });
      expect(sqlDe(2)).toMatch(/SET nota = \$3,/);
      expect(sqlDe(2)).not.toMatch(/direccion/);
      expect(paramsDe(2)).toEqual([ID, TENANT, null]);
    });

    it('sin campos devuelve la fila sin escribir', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      await service.update(TENANT, ID, {});
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('código nuevo normalizado; si choca con el índice único: 409 sin más consultas', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      db.query.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      const intento = service.update(TENANT, ID, {
        codigo: '{"id":"999"}',
      });
      await expect(intento).rejects.toThrow(ConflictException);
      await expect(intento).rejects.toThrow(
        'Ya existe un paquete con el código 999.',
      );
      expect(paramsDe(2)).toEqual([ID, TENANT, '999']);
      // Tras el 23505 la transacción está abortada (25P02): ninguna sentencia más.
      expect(db.query).toHaveBeenCalledTimes(3);
    });

    it('otro error de la base no se traduce', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      db.query.mockRejectedValueOnce(
        Object.assign(new Error('boom'), { code: '40001' }),
      );
      await expect(
        service.update(TENANT, ID, { codigo: '999' }),
      ).rejects.toThrow('boom');
    });

    it('el remitente nuevo se valida contra el tenant; null lo quita sin validar', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      db.query.mockResolvedValueOnce([]);
      await expect(
        service.update(TENANT, ID, { remitenteTerceroId: TERCERO }),
      ).rejects.toThrow(NotFoundException);

      db.query.mockReset();
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([filaSql()]);
      db.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);
      db.query.mockResolvedValueOnce([filaSql()]);
      await service.update(TENANT, ID, { remitenteTerceroId: null });
      expect(sqlDe(2)).toMatch(/remitente_tercero_id = \$3/);
    });

    it('404 si el paquete no existe en el tenant', async () => {
      bloqueoDeHoja();
      db.query.mockResolvedValueOnce([]);
      await expect(
        service.update(TENANT, ID, { direccion: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('primero el cerrojo de la fila, después —en otra sentencia— las líneas, al final el soft delete', async () => {
      db.query.mockResolvedValueOnce([{ codigo: '461' }]);
      db.query.mockResolvedValueOnce([{ tiene: false }]);
      db.query.mockResolvedValueOnce([[], 1]);
      await service.remove(TENANT, ID);
      expect(db.transaccion).toHaveBeenCalledTimes(1);
      expect(db.query).toHaveBeenCalledTimes(3);
      expect(sqlDe(0)).toMatch(/FROM paquetes p/);
      expect(sqlDe(0)).toMatch(/FOR UPDATE\s*$/);
      // El EXISTS no puede ir en la sentencia del FOR UPDATE: usaría su snapshot, anterior al cerrojo.
      expect(sqlDe(0)).not.toMatch(/hoja_ruta_paquetes/);
      expect(sqlDe(1)).toMatch(/hoja_ruta_paquetes/);
      expect(sqlDe(1)).toMatch(
        /l\.tenant_id = \$2 AND l\.eliminado_el IS NULL/,
      );
      expect(sqlDe(1)).not.toMatch(/FOR UPDATE/);
      expect(sqlDe(2)).toMatch(/UPDATE paquetes SET eliminado_el = now\(\)/);
    });

    it('un paquete que alguna vez salió en una hoja: 400 y no se borra', async () => {
      db.query.mockResolvedValueOnce([{ codigo: '461' }]);
      db.query.mockResolvedValueOnce([{ tiene: true }]);
      await expect(service.remove(TENANT, ID)).rejects.toThrow(
        'El paquete 461 ya salió en una hoja de ruta',
      );
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('sin líneas: soft delete (UPDATE eliminado_el), nunca DELETE', async () => {
      db.query.mockResolvedValueOnce([{ codigo: '461' }]);
      db.query.mockResolvedValueOnce([{ tiene: false }]);
      db.query.mockResolvedValueOnce([[], 1]);
      await expect(service.remove(TENANT, ID)).resolves.toEqual({
        success: true,
      });
      expect(sqlDe(2)).not.toMatch(/DELETE/);
      expect(paramsDe(2)).toEqual([ID, TENANT]);
    });

    it('404 si no existe en el tenant, sin mirar las líneas', async () => {
      db.query.mockResolvedValueOnce([]);
      await expect(service.remove(TENANT, ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });
});
