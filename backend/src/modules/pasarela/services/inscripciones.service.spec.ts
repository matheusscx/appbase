import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { InscripcionesService } from './inscripciones.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';
import { PasarelaInscripcion } from '../entities/pasarela-inscripcion.entity';
import { PasarelaMedioPago } from '../entities/pasarela-medio-pago.entity';

describe('InscripcionesService', () => {
  let service: InscripcionesService;
  const inscripcionRepo = {
    create: jest.fn((x: Partial<PasarelaInscripcion>) => x),
    save: jest.fn((x: Partial<PasarelaInscripcion>) =>
      Promise.resolve({ inscripcionId: 'insc-uuid-1', ...x }),
    ),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };
  const medioRepo = {
    create: jest.fn((x: Partial<PasarelaMedioPago>) => x),
    save: jest.fn((x: Partial<PasarelaMedioPago>) => Promise.resolve(x)),
    update: jest.fn(),
  };
  const provider = {
    iniciarInscripcion: jest.fn().mockResolvedValue({
      tokenExterno: 'tok-1',
      urlRedireccion: 'https://webpay/init',
      aprobada: true,
      codigoRespuesta: null,
      request: {},
      response: {},
    }),
    confirmarInscripcion: jest.fn(),
    eliminarInscripcion: jest.fn().mockResolvedValue(undefined),
  };
  const tenantPasarela = {
    resolverConfiguracionActiva: jest.fn().mockResolvedValue({
      tenantPasarela: { tenantPasarelaId: 'tp-1' },
      pasarela: { codigo: 'oneclick' },
      cred: { baseUrl: 'x' },
    }),
  };
  const transacciones = {
    registrar: jest.fn().mockResolvedValue({ transaccionId: 'tx-1' }),
  };
  const credenciales = {
    cifrarTexto: jest.fn((t: string) => `v1:cifrado(${t})`),
    descifrarTexto: jest.fn((b: string) =>
      b.replace(/^v1:cifrado\((.*)\)$/, '$1'),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        InscripcionesService,
        {
          provide: getRepositoryToken(PasarelaInscripcion),
          useValue: inscripcionRepo,
        },
        { provide: getRepositoryToken(PasarelaMedioPago), useValue: medioRepo },
        { provide: TenantPasarelaService, useValue: tenantPasarela },
        { provide: TransaccionesService, useValue: transacciones },
        { provide: CredencialesService, useValue: credenciales },
        {
          provide: ProviderFactory,
          useValue: { get: jest.fn().mockReturnValue(provider) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
      ],
    }).compile();
    service = module.get(InscripcionesService);
  });

  it('iniciar: genera username insc-<uuid> (nunca el pagadorRef) y guarda el token', async () => {
    const res = await service.iniciar('t-1', {
      pagadorRef: 'rut-123',
      email: 'a@b.cl',
      urlRetorno: 'https://app/vuelta',
    });
    expect(res.urlWebpay).toBe('https://webpay/init');
    const llamada = provider.iniciarInscripcion.mock.calls[0][1] as {
      username: string;
      responseUrl: string;
    };
    expect(llamada.username).toMatch(/^insc-[a-f0-9]{32}$/);
    expect(llamada.username).not.toContain('rut-123');
    expect(llamada.responseUrl).toBe(
      'http://localhost:3000/api/pasarela/retorno/inscripcion',
    );
  });

  it('confirmarRetorno aprobado: activa, cifra tbkUser, crea medio y transacción INSCRIPTION', async () => {
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-uuid-1',
      tenantId: 't-1',
      tenantPasarelaId: 'tp-1',
      estado: 'pendiente',
      urlRetornoApp: 'https://app/vuelta',
      tokenProveedor: 'tok-1',
    });
    provider.confirmarInscripcion.mockResolvedValue({
      aprobada: true,
      codigoRespuesta: '0',
      identificadorExterno: 'tbk-u-1',
      codigoAutorizacion: '1213',
      tarjeta: { tipo: 'TARJETA', marca: 'Visa', ultimos4: '6623' },
      request: {},
      response: {},
    });
    const res = await service.confirmarRetorno('tok-1');
    expect(res.urlRedireccion).toBe(
      'https://app/vuelta?inscripcionId=insc-uuid-1&estado=activa',
    );
    const inscripcionGuardada = inscripcionRepo.save.mock.calls[0][0];
    expect(inscripcionGuardada.estado).toBe('activa');
    expect(inscripcionGuardada.identificadorExterno).toBe(
      'v1:cifrado(tbk-u-1)',
    );
    expect(medioRepo.save).toHaveBeenCalled();
    expect(transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'INSCRIPTION', estado: 'aprobada' }),
    );
  });

  it('confirmarRetorno rechazado: fallida + transacción rechazada, sin medio de pago', async () => {
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-uuid-1',
      tenantId: 't-1',
      tenantPasarelaId: 'tp-1',
      estado: 'pendiente',
      urlRetornoApp: 'https://app/vuelta',
      tokenProveedor: 'tok-1',
    });
    provider.confirmarInscripcion.mockResolvedValue({
      aprobada: false,
      codigoRespuesta: '-96',
      identificadorExterno: null,
      codigoAutorizacion: null,
      tarjeta: null,
      request: {},
      response: {},
    });
    const res = await service.confirmarRetorno('tok-1');
    expect(res.urlRedireccion).toContain('estado=fallida');
    expect(medioRepo.save).not.toHaveBeenCalled();
  });

  it('confirmarRetorno con token desconocido lanza NotFound', async () => {
    inscripcionRepo.findOne.mockResolvedValue(null);
    await expect(service.confirmarRetorno('tok-x')).rejects.toThrow(
      'Inscripción no encontrada',
    );
  });

  it('resolverParaCobro exige inscripción activa', async () => {
    inscripcionRepo.findOne.mockResolvedValue(null);
    await expect(
      service.resolverParaCobro('t-1', undefined, 'rut-123'),
    ).rejects.toThrow('inscripción activa');
  });
});
