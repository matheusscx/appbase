import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MediosPagoOnlineService } from './medios-pago-online.service';
import { InscripcionesService } from '../pasarela/services/inscripciones.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const USUARIO_ID = '550e8400-e29b-41d4-a716-446655440001';

describe('MediosPagoOnlineService', () => {
  let service: MediosPagoOnlineService;
  const inscripciones = {
    listarPorPagador: jest.fn(),
    iniciar: jest.fn(),
    eliminar: jest.fn(),
    marcarPreferida: jest.fn(),
  };
  const tenantPasarela = { resolverConfiguracionActiva: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('http://localhost:5173') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediosPagoOnlineService,
        { provide: InscripcionesService, useValue: inscripciones },
        { provide: TenantPasarelaService, useValue: tenantPasarela },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(MediosPagoOnlineService);
  });

  it('listar: filtra solo inscripciones activas y reporta disponibilidad', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    inscripciones.listarPorPagador.mockResolvedValue([
      {
        inscripcionId: 'i-1',
        estado: 'activa',
        preferida: false,
        mediosPago: [],
      },
      {
        inscripcionId: 'i-2',
        estado: 'pendiente',
        preferida: false,
        mediosPago: [],
      },
      {
        inscripcionId: 'i-3',
        estado: 'fallida',
        preferida: false,
        mediosPago: [],
      },
    ]);
    const res = await service.listar(TENANT_ID, USUARIO_ID);
    expect(inscripciones.listarPorPagador).toHaveBeenCalledWith(
      TENANT_ID,
      USUARIO_ID,
    );
    expect(tenantPasarela.resolverConfiguracionActiva).toHaveBeenCalledWith(
      TENANT_ID,
      'oneclick',
    );
    expect(res.oneclickDisponible).toBe(true);
    expect(res.medios.map((m) => m.inscripcionId)).toEqual(['i-1']);
  });

  it('listar: oneclickDisponible=false cuando el tenant no tiene la pasarela', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockRejectedValue(
      new Error('sin config'),
    );
    inscripciones.listarPorPagador.mockResolvedValue([]);
    const res = await service.listar(TENANT_ID, USUARIO_ID);
    expect(res.oneclickDisponible).toBe(false);
    expect(res.medios).toEqual([]);
  });

  it('iniciar: pagadorRef=usuarioId, urlRetorno del FRONTEND_URL y TBK_TOKEN embebido', async () => {
    inscripciones.iniciar.mockResolvedValue({
      inscripcionId: 'i-1',
      urlWebpay: 'https://webpay/init',
      token: 'tok-99',
    });
    const res = await service.iniciar(TENANT_ID, USUARIO_ID, 'user@x.cl');
    expect(inscripciones.iniciar).toHaveBeenCalledWith(TENANT_ID, {
      pagadorRef: USUARIO_ID,
      email: 'user@x.cl',
      urlRetorno: 'http://localhost:5173/tienda/medios-pago',
    });
    expect(res).toEqual({
      inscripcionId: 'i-1',
      urlWebpay: 'https://webpay/init?TBK_TOKEN=tok-99',
    });
  });

  it('eliminar y marcarPreferida delegan con ownership del usuario', async () => {
    inscripciones.eliminar.mockResolvedValue({ inscripcionId: 'i-1' });
    inscripciones.marcarPreferida.mockResolvedValue({
      inscripcionId: 'i-1',
      preferida: true,
    });
    await service.eliminar(TENANT_ID, USUARIO_ID, 'i-1');
    await service.marcarPreferida(TENANT_ID, USUARIO_ID, 'i-1');
    expect(inscripciones.eliminar).toHaveBeenCalledWith(
      TENANT_ID,
      'i-1',
      USUARIO_ID,
    );
    expect(inscripciones.marcarPreferida).toHaveBeenCalledWith(
      TENANT_ID,
      'i-1',
      USUARIO_ID,
    );
  });
});
