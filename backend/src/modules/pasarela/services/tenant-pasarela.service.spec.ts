import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Db } from '../../../common/db/db.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { CredencialesService } from './credenciales.service';
import { TenantPasarela } from '../entities/tenant-pasarela.entity';
import { Pasarela } from '../entities/pasarela.entity';
import { MonedasService } from '../../monedas/monedas.service';

describe('TenantPasarelaService', () => {
  let service: TenantPasarelaService;
  const tpRepo = {
    create: jest.fn((x: Partial<TenantPasarela>) => x),
    save: jest.fn((x: Partial<TenantPasarela>) =>
      Promise.resolve({ tenantPasarelaId: 'tp-1', ...x }),
    ),
    findOne: jest.fn(),
    softRemove: jest.fn(),
  };
  const pasarelaRepo = { findOne: jest.fn(), find: jest.fn() };
  const monedas = { codigoIsoOficial: jest.fn() };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  const credenciales = {
    cifrarJson: jest.fn().mockReturnValue('v1:blob'),
    resolver: jest.fn().mockReturnValue({ baseUrl: 'x' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    monedas.codigoIsoOficial.mockResolvedValue('CLP');
    const module = await Test.createTestingModule({
      providers: [
        TenantPasarelaService,
        { provide: getRepositoryToken(TenantPasarela), useValue: tpRepo },
        { provide: getRepositoryToken(Pasarela), useValue: pasarelaRepo },
        {
          provide: Db,
          useValue: {
            query: dataSource.query,
            transaccion: (fn: (m: unknown) => unknown) => fn(undefined),
            sinTransaccion: (fn: () => unknown) => fn(),
          },
        },
        { provide: CredencialesService, useValue: credenciales },
        { provide: MonedasService, useValue: monedas },
      ],
    }).compile();
    service = module.get(TenantPasarelaService);
  });

  it('crear: cifra la configuración y no la devuelve', async () => {
    pasarelaRepo.findOne.mockResolvedValue({
      pasarelaId: 'p-1',
      codigo: 'webpay',
      nombre: 'Webpay',
      activo: true,
      soportaMall: true,
    });
    const res = await service.crear('t-1', {
      pasarelaId: 'p-1',
      ambiente: 'pruebas',
      modoIntegracion: 'mall',
      configuracion: { commerceCodeHijo: '5970...' },
    });
    expect(credenciales.cifrarJson).toHaveBeenCalledWith({
      commerceCodeHijo: '5970...',
    });
    expect(JSON.stringify(res)).not.toContain('5970...');
    expect(res).toMatchObject({
      tenantPasarelaId: 'tp-1',
      pasarelaId: 'p-1',
      codigo: 'webpay',
      nombre: 'Webpay',
      tieneCredenciales: true,
    });
  });

  it('crear: rechaza pasarela global inexistente o inactiva', async () => {
    pasarelaRepo.findOne.mockResolvedValue(null);
    await expect(
      service.crear('t-1', {
        pasarelaId: 'nope',
        ambiente: 'pruebas',
        modoIntegracion: 'mall',
      }),
    ).rejects.toThrow('Pasarela no disponible');
  });

  it('actualizar: NO toca configuracion si el dto no la trae (write-only)', async () => {
    tpRepo.findOne.mockResolvedValue({
      tenantPasarelaId: 'tp-1',
      tenantId: 't-1',
      configuracion: 'v1:anterior',
      activo: true,
    });
    await service.actualizar('t-1', 'tp-1', { activo: false });
    const guardado = tpRepo.save.mock.calls[0][0];
    expect(guardado.configuracion).toBe('v1:anterior');
    expect(guardado.activo).toBe(false);
  });

  it('actualizar: configuracion null explícito limpia credenciales sin cifrar "null"', async () => {
    tpRepo.findOne.mockResolvedValue({
      tenantPasarelaId: 'tp-1',
      tenantId: 't-1',
      configuracion: 'v1:anterior',
      activo: true,
    });
    await service.actualizar('t-1', 'tp-1', {
      configuracion: null,
    } as unknown as Parameters<typeof service.actualizar>[2]);
    const guardado = tpRepo.save.mock.calls[0][0];
    expect(guardado.configuracion).toBeNull();
    expect(credenciales.cifrarJson).not.toHaveBeenCalled();
  });

  it('resolverConfiguracionActiva: rechaza si el tenant no tiene la pasarela activa', async () => {
    tpRepo.findOne.mockResolvedValue(null);
    dataSource.query.mockResolvedValue([]);
    await expect(
      service.resolverConfiguracionActiva('t-1', 'oneclick'),
    ).rejects.toThrow('no tiene configurada');
  });

  /**
   * Oneclick y Webpay Plus son de Transbank y liquidan en pesos chilenos
   * (`MONEDA_ORDEN_V1`): un local de otro país no los puede configurar (owner,
   * 2026-09-13). Antes podía, y el checkout online mandaba el total en su
   * moneda como si fuera CLP. La demo no cobra, así que queda para todos.
   */
  describe('Oneclick y Webpay, solo para locales de Chile', () => {
    const pasarela = (codigo: string, soportaMall = true) => ({
      pasarelaId: `p-${codigo}`,
      codigo,
      nombre: codigo,
      activo: true,
      soportaMall,
    });

    it.each(['oneclick', 'webpay_plus'])(
      'crear: rechaza %s si la moneda oficial del local no es CLP',
      async (codigo) => {
        monedas.codigoIsoOficial.mockResolvedValue('MXN');
        pasarelaRepo.findOne.mockResolvedValue(pasarela(codigo));
        await expect(
          service.crear('t-mx', {
            pasarelaId: `p-${codigo}`,
            ambiente: 'pruebas',
            modoIntegracion: 'mall',
          }),
        ).rejects.toThrow('solo están disponibles para locales de Chile');
        expect(monedas.codigoIsoOficial).toHaveBeenCalledWith('t-mx');
        expect(tpRepo.save).not.toHaveBeenCalled();
      },
    );

    it('crear: en Chile, Webpay se configura', async () => {
      pasarelaRepo.findOne.mockResolvedValue(pasarela('webpay_plus'));
      await service.crear('t-cl', {
        pasarelaId: 'p-webpay_plus',
        ambiente: 'pruebas',
        modoIntegracion: 'mall',
      });
      expect(tpRepo.save).toHaveBeenCalled();
    });

    it('crear: la demo se configura fuera de Chile', async () => {
      monedas.codigoIsoOficial.mockResolvedValue('MXN');
      pasarelaRepo.findOne.mockResolvedValue(pasarela('demo', false));
      await service.crear('t-mx', {
        pasarelaId: 'p-demo',
        ambiente: 'pruebas',
        modoIntegracion: 'individual',
      });
      expect(tpRepo.save).toHaveBeenCalled();
    });

    /**
     * El alta ya lo rechaza, así que un local de otro país solo tendría una config de Transbank
     * si viniera de antes de la regla. El owner pidió cortar también ahí (2026-09-13): editarla
     * —prenderla, sobre todo— responde lo mismo que el alta.
     */
    it('actualizar: rechaza editar una config de Transbank en un local fuera de Chile', async () => {
      monedas.codigoIsoOficial.mockResolvedValue('MXN');
      tpRepo.findOne.mockResolvedValue({
        tenantPasarelaId: 'tp-mx',
        tenantId: 't-mx',
        pasarelaId: 'p-oneclick',
        activo: false,
      });
      pasarelaRepo.findOne.mockResolvedValue(pasarela('oneclick'));
      await expect(
        service.actualizar('t-mx', 'tp-mx', { activo: true }),
      ).rejects.toThrow('solo están disponibles para locales de Chile');
      expect(tpRepo.save).not.toHaveBeenCalled();
    });

    it('actualizar: en Chile, prender Webpay se guarda', async () => {
      tpRepo.findOne.mockResolvedValue({
        tenantPasarelaId: 'tp-cl',
        tenantId: 't-cl',
        pasarelaId: 'p-webpay_plus',
        activo: false,
      });
      pasarelaRepo.findOne.mockResolvedValue(pasarela('webpay_plus'));
      await service.actualizar('t-cl', 'tp-cl', { activo: true });
      expect(tpRepo.save).toHaveBeenCalled();
    });

    it('actualizar: la demo se edita fuera de Chile', async () => {
      monedas.codigoIsoOficial.mockResolvedValue('MXN');
      tpRepo.findOne.mockResolvedValue({
        tenantPasarelaId: 'tp-demo',
        tenantId: 't-mx',
        pasarelaId: 'p-demo',
        activo: false,
      });
      pasarelaRepo.findOne.mockResolvedValue(pasarela('demo', false));
      await service.actualizar('t-mx', 'tp-demo', { activo: true });
      expect(tpRepo.save).toHaveBeenCalled();
    });

    it('el catálogo no le ofrece Oneclick ni Webpay a un local fuera de Chile', async () => {
      pasarelaRepo.find.mockResolvedValue([
        pasarela('demo', false),
        pasarela('oneclick'),
        pasarela('webpay_plus'),
      ]);
      const codigos = async (tenantId: string) =>
        (await service.listarPasarelasGlobales(tenantId)).map((p) => p.codigo);

      monedas.codigoIsoOficial.mockResolvedValue('MXN');
      expect(await codigos('t-mx')).toEqual(['demo']);

      monedas.codigoIsoOficial.mockResolvedValue('CLP');
      expect(await codigos('t-cl')).toEqual([
        'demo',
        'oneclick',
        'webpay_plus',
      ]);
    });
  });
});
