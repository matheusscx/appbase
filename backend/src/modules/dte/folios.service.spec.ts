import { Test } from '@nestjs/testing';
import { Db } from '../../common/db/db.service';
import { assertSinHuecos } from '../../common/db/db.spec-helper';
import { TxContext } from '../../common/db/tx-context';
import {
  cafDePrueba,
  certificadoDePrueba,
} from './__fixtures__/credenciales-prueba';
import { CifradoDteService } from './cifrado-dte.service';
import { DteError } from './dte.types';
import { leerCertificado } from './firma';
import { FoliosService } from './folios.service';

const TENANT = '550e8400-e29b-41d4-a716-446655440007';
const CAF_ID = '11111111-2222-4333-8444-555555555555';
const RAZON_SOCIAL = '66666666-7777-4888-8999-000000000000';
const AHORA = new Date('2026-10-14T13:07:00Z');

describe('FoliosService', () => {
  let service: FoliosService;
  let db: { query: jest.Mock };
  let tx: { managerActivo: jest.Mock };
  /** Sin cifrado de verdad: el unitario prueba el flujo, el cifrado tiene su propio spec. */
  let cifrado: { descifrar: jest.Mock };

  beforeEach(async () => {
    db = { query: jest.fn() };
    tx = { managerActivo: jest.fn().mockReturnValue({}) };
    cifrado = { descifrar: jest.fn((t: string) => t) };
    const modulo = await Test.createTestingModule({
      providers: [
        FoliosService,
        { provide: Db, useValue: db },
        { provide: TxContext, useValue: tx },
        { provide: CifradoDteService, useValue: cifrado },
      ],
    }).compile();
    service = modulo.get(FoliosService);
  });

  /** Lo que devuelve un UPDATE ... RETURNING con `pg` a través de TypeORM: `[filas, cuántas]`. */
  const devuelve = (filas: object[]) => [filas, filas.length];

  async function codigoDe(promesa: Promise<unknown>): Promise<string> {
    try {
      await promesa;
    } catch (e) {
      if (e instanceof DteError) return e.codigo;
      throw e;
    }
    throw new Error('no tiró');
  }

  describe('tomarFolio', () => {
    it('sin transacción activa tira, y no toca la base', async () => {
      tx.managerActivo.mockReturnValue(undefined);

      await expect(service.tomarFolio(TENANT, 39)).rejects.toThrow(
        /dentro de db\.transaccion/,
      );
      expect(db.query).not.toHaveBeenCalled();
    });

    it('devuelve el CAF y el folio que salieron', async () => {
      db.query.mockResolvedValueOnce(
        devuelve([{ caf_id: CAF_ID, folio: 4007 }]),
      );

      await expect(service.tomarFolio(TENANT, 39)).resolves.toEqual({
        cafId: CAF_ID,
        folio: 4007,
      });
      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual([TENANT, 39]);
      assertSinHuecos(sql, params);
    });

    it('filtra por la emisora, su ambiente, lo no borrado y lo que aún tiene folios', async () => {
      db.query.mockResolvedValueOnce(devuelve([{ caf_id: CAF_ID, folio: 1 }]));
      await service.tomarFolio(TENANT, 41);

      const [sql] = db.query.mock.calls[0] as [string];
      expect(sql).toContain('f.tenant_id = $1');
      expect(sql).toContain('f.eliminado_el IS NULL');
      expect(sql).toContain('rs.eliminado_el IS NULL');
      expect(sql).toContain('rs.preferida AND rs.habilitado');
      expect(sql).toContain('f.ambiente = rs.ambiente_sii');
      expect(sql).toContain('f.siguiente_folio <= f.hasta');
      expect(sql).toContain('ORDER BY f.desde');
      expect(sql).toContain('FOR UPDATE OF f');
    });

    it('si el primer intento sale vacío, prueba otra vez y devuelve la fila del segundo', async () => {
      db.query
        .mockResolvedValueOnce(devuelve([]))
        .mockResolvedValueOnce(devuelve([{ caf_id: CAF_ID, folio: 6013 }]));

      await expect(service.tomarFolio(TENANT, 39)).resolves.toEqual({
        cafId: CAF_ID,
        folio: 6013,
      });
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('dos intentos vacíos son SIN_FOLIOS, y no hay un tercero', async () => {
      db.query.mockResolvedValue(devuelve([]));

      const error = await service.tomarFolio(TENANT, 41).catch((e) => e);
      expect(error).toBeInstanceOf(DteError);
      expect((error as DteError).codigo).toBe('SIN_FOLIOS');
      expect((error as DteError).message).toContain('tipo 41');
      expect(db.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('credencialesParaFirmar', () => {
    const FILA = {
      xml_cifrado: '',
      caf_ambiente: 'certificacion',
      razon_social_id: RAZON_SOCIAL,
      nombre: 'Panadería Ñuñoa SpA',
      rut: '78.787.878-4',
      direccion: 'Irarrázaval 2401',
      giro: 'Panadería',
      comuna: 'Ñuñoa',
      ambiente_sii: 'certificacion',
      fecha_resolucion: '2026-09-30',
      numero_resolucion: 0,
    };
    const filaCaf = (over: Partial<typeof FILA> = {}) => ({
      ...FILA,
      xml_cifrado: cafDePrueba({
        rut: '78787878-4',
        tipo: 39,
        desde: 4007,
        hasta: 4031,
      }),
      ...over,
    });
    const certificadoGuardado = (venceEl?: Date) => {
      const pfx = certificadoDePrueba(venceEl ? { venceEl } : {});
      const leido = leerCertificado(pfx.pfx, pfx.clave);
      return {
        leido,
        credencial_cifrada: JSON.stringify({
          ...leido,
          venceEl: leido.venceEl.toISOString(),
        }),
      };
    };

    it('arma el CAF, el certificado, el emisor y la carátula', async () => {
      const cert = certificadoGuardado();
      db.query
        .mockResolvedValueOnce([filaCaf()])
        .mockResolvedValueOnce([
          { credencial_cifrada: cert.credencial_cifrada },
        ]);

      const r = await service.credencialesParaFirmar(TENANT, CAF_ID, AHORA);

      expect(r.caf).toMatchObject({
        rutEmisor: '78787878-4',
        tipo: 39,
        desde: 4007,
        hasta: 4031,
      });
      expect(r.certificado.rut).toBe(cert.leido.rut);
      expect(r.certificado.llavePrivadaPem).toBe(cert.leido.llavePrivadaPem);
      expect(r.certificado.venceEl).toBeInstanceOf(Date);
      expect(r.certificado.venceEl.getTime()).toBe(
        cert.leido.venceEl.getTime(),
      );
      expect(r.emisor).toEqual({
        rut: '78787878-4',
        razonSocial: 'Panadería Ñuñoa SpA',
        giro: 'Panadería',
        direccion: 'Irarrázaval 2401',
        comuna: 'Ñuñoa',
      });
      expect(r.emisor).not.toHaveProperty('cdgSiiSucur');
      // El número de resolución 0 es válido (certificación): no se confunde con "falta".
      expect(r.caratula).toEqual({
        rutEmisor: '78787878-4',
        rutReceptor: '60803000-K',
        fchResol: '2026-09-30',
        nroResol: 0,
      });
    });

    it('busca el CAF y el certificado por tenant, sin borrados ni reemplazados', async () => {
      const cert = certificadoGuardado();
      db.query
        .mockResolvedValueOnce([filaCaf()])
        .mockResolvedValueOnce([
          { credencial_cifrada: cert.credencial_cifrada },
        ]);
      await service.credencialesParaFirmar(TENANT, CAF_ID, AHORA);

      const [sqlCaf, paramsCaf] = db.query.mock.calls[0] as [string, unknown[]];
      expect(paramsCaf).toEqual([TENANT, CAF_ID]);
      expect(sqlCaf).toContain('f.tenant_id = $1');
      expect(sqlCaf).toContain('f.eliminado_el IS NULL');
      expect(sqlCaf).toContain('rs.eliminado_el IS NULL');
      assertSinHuecos(sqlCaf, paramsCaf);

      const [sqlCert, paramsCert] = db.query.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(paramsCert).toEqual([RAZON_SOCIAL, TENANT]);
      expect(sqlCert).toContain('reemplazado_el IS NULL');
      expect(sqlCert).toContain('eliminado_el IS NULL');
      assertSinHuecos(sqlCert, paramsCert);
    });

    it('sin CAF (de otro tenant, borrado o inexistente): SIN_FOLIOS', async () => {
      db.query.mockResolvedValueOnce([]);

      expect(
        await codigoDe(service.credencialesParaFirmar(TENANT, CAF_ID, AHORA)),
      ).toBe('SIN_FOLIOS');
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['giro', 'el giro'],
      ['comuna', 'la comuna'],
      ['direccion', 'la dirección'],
      ['ambiente_sii', 'el ambiente'],
      ['fecha_resolucion', 'la fecha de la resolución'],
      ['numero_resolucion', 'el número de la resolución'],
    ])(
      'sin %s: PERFIL_INCOMPLETO nombrando el dato',
      async (columna, texto) => {
        db.query.mockResolvedValueOnce([filaCaf({ [columna]: null })]);

        const error = await service
          .credencialesParaFirmar(TENANT, CAF_ID, AHORA)
          .catch((e) => e);
        expect(error).toBeInstanceOf(DteError);
        expect((error as DteError).codigo).toBe('PERFIL_INCOMPLETO');
        expect((error as DteError).message).toContain(texto);
        // No sigue a buscar el certificado: ya sabe que no puede emitir.
        expect(db.query).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      ['giro', 'el giro'],
      ['comuna', 'la comuna'],
      ['direccion', 'la dirección'],
    ])(
      '%s con solo espacios cuenta como vacío (igual que evaluarPerfil): PERFIL_INCOMPLETO',
      async (columna, texto) => {
        db.query.mockResolvedValueOnce([filaCaf({ [columna]: '   ' })]);

        const error = await service
          .credencialesParaFirmar(TENANT, CAF_ID, AHORA)
          .catch((e) => e);
        expect(error).toBeInstanceOf(DteError);
        expect((error as DteError).codigo).toBe('PERFIL_INCOMPLETO');
        expect((error as DteError).message).toContain(texto);
        expect(db.query).toHaveBeenCalledTimes(1);
      },
    );

    it('el CAF es de otro ambiente que el de la empresa: AMBIENTE_DISTINTO, sin buscar el certificado', async () => {
      db.query.mockResolvedValueOnce([filaCaf({ ambiente_sii: 'produccion' })]);

      const error = await service
        .credencialesParaFirmar(TENANT, CAF_ID, AHORA)
        .catch((e) => e);
      expect(error).toBeInstanceOf(DteError);
      expect((error as DteError).codigo).toBe('AMBIENTE_DISTINTO');
      expect((error as DteError).message).toContain('cambió de ambiente');
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('sin certificado vigente: SIN_CERTIFICADO', async () => {
      db.query.mockResolvedValueOnce([filaCaf()]).mockResolvedValueOnce([]);

      expect(
        await codigoDe(service.credencialesParaFirmar(TENANT, CAF_ID, AHORA)),
      ).toBe('SIN_CERTIFICADO');
    });

    it('certificado que vence justo ahora o antes: CERTIFICADO_VENCIDO', async () => {
      const cert = certificadoGuardado(new Date('2026-10-14T13:07:00Z'));
      for (const ahora of [
        new Date('2026-10-14T13:07:00Z'),
        new Date('2026-10-15T00:00:00Z'),
      ]) {
        db.query
          .mockResolvedValueOnce([filaCaf()])
          .mockResolvedValueOnce([
            { credencial_cifrada: cert.credencial_cifrada },
          ]);
        expect(
          await codigoDe(service.credencialesParaFirmar(TENANT, CAF_ID, ahora)),
        ).toBe('CERTIFICADO_VENCIDO');
      }
    });

    it('un certificado que vence un segundo después de ahora todavía firma', async () => {
      const cert = certificadoGuardado(new Date('2026-10-14T13:07:01Z'));
      db.query
        .mockResolvedValueOnce([filaCaf()])
        .mockResolvedValueOnce([
          { credencial_cifrada: cert.credencial_cifrada },
        ]);

      await expect(
        service.credencialesParaFirmar(TENANT, CAF_ID, AHORA),
      ).resolves.toBeDefined();
    });
  });
});
