import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Db } from '../../common/db/db.service';
import { assertSinHuecos } from '../../common/db/db.spec-helper';
import { RazonSocial } from '../tenants/entities/razon-social.entity';
import {
  cafDePrueba,
  certificadoDePrueba,
} from './__fixtures__/credenciales-prueba';
import { CifradoDteService } from './cifrado-dte.service';
import { PerfilFiscalService } from './perfil-fiscal.service';

const TENANT = '550e8400-e29b-41d4-a716-446655440007';
const RAZON_SOCIAL = '11111111-2222-4333-8444-555555555555';
const AHORA = new Date('2026-10-14T12:00:00Z');

const FILA_EMISORA = {
  razon_social_id: RAZON_SOCIAL,
  nombre: 'Emisor de Prueba',
  rut: '77777777-7',
  direccion: 'Av. Prueba 123',
  giro: null,
  comuna: null,
  ambiente_sii: null,
  fecha_resolucion: null,
  numero_resolucion: null,
};

describe('PerfilFiscalService', () => {
  let service: PerfilFiscalService;
  let db: { query: jest.Mock; transaccion: jest.Mock };
  let cifrado: { cifrar: jest.Mock };
  let razonSocialRepo: { update: jest.Mock };

  beforeEach(async () => {
    db = {
      query: jest.fn(),
      transaccion: jest.fn((cb: (m: unknown) => unknown) => cb({})),
    };
    cifrado = { cifrar: jest.fn((t: string) => `cifrado:${t.length}`) };
    razonSocialRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const modulo = await Test.createTestingModule({
      providers: [
        PerfilFiscalService,
        { provide: Db, useValue: db },
        { provide: CifradoDteService, useValue: cifrado },
        { provide: getRepositoryToken(RazonSocial), useValue: razonSocialRepo },
      ],
    }).compile();
    service = modulo.get(PerfilFiscalService);
  });

  const sinEmisora = () => db.query.mockResolvedValueOnce([]);
  const conEmisora = () => db.query.mockResolvedValueOnce([FILA_EMISORA]);

  describe('emisora', () => {
    it('es la razón social preferida, habilitada y no borrada del tenant', async () => {
      conEmisora();
      const emisora = await service.emisora(TENANT);

      expect(emisora).toEqual({
        razonSocialId: RAZON_SOCIAL,
        nombre: 'Emisor de Prueba',
        rut: '77777777-7',
        direccion: 'Av. Prueba 123',
        giro: null,
        comuna: null,
        ambiente: null,
        fechaResolucion: null,
        numeroResolucion: null,
      });
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/preferida/);
      expect(sql).toMatch(/habilitado/);
      expect(sql).toMatch(/eliminado_el IS NULL/);
      expect(params).toEqual([TENANT]);
      assertSinHuecos(sql, params);
    });

    it('null si el tenant no tiene una', async () => {
      sinEmisora();
      expect(await service.emisora(TENANT)).toBeNull();
    });
  });

  describe('obtener', () => {
    it('sin emisora: una sola consulta, todo vacío y SIN_EMISOR como faltante', async () => {
      sinEmisora();
      const perfil = await service.obtener(TENANT, AHORA);

      expect(db.query).toHaveBeenCalledTimes(1);
      expect(perfil.emisor).toBeNull();
      expect(perfil.certificado).toBeNull();
      expect(perfil.cafs).toEqual([]);
      expect(perfil.faltantes.map((f) => f.codigo)).toContain('SIN_EMISOR');
    });

    it('con emisora: tres consultas fijas, sin importar cuántos CAF haya', async () => {
      conEmisora();
      db.query.mockResolvedValueOnce([
        {
          certificado_id: 'c1',
          rut_firmante: '11111111-1',
          nombre_firmante: 'Ana Pérez',
          vence_el: new Date('2036-01-01T00:00:00Z'),
        },
      ]);
      db.query.mockResolvedValueOnce([
        {
          caf_id: 'f1',
          tipo: 39,
          ambiente: 'certificacion',
          desde: 1,
          hasta: 50,
          siguiente_folio: 1,
          fecha_autorizacion: '2026-10-01',
          idk: 100,
        },
        {
          caf_id: 'f2',
          tipo: 39,
          ambiente: 'certificacion',
          desde: 51,
          hasta: 100,
          siguiente_folio: 61,
          fecha_autorizacion: '2026-10-02',
          idk: 100,
        },
        {
          caf_id: 'f3',
          tipo: 41,
          ambiente: 'produccion',
          desde: 1,
          hasta: 10,
          siguiente_folio: 11,
          fecha_autorizacion: '2026-10-03',
          idk: 101,
        },
      ]);

      const perfil = await service.obtener(TENANT, AHORA);

      expect(db.query).toHaveBeenCalledTimes(3);
      for (const [sql, params] of db.query.mock.calls as [string, unknown[]][])
        assertSinHuecos(sql, params);
      expect(perfil.certificado).toEqual({
        id: 'c1',
        rutFirmante: '11111111-1',
        nombreFirmante: 'Ana Pérez',
        venceEl: '2036-01-01T00:00:00.000Z',
      });
      expect(perfil.cafs).toEqual([
        {
          id: 'f1',
          tipo: 39,
          ambiente: 'certificacion',
          desde: 1,
          hasta: 50,
          usados: 0,
          restantes: 50,
          fechaAutorizacion: '2026-10-01',
          idk: 100,
          borrable: true,
        },
        {
          id: 'f2',
          tipo: 39,
          ambiente: 'certificacion',
          desde: 51,
          hasta: 100,
          usados: 10,
          restantes: 40,
          fechaAutorizacion: '2026-10-02',
          idk: 100,
          borrable: false,
        },
        {
          id: 'f3',
          tipo: 41,
          ambiente: 'produccion',
          desde: 1,
          hasta: 10,
          usados: 10,
          restantes: 0,
          fechaAutorizacion: '2026-10-03',
          idk: 101,
          borrable: false,
        },
      ]);
    });

    it('las consultas del certificado y de los CAF filtran lo reemplazado y lo borrado', async () => {
      conEmisora();
      db.query.mockResolvedValueOnce([]);
      db.query.mockResolvedValueOnce([]);
      await service.obtener(TENANT, AHORA);

      const [, sqlCert] = (db.query.mock.calls as [string][]).map((c) => c[0]);
      const sqlCaf = (db.query.mock.calls as [string][])[2][0];
      expect(sqlCert).toMatch(/reemplazado_el IS NULL/);
      expect(sqlCert).toMatch(/eliminado_el IS NULL/);
      expect(sqlCaf).toMatch(/eliminado_el IS NULL/);
      expect(sqlCaf).toMatch(/ORDER BY tipo, desde/);
    });
  });

  describe('actualizar', () => {
    it('sin emisora: 400 que manda a Razones sociales', async () => {
      sinEmisora();
      await expect(
        service.actualizar(TENANT, { giro: 'Café' }),
      ).rejects.toThrow(/marcar una razón social como preferida/);
      expect(razonSocialRepo.update).not.toHaveBeenCalled();
    });

    it('un giro con tab es 400 y no escribe', async () => {
      conEmisora();
      await expect(
        service.actualizar(TENANT, { giro: 'Café\tbar' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(razonSocialRepo.update).not.toHaveBeenCalled();
    });

    it('una fecha que no existe en el calendario es 400', async () => {
      conEmisora();
      await expect(
        service.actualizar(TENANT, { fechaResolucion: '2026-02-30' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(razonSocialRepo.update).not.toHaveBeenCalled();
    });

    it('escribe solo lo que vino y devuelve eso mismo, sin releer', async () => {
      conEmisora();
      const campos = {
        giro: 'Restaurante',
        comuna: 'Ñuñoa',
        ambienteSii: 'certificacion' as const,
        fechaResolucion: '2026-09-30',
        numeroResolucion: 0,
      };

      const resultado = await service.actualizar(TENANT, campos);

      expect(resultado).toEqual(campos);
      expect(razonSocialRepo.update).toHaveBeenCalledWith(
        { id: RAZON_SOCIAL, tenantId: TENANT },
        campos,
      );
      // Una sola consulta: la de la emisora. Nada de volver a leer lo escrito.
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('un cuerpo vacío no escribe nada', async () => {
      conEmisora();
      expect(await service.actualizar(TENANT, {})).toEqual({});
      expect(razonSocialRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('subirCertificado', () => {
    const subida = (
      opciones: Parameters<typeof certificadoDePrueba>[0] = {},
      clave?: string,
    ) => {
      const cert = certificadoDePrueba(opciones);
      return {
        pfxBase64: cert.pfx.toString('base64'),
        clave: clave ?? cert.clave,
      };
    };

    it('sin emisora: 400 y no toca nada', async () => {
      sinEmisora();
      await expect(
        service.subirCertificado(TENANT, subida(), AHORA),
      ).rejects.toThrow(/marcar una razón social como preferida/);
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('la emisora se toma con FOR UPDATE dentro de la transacción', async () => {
      conEmisora();
      db.query.mockResolvedValueOnce([]); // el UPDATE del anterior
      db.query.mockResolvedValueOnce([{ certificado_id: 'x' }]); // el INSERT
      await service.subirCertificado(TENANT, subida({ nombre: 'Ana' }), AHORA);

      expect(db.transaccion).toHaveBeenCalledTimes(1);
      const [sql] = db.query.mock.calls[0] as [string];
      expect(sql).toMatch(/FOR UPDATE/);
      expect(sql).toMatch(/FROM razones_sociales/);
    });

    it('clave equivocada: 400 y el mensaje no trae la clave', async () => {
      conEmisora();
      const equivocada = 'clave-que-no-es-9137';
      const error = await service
        .subirCertificado(TENANT, subida({}, equivocada), AHORA)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(
        JSON.stringify((error as BadRequestException).getResponse()),
      ).not.toContain(equivocada);
      expect((error as Error).message).not.toContain(equivocada);
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('certificado vencido: 400 con el día en que venció', async () => {
      conEmisora();
      const error = await service
        .subirCertificado(
          TENANT,
          subida({ venceEl: new Date('2026-05-04T10:17:00Z') }),
          AHORA,
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(
        'El certificado venció el 04-05-2026; sube uno vigente',
      );
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('OK: cifra el JSON con la llave, anula el vigente y guarda el nuevo', async () => {
      conEmisora();
      db.query.mockResolvedValueOnce([]); // el UPDATE del anterior
      db.query.mockResolvedValueOnce([{ certificado_id: 'nuevo-id' }]); // el INSERT ... RETURNING

      const certificado = await service.subirCertificado(
        TENANT,
        subida({ nombre: 'Ana Pérez' }),
        AHORA,
      );

      expect(cifrado.cifrar).toHaveBeenCalledTimes(1);
      const texto = (cifrado.cifrar.mock.calls[0] as [string])[0];
      const guardado = JSON.parse(texto) as Record<string, string>;
      expect(guardado.llavePrivadaPem).toContain('PRIVATE KEY');
      expect(guardado.nombre).toBe('Ana Pérez');
      expect(guardado.venceEl).toBe('2036-01-01T00:00:00.000Z');

      const [sqlAnula, paramsAnula] = db.query.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(sqlAnula).toMatch(/UPDATE dte_certificados/);
      expect(sqlAnula).toMatch(/reemplazado_el = now\(\)/);
      expect(sqlAnula).toMatch(/credencial_cifrada = NULL/);
      expect(sqlAnula).toMatch(/reemplazado_el IS NULL/);
      expect(sqlAnula).toMatch(/eliminado_el IS NULL/);
      expect(paramsAnula).toEqual([RAZON_SOCIAL]);
      assertSinHuecos(sqlAnula, paramsAnula);

      const [sqlInserta, paramsInserta] = db.query.mock.calls[2] as [
        string,
        unknown[],
      ];
      expect(sqlInserta).toMatch(/INSERT INTO dte_certificados/);
      assertSinHuecos(sqlInserta, paramsInserta);
      expect(paramsInserta).toContain(`cifrado:${texto.length}`);

      expect(certificado).toEqual({
        id: 'nuevo-id',
        rutFirmante: '11111111-1',
        nombreFirmante: 'Ana Pérez',
        venceEl: '2036-01-01T00:00:00.000Z',
      });
    });
  });

  describe('subirCaf', () => {
    const EMISORA_CON_AMBIENTE = {
      ...FILA_EMISORA,
      ambiente_sii: 'certificacion',
    };
    const conAmbiente = () =>
      db.query.mockResolvedValueOnce([EMISORA_CON_AMBIENTE]);
    const subida = (
      opciones: Partial<Parameters<typeof cafDePrueba>[0]> = {},
    ) => {
      const xml = cafDePrueba({
        rut: '77777777-7',
        tipo: 39,
        desde: 1,
        hasta: 50,
        ...opciones,
      });
      return {
        xml,
        dto: { xmlBase64: Buffer.from(xml, 'latin1').toString('base64') },
      };
    };
    const FILA_INSERTADA = {
      caf_id: 'caf-nuevo',
      tipo: 39,
      ambiente: 'certificacion',
      desde: 1,
      hasta: 50,
      siguiente_folio: 1,
      idk: 100,
      fecha_autorizacion: '2026-10-01',
    };

    it('sin emisora: 400 y no escribe', async () => {
      sinEmisora();
      await expect(service.subirCaf(TENANT, subida().dto)).rejects.toThrow(
        /marcar una razón social como preferida/,
      );
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('sin ambiente elegido: 400 que lo pide primero', async () => {
      conEmisora();
      await expect(service.subirCaf(TENANT, subida().dto)).rejects.toThrow(
        'Primero hay que elegir el ambiente (certificación o producción)',
      );
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('la emisora se toma con FOR UPDATE dentro de la transacción', async () => {
      conAmbiente();
      db.query.mockResolvedValueOnce([]); // el solape
      db.query.mockResolvedValueOnce([FILA_INSERTADA]);
      await service.subirCaf(TENANT, subida().dto);

      expect(db.transaccion).toHaveBeenCalledTimes(1);
      const [sql] = db.query.mock.calls[0] as [string];
      expect(sql).toMatch(/FOR UPDATE/);
    });

    it('un base64 que no es un CAF: 400 con el motivo del motor', async () => {
      conAmbiente();
      const dto = {
        xmlBase64: Buffer.from('no soy un CAF').toString('base64'),
      };
      const error = await service
        .subirCaf(TENANT, dto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toMatch(/El CAF no es válido/);
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('un tipo que no es boleta: 400 que dice cuál es', async () => {
      conAmbiente();
      const error = await service
        .subirCaf(TENANT, subida({ tipo: 33 }).dto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(
        'Este CAF es de documentos tipo 33; por ahora solo se cargan boletas (39 y 41)',
      );
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('el CAF de otro RUT: 400 con ambos RUT', async () => {
      conAmbiente();
      const error = await service
        .subirCaf(TENANT, subida({ rut: '76543210-3' }).dto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(
        'Este archivo de folios es del RUT 76543210-3, no de la empresa (77777777-7)',
      );
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('compara el RUT normalizado: la emisora con puntos igual coincide', async () => {
      db.query.mockResolvedValueOnce([
        { ...EMISORA_CON_AMBIENTE, rut: '77.777.777-7' },
      ]);
      db.query.mockResolvedValueOnce([]);
      db.query.mockResolvedValueOnce([FILA_INSERTADA]);
      await expect(
        service.subirCaf(TENANT, subida().dto),
      ).resolves.toBeDefined();
    });

    it('un folio final que no cabe en un integer: 400', async () => {
      conAmbiente();
      await expect(
        service.subirCaf(
          TENANT,
          subida({ desde: 1, hasta: 2_147_483_647 }).dto,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('un CAF que empieza en el folio 0: 400 (no un 500 de la base)', async () => {
      conAmbiente();
      const error = await service
        .subirCaf(TENANT, subida({ desde: 0, hasta: 50 }).dto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toMatch(/folio 0/);
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('un IDK que no cabe en un integer: 400 (no un 500 de la base)', async () => {
      conAmbiente();
      const xml = subida().xml.replace(
        '<IDK>100</IDK>',
        '<IDK>2147483648</IDK>',
      );
      const error = await service
        .subirCaf(TENANT, {
          xmlBase64: Buffer.from(xml, 'latin1').toString('base64'),
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toMatch(/IDK/);
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('el IDK tope exacto (2.147.483.647) todavía entra', async () => {
      conAmbiente();
      db.query.mockResolvedValueOnce([]);
      db.query.mockResolvedValueOnce([FILA_INSERTADA]);
      const xml = subida().xml.replace(
        '<IDK>100</IDK>',
        '<IDK>2147483647</IDK>',
      );
      await expect(
        service.subirCaf(TENANT, {
          xmlBase64: Buffer.from(xml, 'latin1').toString('base64'),
        }),
      ).resolves.toBeDefined();
    });

    it('el tope exacto (2.147.483.646) todavía entra', async () => {
      conAmbiente();
      db.query.mockResolvedValueOnce([]);
      db.query.mockResolvedValueOnce([FILA_INSERTADA]);
      await expect(
        service.subirCaf(
          TENANT,
          subida({ desde: 1, hasta: 2_147_483_646 }).dto,
        ),
      ).resolves.toBeDefined();
    });

    it('folios que se solapan con un CAF vivo del mismo tipo: 400', async () => {
      conAmbiente();
      db.query.mockResolvedValueOnce([{ '?column?': 1 }]);
      await expect(
        service.subirCaf(TENANT, subida({ desde: 40, hasta: 90 }).dto),
      ).rejects.toThrow('Esos folios ya están cargados');

      const [sql, params] = db.query.mock.calls[1] as [string, unknown[]];
      expect(sql).toMatch(/FROM dte_cafs/);
      expect(sql).toMatch(/eliminado_el IS NULL/);
      expect(sql).toMatch(/ambiente = \$5 AND desde <= \$4 AND hasta >= \$3/);
      expect(params).toEqual([RAZON_SOCIAL, 39, 40, 90, 'certificacion']);
      assertSinHuecos(sql, params);
      expect(cifrado.cifrar).not.toHaveBeenCalled();
    });

    it('OK: guarda el XML cifrado, siguiente_folio = desde y el ambiente de la emisora', async () => {
      conAmbiente();
      db.query.mockResolvedValueOnce([]);
      db.query.mockResolvedValueOnce([[FILA_INSERTADA], 1]);
      const { xml, dto } = subida({
        tipo: 41,
        desde: 3011,
        hasta: 3412,
        razonSocial: 'PANADERÍA ÑUÑOA',
        windows: true,
      });

      const caf = await service.subirCaf(TENANT, dto);

      // El texto que se cifra es el archivo tal cual, con sus tildes (latin1, no utf8).
      expect(cifrado.cifrar).toHaveBeenCalledTimes(1);
      expect(cifrado.cifrar).toHaveBeenCalledWith(xml);
      const [sql, params] = db.query.mock.calls[2] as [string, unknown[]];
      expect(sql).toMatch(/INSERT INTO dte_cafs/);
      expect(sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$6, /);
      assertSinHuecos(sql, params);
      expect(params).toEqual([
        TENANT,
        RAZON_SOCIAL,
        41,
        '77777777-7',
        'certificacion',
        3011,
        3412,
        100,
        '2026-10-01',
        `cifrado:${xml.length}`,
      ]);
      expect(caf).toEqual({
        id: 'caf-nuevo',
        tipo: 39,
        ambiente: 'certificacion',
        desde: 1,
        hasta: 50,
        usados: 0,
        restantes: 50,
        fechaAutorizacion: '2026-10-01',
        idk: 100,
        borrable: true,
      });
    });
  });

  describe('borrarCaf', () => {
    const ID = '99999999-2222-4333-8444-555555555555';

    it('un CAF sin folios usados se marca borrado y no hace más consultas', async () => {
      db.query.mockResolvedValueOnce([[{ caf_id: ID }], 1]);
      await expect(service.borrarCaf(TENANT, ID)).resolves.toBeUndefined();

      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/UPDATE dte_cafs SET eliminado_el = now\(\)/);
      expect(sql).toMatch(/tenant_id = \$2/);
      expect(sql).toMatch(/eliminado_el IS NULL/);
      expect(sql).toMatch(/siguiente_folio = desde/);
      expect(sql).not.toMatch(/DELETE FROM/);
      expect(params).toEqual([ID, TENANT]);
      assertSinHuecos(sql, params);
    });

    it('un CAF que no existe en el tenant: 404', async () => {
      db.query.mockResolvedValueOnce([[], 0]);
      db.query.mockResolvedValueOnce([]);
      await expect(service.borrarCaf(TENANT, ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const [sql, params] = db.query.mock.calls[1] as [string, unknown[]];
      expect(sql).toMatch(/tenant_id = \$2/);
      expect(sql).toMatch(/eliminado_el IS NULL/);
      assertSinHuecos(sql, params);
    });

    it('un CAF con folios usados: 400 y no lo borra', async () => {
      db.query.mockResolvedValueOnce([[], 0]);
      db.query.mockResolvedValueOnce([{ '?column?': 1 }]);
      const error = await service
        .borrarCaf(TENANT, ID)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(
        'Este CAF ya entregó folios y no se puede borrar',
      );
    });
  });
});
