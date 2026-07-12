import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
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
    // Claim atómico del retorno: por defecto la request gana (affected 1)
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    softRemove: jest.fn(),
  };
  const medioRepo = {
    create: jest.fn((x: Partial<PasarelaMedioPago>) => x),
    save: jest.fn((x: Partial<PasarelaMedioPago>) => Promise.resolve(x)),
    update: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
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
  const managerMock = { update: jest.fn() };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof managerMock) => Promise<unknown>) =>
      cb(managerMock),
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
          useValue: { getTokenizado: jest.fn().mockReturnValue(provider) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
        { provide: getDataSourceToken(), useValue: dataSource },
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
    const llamada = (
      provider.iniciarInscripcion.mock.calls[0] as [
        unknown,
        { username: string; responseUrl: string },
      ]
    )[1];
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
    inscripcionRepo.update.mockResolvedValue({ affected: 0 });
    await expect(service.confirmarRetorno('tok-x')).rejects.toThrow(
      'Inscripción no encontrada',
    );
  });

  it('confirmarRetorno: segundo retorno concurrente (claim ya tomado) no reprocesa', async () => {
    // El claim atómico ya lo ganó otra request → affected 0, no llama al proveedor
    inscripcionRepo.update.mockResolvedValue({ affected: 0 });
    await expect(service.confirmarRetorno('tok-1')).rejects.toThrow(
      'Inscripción no encontrada',
    );
    expect(provider.confirmarInscripcion).not.toHaveBeenCalled();
    expect(medioRepo.save).not.toHaveBeenCalled();
    expect(transacciones.registrar).not.toHaveBeenCalled();
  });

  it('confirmarRetorno: si el proveedor falla tras el claim, revierte a pendiente', async () => {
    inscripcionRepo.update.mockResolvedValue({ affected: 1 });
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-uuid-1',
      tenantId: 't-1',
      tenantPasarelaId: 'tp-1',
      estado: 'procesando',
      urlRetornoApp: 'https://app/vuelta',
      tokenProveedor: 'tok-1',
    });
    provider.confirmarInscripcion.mockRejectedValue(
      new Error('timeout Transbank'),
    );
    await expect(service.confirmarRetorno('tok-1')).rejects.toThrow('timeout');
    // compensación: update de 'procesando' → 'pendiente' (además del claim inicial)
    expect(inscripcionRepo.update).toHaveBeenLastCalledWith(
      { inscripcionId: 'insc-uuid-1', estado: 'procesando' },
      { estado: 'pendiente' },
    );
    expect(medioRepo.save).not.toHaveBeenCalled();
  });

  it('eliminar: persiste estado eliminada con save antes del softRemove', async () => {
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-uuid-1',
      tenantId: 't-1',
      estado: 'activa',
      identificadorExterno: 'v1:cifrado(tbk-u-1)',
      identificadorUsuarioExterno: 'insc-abc',
    });
    await service.eliminar('t-1', 'insc-uuid-1');
    const guardado = inscripcionRepo.save.mock.calls[0][0];
    expect(guardado.estado).toBe('eliminada');
    expect(inscripcionRepo.softRemove).toHaveBeenCalled();
    expect(medioRepo.update).toHaveBeenCalledWith(
      { inscripcionId: 'insc-uuid-1' },
      { estado: 'eliminado' },
    );
  });

  it('resolverParaCobro exige inscripción activa', async () => {
    inscripcionRepo.findOne.mockResolvedValue(null);
    await expect(
      service.resolverParaCobro('t-1', undefined, 'rut-123'),
    ).rejects.toThrow('inscripción activa');
  });

  it('marcarPreferida: desmarca las demás del pagador y marca la pedida', async () => {
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-uuid-1',
      tenantId: 't-1',
      pagadorRef: 'user-1',
      estado: 'activa',
      preferida: false,
    });
    const res = await service.marcarPreferida('t-1', 'insc-uuid-1', 'user-1');
    expect(managerMock.update).toHaveBeenNthCalledWith(
      1,
      PasarelaInscripcion,
      { tenantId: 't-1', pagadorRef: 'user-1', preferida: true },
      { preferida: false },
    );
    expect(managerMock.update).toHaveBeenNthCalledWith(
      2,
      PasarelaInscripcion,
      { inscripcionId: 'insc-uuid-1' },
      { preferida: true },
    );
    expect(res.preferida).toBe(true);
  });

  it('marcarPreferida: exige activa y ownership del pagador cuando viene', async () => {
    inscripcionRepo.findOne.mockResolvedValue(null);
    await expect(
      service.marcarPreferida('t-1', 'insc-uuid-1', 'user-ajeno'),
    ).rejects.toThrow('Inscripción activa no encontrada');
    expect(inscripcionRepo.findOne).toHaveBeenCalledWith({
      where: {
        inscripcionId: 'insc-uuid-1',
        tenantId: 't-1',
        estado: 'activa',
        pagadorRef: 'user-ajeno',
      },
    });
    expect(managerMock.update).not.toHaveBeenCalled();
  });

  it('eliminar: con pagadorRef ajeno no encuentra y NO llama al proveedor', async () => {
    inscripcionRepo.findOne.mockResolvedValue(null);
    await expect(
      service.eliminar('t-1', 'insc-uuid-1', 'user-ajeno'),
    ).rejects.toThrow('Inscripción activa no encontrada');
    expect(inscripcionRepo.findOne).toHaveBeenCalledWith({
      where: {
        inscripcionId: 'insc-uuid-1',
        tenantId: 't-1',
        estado: 'activa',
        pagadorRef: 'user-ajeno',
      },
    });
    expect(provider.eliminarInscripcion).not.toHaveBeenCalled();
  });

  it('resolverParaCobro sin id: prioriza la preferida sobre la más reciente', async () => {
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-pref',
      estado: 'activa',
    });
    await service.resolverParaCobro('t-1', undefined, 'user-1');
    expect(inscripcionRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 't-1', pagadorRef: 'user-1', estado: 'activa' },
      order: { preferida: 'DESC', creadoEl: 'DESC' },
    });
  });
});
