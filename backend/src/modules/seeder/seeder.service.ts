import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Moneda } from '../catalog/entities/moneda.entity';
import { Pais } from '../catalog/entities/pais.entity';
import { UnidadMedida } from '../catalog/entities/unidad-medida.entity';
import { Provincia } from '../catalog/entities/provincia.entity';
import { ModuloApp } from '../catalog/entities/modulo-app.entity';
import { Permiso } from '../catalog/entities/permiso.entity';
import { ModuloAppPermiso } from '../catalog/entities/modulo-app-permiso.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from '../tenants/entities/tenant-formula-precio.entity';
import { Usuario } from '../users/usuario.entity';
import { RazonSocial } from '../tenants/entities/razon-social.entity';
import { PaisMoneda } from '../monedas/entities/pais-moneda.entity';
import { TenantMoneda } from '../monedas/entities/tenant-moneda.entity';
import { MetodoPago } from '../metodos-pago/entities/metodo-pago.entity';
import { MetodoPagoPais } from '../metodos-pago/entities/metodo-pago-pais.entity';
import { TenantMetodoPago } from '../metodos-pago/entities/tenant-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { Categoria } from '../categorias/entities/categoria.entity';
import { Impuesto } from '../impuestos/entities/impuesto.entity';
import { Descuento } from '../descuentos/entities/descuento.entity';
import { DescuentoTramo } from '../descuentos/entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from '../descuentos/entities/descuento-metodo-pago.entity';
import { Recargo } from '../recargos/entities/recargo.entity';
import { RecargoTramo } from '../recargos/entities/recargo-tramo.entity';
import { RecargoMetodoPago } from '../recargos/entities/recargo-metodo-pago.entity';
import { ModoRegla, CondicionTipo } from '../../common/enums/reglas.enums';
import { TipoDocumentoTributario } from '../ventas/entities/tipo-documento-tributario.entity';
import { Tercero } from '../terceros/entities/tercero.entity';
import { Garzon } from '../garzones/entities/garzon.entity';
import { Turno } from '../turnos/entities/turno.entity';
import { Impresora } from '../impresoras/entities/impresora.entity';
import { PropinaConfiguracion } from '../propinas/entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from '../propinas/entities/propina-grupo-distribucion.entity';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { CriterioDistribucion } from '../propinas/enums/criterio-distribucion.enum';
import { BaseVentasGrupo } from '../propinas/enums/base-ventas-grupo.enum';
import { Caja } from '../caja/entities/caja.entity';
import { Pasarela } from '../pasarela/entities/pasarela.entity';
import { TenantPasarela } from '../pasarela/entities/tenant-pasarela.entity';
import { CredencialesService } from '../pasarela/services/credenciales.service';
import { Salon } from '../salones/entities/salon.entity';
import { Mesa, FormaMesa, TamanoMesa } from '../salones/entities/mesa.entity';
import { CAUSAS_MERMA_FIJAS } from '../mermas/causas-merma.defaults';

@Injectable()
export class SeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeederService.name);

  constructor(
    @InjectRepository(Moneda)
    private readonly monedaRepo: Repository<Moneda>,
    @InjectRepository(UnidadMedida)
    private readonly unidadMedidaRepo: Repository<UnidadMedida>,
    @InjectRepository(Pais)
    private readonly paisRepo: Repository<Pais>,
    @InjectRepository(Provincia)
    private readonly provinciaRepo: Repository<Provincia>,
    @InjectRepository(ModuloApp)
    private readonly moduloAppRepo: Repository<ModuloApp>,
    @InjectRepository(Permiso)
    private readonly permisoRepo: Repository<Permiso>,
    @InjectRepository(ModuloAppPermiso)
    private readonly moduloAppPermisoRepo: Repository<ModuloAppPermiso>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantModulo)
    private readonly tenantModuloRepo: Repository<TenantModulo>,
    @InjectRepository(TenantFormulaPrecio)
    private readonly tenantFormulaPrecioRepo: Repository<TenantFormulaPrecio>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(RazonSocial)
    private readonly razonSocialRepo: Repository<RazonSocial>,
    @InjectRepository(PaisMoneda)
    private readonly paisMonedaRepo: Repository<PaisMoneda>,
    @InjectRepository(TenantMoneda)
    private readonly tenantMonedaRepo: Repository<TenantMoneda>,
    @InjectRepository(MetodoPago)
    private readonly metodoPagoRepo: Repository<MetodoPago>,
    @InjectRepository(MetodoPagoPais)
    private readonly metodoPagoPaisRepo: Repository<MetodoPagoPais>,
    @InjectRepository(TenantMetodoPago)
    private readonly tenantMetodoPagoRepo: Repository<TenantMetodoPago>,
    @InjectRepository(TipoRegla)
    private readonly tipoReglaRepo: Repository<TipoRegla>,
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    @InjectRepository(Impuesto)
    private readonly impuestoRepo: Repository<Impuesto>,
    @InjectRepository(Descuento)
    private readonly descuentoRepo: Repository<Descuento>,
    @InjectRepository(DescuentoTramo)
    private readonly descuentoTramoRepo: Repository<DescuentoTramo>,
    @InjectRepository(Recargo)
    private readonly recargoRepo: Repository<Recargo>,
    @InjectRepository(RecargoTramo)
    private readonly recargoTramoRepo: Repository<RecargoTramo>,
    @InjectRepository(DescuentoMetodoPago)
    private readonly descuentoMetodoPagoRepo: Repository<DescuentoMetodoPago>,
    @InjectRepository(RecargoMetodoPago)
    private readonly recargoMetodoPagoRepo: Repository<RecargoMetodoPago>,
    @InjectRepository(TipoDocumentoTributario)
    private readonly tipoDocumentoRepo: Repository<TipoDocumentoTributario>,
    @InjectRepository(Tercero)
    private readonly terceroRepo: Repository<Tercero>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(Pasarela)
    private readonly pasarelaRepo: Repository<Pasarela>,
    @InjectRepository(TenantPasarela)
    private readonly tenantPasarelaRepo: Repository<TenantPasarela>,
    @InjectRepository(Salon)
    private readonly salonRepo: Repository<Salon>,
    @InjectRepository(Mesa)
    private readonly mesaRepo: Repository<Mesa>,
    @InjectRepository(Garzon)
    private readonly garzonRepo: Repository<Garzon>,
    @InjectRepository(Turno)
    private readonly turnoRepo: Repository<Turno>,
    @InjectRepository(Impresora)
    private readonly impresoraRepo: Repository<Impresora>,
    @InjectRepository(PropinaConfiguracion)
    private readonly propinaConfigRepo: Repository<PropinaConfiguracion>,
    @InjectRepository(PropinaGrupoDistribucion)
    private readonly propinaGrupoRepo: Repository<PropinaGrupoDistribucion>,
    private readonly credencialesService: CredencialesService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    this.logger.log('Running dev seed...');

    await this.seedMonedas();
    await this.seedUnidadesMedida();
    await this.seedMetodosPago();
    await this.seedTiposRegla();
    await this.seedPais();
    await this.seedPaisMonedas();
    await this.seedMetodoPagoPais();
    await this.seedProvincias();
    await this.seedModulosApp();
    await this.seedPermisos();
    await this.seedModuloAppPermisos();
    await this.seedTenants();
    await this.seedCausasMerma();
    await this.seedCajasVirtuales();
    await this.seedPropinaConfiguracion();
    await this.seedTerceros();
    await this.seedTenantMonedas();
    await this.seedTenantMetodosPago();
    await this.seedImpresoras();
    await this.seedCategorias();
    await this.seedImpuestos();
    await this.seedDescuentos();
    await this.seedDescuentoTramos();
    await this.seedDescuentoMetodosPago();
    await this.seedRecargos();
    await this.seedRecargoMetodosPago();
    await this.seedItems();
    await this.seedTiposDocumentoTributario();
    await this.seedRazonesSociales();
    await this.seedUsuarioAdmin();
    await this.seedUsuariosAdicionales();
    await this.seedTenantModulo();
    await this.seedPasarelas();
    await this.seedTenantFormulaPrecio();
    await this.seedUsuariosTenants();
    await this.seedRolesUsuarios();
    await this.seedVendedorPermisosCaja();
    await this.seedSalones();
    await this.seedMesas();
    await this.seedGarzones();
    await this.seedTurnos();

    this.logger.log('Seed complete.');
  }

  private async seedMonedas(): Promise<void> {
    const monedas: Partial<Moneda>[] = [
      {
        monedaId: '550e8400-e29b-41d4-a716-446655440003',
        nombre: 'Peso Chileno',
        codigoIso: 'CLP',
        codigoNumero: '152',
        simbolo: '$',
        decimales: 0,
        separadorDecimal: ',',
        separadorMiles: '.',
        locale: 'es-CL',
      },
      {
        monedaId: '550e8400-e29b-41d4-a716-446655440004',
        nombre: 'Unidad de Fomento',
        codigoIso: 'UF',
        codigoNumero: '990',
        simbolo: '$',
        decimales: 4,
        separadorDecimal: ',',
        separadorMiles: '.',
        locale: 'es-CL',
      },
      {
        monedaId: '550e8400-e29b-41d4-a716-446655440005',
        nombre: 'Dólar Estadounidense',
        codigoIso: 'USD',
        codigoNumero: '840',
        simbolo: '$',
        decimales: 2,
        separadorDecimal: '.',
        separadorMiles: ',',
        locale: 'en-US',
      },
    ];

    for (const data of monedas) {
      const exists = await this.monedaRepo.findOne({
        where: { monedaId: data.monedaId },
      });
      if (!exists) {
        await this.monedaRepo.save(this.monedaRepo.create(data));
      } else {
        await this.monedaRepo.update(
          { monedaId: data.monedaId },
          {
            separadorDecimal: data.separadorDecimal,
            separadorMiles: data.separadorMiles,
            locale: data.locale,
          },
        );
      }
    }
  }

  /**
   * Catálogo global de unidades de medida. `factor_base` = cuántas unidades
   * base de la magnitud equivale 1 de esta (kg → 1000 g; m → 100 cm).
   * Incluye 'unidad', 'kg', 'l' y 'm' como catálogo base de magnitudes; el
   * seed usa 'unidad' y 'kg' (productos e ingredientes demo).
   */
  private async seedUnidadesMedida(): Promise<void> {
    const unidades: Partial<UnidadMedida>[] = [
      {
        unidadMedidaId: '550e8400-e29b-41d4-a716-446655440250',
        codigo: 'g',
        nombre: 'Gramo',
        magnitud: 'masa',
        factorBase: '1',
      },
      {
        unidadMedidaId: '550e8400-e29b-41d4-a716-446655440251',
        codigo: 'kg',
        nombre: 'Kilogramo',
        magnitud: 'masa',
        factorBase: '1000',
      },
      {
        unidadMedidaId: '550e8400-e29b-41d4-a716-446655440252',
        codigo: 'ml',
        nombre: 'Mililitro',
        magnitud: 'volumen',
        factorBase: '1',
      },
      {
        unidadMedidaId: '550e8400-e29b-41d4-a716-446655440253',
        codigo: 'l',
        nombre: 'Litro',
        magnitud: 'volumen',
        factorBase: '1000',
      },
      {
        unidadMedidaId: '550e8400-e29b-41d4-a716-446655440254',
        codigo: 'unidad',
        nombre: 'Unidad',
        magnitud: 'conteo',
        factorBase: '1',
      },
      {
        unidadMedidaId: '550e8400-e29b-41d4-a716-446655440256',
        codigo: 'cm',
        nombre: 'Centímetro',
        magnitud: 'longitud',
        factorBase: '1',
      },
      {
        unidadMedidaId: '550e8400-e29b-41d4-a716-446655440255',
        codigo: 'm',
        nombre: 'Metro',
        magnitud: 'longitud',
        factorBase: '100',
      },
    ];

    for (const data of unidades) {
      const exists = await this.unidadMedidaRepo.findOne({
        where: { codigo: data.codigo },
      });
      if (!exists) {
        await this.unidadMedidaRepo.save(this.unidadMedidaRepo.create(data));
      }
    }

    // DBs antiguas tenían m con factor_base=1 (única unidad de longitud).
    // Alinear a cm como base (m = 100 cm), igual que kg/g.
    await this.unidadMedidaRepo.update(
      { codigo: 'm' },
      { factorBase: '100', nombre: 'Metro', magnitud: 'longitud' },
    );
  }

  private async seedPais(): Promise<void> {
    const paisId = '550e8400-e29b-41d4-a716-446655440000';
    let pais = await this.paisRepo.findOne({ where: { paisId } });

    if (!pais) {
      pais = this.paisRepo.create({
        paisId,
        nombre: 'Chile',
        codigoIso: 'CL',
        zonaHorariaPrincipal: 'America/Santiago',
        monedaOficialId: null,
      });
      await this.paisRepo.save(pais);
    }

    // Siempre asegurar que monedaOficialId quede seteado
    await this.paisRepo.update(
      { paisId },
      { monedaOficialId: '550e8400-e29b-41d4-a716-446655440003' },
    );
  }

  private async seedPaisMonedas(): Promise<void> {
    const CHILE = '550e8400-e29b-41d4-a716-446655440000';
    const monedaIds = [
      '550e8400-e29b-41d4-a716-446655440003', // CLP
      '550e8400-e29b-41d4-a716-446655440004', // UF
      '550e8400-e29b-41d4-a716-446655440005', // USD
    ];

    for (const monedaId of monedaIds) {
      const exists = await this.paisMonedaRepo.findOne({
        where: { paisId: CHILE, monedaId },
      });
      if (!exists) {
        await this.paisMonedaRepo.save(
          this.paisMonedaRepo.create({ paisId: CHILE, monedaId }),
        );
      }
    }
  }

  private async seedTenantMonedas(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const UF = '550e8400-e29b-41d4-a716-446655440004';
    const USD = '550e8400-e29b-41d4-a716-446655440005';

    const entries: Partial<TenantMoneda>[] = [];
    for (const tenantId of [PARIS, FALABELLA]) {
      entries.push(
        {
          tenantId,
          monedaId: CLP,
          esDefault: true,
          habilitada: true,
          valorDelDia: '1',
        },
        {
          tenantId,
          monedaId: UF,
          esDefault: false,
          habilitada: true,
          valorDelDia: '38000',
        },
        {
          tenantId,
          monedaId: USD,
          esDefault: false,
          habilitada: true,
          valorDelDia: '950',
        },
      );
    }

    for (const data of entries) {
      const exists = await this.tenantMonedaRepo.findOne({
        where: { tenantId: data.tenantId, monedaId: data.monedaId },
      });
      if (!exists) {
        await this.tenantMonedaRepo.save(this.tenantMonedaRepo.create(data));
      }
    }
  }

  private async seedProvincias(): Promise<void> {
    const provincias: Partial<Provincia>[] = [
      {
        provinciaId: '550e8400-e29b-41d4-a716-446655440001',
        paisId: '550e8400-e29b-41d4-a716-446655440000',
        nombre: 'Región Metropolitana',
        zonaHoraria: 'America/Santiago',
      },
      {
        provinciaId: '550e8400-e29b-41d4-a716-446655440002',
        paisId: '550e8400-e29b-41d4-a716-446655440000',
        nombre: 'Isla de Pascua',
        zonaHoraria: 'Pacific/Easter',
      },
    ];

    for (const data of provincias) {
      const exists = await this.provinciaRepo.findOne({
        where: { provinciaId: data.provinciaId },
      });
      if (!exists) {
        await this.provinciaRepo.save(this.provinciaRepo.create(data));
      }
    }
  }

  private async seedModulosApp(): Promise<void> {
    const modulos: Partial<ModuloApp>[] = [
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440011',
        nombre: 'Caja',
        url: '/caja',
        icono: 'mdi-cash-register',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440058',
        nombre: 'Ventas',
        url: '/ventas',
        icono: 'mdi-shopping',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440152',
        nombre: 'Tienda Online',
        url: '/tienda',
        icono: 'mdi-storefront-outline',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440172',
        nombre: 'Suscripciones',
        url: '/suscripciones',
        icono: 'mdi-autorenew',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440180',
        nombre: 'Pagos',
        url: '/pagos',
        icono: 'mdi-cash-multiple',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440181',
        nombre: 'Inventario',
        url: '/configuracion/inventario',
        icono: 'mdi-warehouse',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440182',
        nombre: 'Items',
        url: '/configuracion/items',
        icono: 'mdi-package-variant',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440183',
        nombre: 'Terceros',
        url: '/terceros',
        icono: 'mdi-account-multiple-outline',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440208',
        nombre: 'Pasarelas',
        url: '/pasarelas',
        icono: 'mdi-credit-card-settings-outline',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440222',
        nombre: 'Salones',
        url: '/salones',
        icono: 'mdi-silverware-fork-knife',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440241',
        nombre: 'Impresoras',
        url: '/configuracion/impresoras',
        icono: 'mdi-printer',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440257',
        nombre: 'Propinas',
        url: '/propinas',
        icono: 'mdi-cash-plus',
        tieneConfiguracion: true,
      },
    ];

    for (const data of modulos) {
      const exists = await this.moduloAppRepo.findOne({
        where: { moduloAppId: data.moduloAppId },
      });
      if (!exists) {
        await this.moduloAppRepo.save(this.moduloAppRepo.create(data));
      }
    }
  }

  private async seedPermisos(): Promise<void> {
    const permisos: Partial<Permiso>[] = [
      { permisoId: '550e8400-e29b-41d4-a716-446655440012', nombre: 'Leer' },
      { permisoId: '550e8400-e29b-41d4-a716-446655440013', nombre: 'Crear' },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440014',
        nombre: 'Actualizar',
      },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440015',
        nombre: 'Eliminar',
      },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440016',
        nombre: 'Ver todas',
      },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440017',
        nombre: 'Reembolsar',
      },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440219',
        nombre: 'Nota de crédito',
      },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440221',
        nombre: 'Operar',
      },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440258',
        nombre: 'Configurar',
      },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440259',
        nombre: 'Liquidar',
      },
    ];

    for (const data of permisos) {
      const exists = await this.permisoRepo.findOne({
        where: { permisoId: data.permisoId },
      });
      if (!exists) {
        await this.permisoRepo.save(this.permisoRepo.create(data));
      }
    }
  }

  private async seedModuloAppPermisos(): Promise<void> {
    const CAJA = '550e8400-e29b-41d4-a716-446655440011';
    const LEER = '550e8400-e29b-41d4-a716-446655440012';
    const CREAR = '550e8400-e29b-41d4-a716-446655440013';
    const ACTUALIZAR = '550e8400-e29b-41d4-a716-446655440014';
    const ELIMINAR = '550e8400-e29b-41d4-a716-446655440015';
    const VER_TODAS = '550e8400-e29b-41d4-a716-446655440016';
    const REEMBOLSAR = '550e8400-e29b-41d4-a716-446655440017';
    const NOTA_CREDITO = '550e8400-e29b-41d4-a716-446655440219';
    const OPERAR = '550e8400-e29b-41d4-a716-446655440221';
    const SALONES = '550e8400-e29b-41d4-a716-446655440222';
    const IMPRESORAS = '550e8400-e29b-41d4-a716-446655440241';
    const PROPINAS = '550e8400-e29b-41d4-a716-446655440257';
    const CONFIGURAR = '550e8400-e29b-41d4-a716-446655440258';
    const LIQUIDAR = '550e8400-e29b-41d4-a716-446655440259';
    const VENTAS = '550e8400-e29b-41d4-a716-446655440058';
    const PAGOS = '550e8400-e29b-41d4-a716-446655440180';
    const INVENTARIO = '550e8400-e29b-41d4-a716-446655440181';
    const ITEMS = '550e8400-e29b-41d4-a716-446655440182';
    const TERCEROS = '550e8400-e29b-41d4-a716-446655440183';

    const entries: Partial<ModuloAppPermiso>[] = [
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440034',
        moduloAppId: CAJA,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440035',
        moduloAppId: CAJA,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440036',
        moduloAppId: CAJA,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440037',
        moduloAppId: CAJA,
        permisoId: ELIMINAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440038',
        moduloAppId: CAJA,
        permisoId: VER_TODAS,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440059',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440058', // Ventas
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440060',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440058', // Ventas
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440153',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440152', // Tienda Online
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440154',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440152', // Tienda Online
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440173',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440172', // Suscripciones
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440174',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440172', // Suscripciones
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440175',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440172', // Suscripciones
        permisoId: ELIMINAR,
      },
      // Ventas: completar el set (Leer/Crear ya sembrados arriba)
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440184',
        moduloAppId: VENTAS,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440185',
        moduloAppId: VENTAS,
        permisoId: ELIMINAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440186',
        moduloAppId: VENTAS,
        permisoId: VER_TODAS,
      },
      // Pagos
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440187',
        moduloAppId: PAGOS,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440188',
        moduloAppId: PAGOS,
        permisoId: CREAR,
      },
      // Inventario
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440189',
        moduloAppId: INVENTARIO,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440190',
        moduloAppId: INVENTARIO,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440191',
        moduloAppId: INVENTARIO,
        permisoId: VER_TODAS,
      },
      // Items (Catálogo)
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440192',
        moduloAppId: ITEMS,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440193',
        moduloAppId: ITEMS,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440194',
        moduloAppId: ITEMS,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440195',
        moduloAppId: ITEMS,
        permisoId: ELIMINAR,
      },
      // Terceros
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440196',
        moduloAppId: TERCEROS,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440197',
        moduloAppId: TERCEROS,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440198',
        moduloAppId: TERCEROS,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440199',
        moduloAppId: TERCEROS,
        permisoId: ELIMINAR,
      },
      // Pasarelas
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440209',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Pasarelas
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440210',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Pasarelas
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440211',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Pasarelas
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440212',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Pasarelas
        permisoId: ELIMINAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440213',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Pasarelas
        permisoId: REEMBOLSAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440220',
        moduloAppId: VENTAS,
        permisoId: NOTA_CREDITO,
      },
      // Salones (administración de estructura + operación de garzón)
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440223',
        moduloAppId: SALONES,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440224',
        moduloAppId: SALONES,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440225',
        moduloAppId: SALONES,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440226',
        moduloAppId: SALONES,
        permisoId: ELIMINAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440227',
        moduloAppId: SALONES,
        permisoId: OPERAR,
      },
      // Impresoras (config de impresión térmica: comandas, precuenta, boleta)
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440242',
        moduloAppId: IMPRESORAS,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440243',
        moduloAppId: IMPRESORAS,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440244',
        moduloAppId: IMPRESORAS,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440245',
        moduloAppId: IMPRESORAS,
        permisoId: ELIMINAR,
      },
      // Propinas (distribución E2 + liquidación E3)
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440260',
        moduloAppId: PROPINAS,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440261',
        moduloAppId: PROPINAS,
        permisoId: CONFIGURAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440262',
        moduloAppId: PROPINAS,
        permisoId: LIQUIDAR,
      },
    ];

    for (const data of entries) {
      const exists = await this.moduloAppPermisoRepo.findOne({
        where: { moduloAppPermisoId: data.moduloAppPermisoId },
      });
      if (!exists) {
        await this.moduloAppPermisoRepo.save(
          this.moduloAppPermisoRepo.create(data),
        );
      }
    }
  }

  private async seedUsuarioAdmin(): Promise<void> {
    const correo = 'admin@sistema.com';
    const exists = await this.usuarioRepo.findOne({ where: { correo } });
    if (!exists) {
      await this.usuarioRepo.save(
        this.usuarioRepo.create({
          id: '550e8400-e29b-41d4-a716-446655440019',
          nombreUsuario: 'admin',
          contrasena:
            '$2b$10$3G96idl/t9r9MspBYfSG0emDgoeSpmBRiW0yHlrUwkImlhXmuI1qW',
          nombre: 'Admin',
          apellido: 'Sistema',
          telefono: '123456789',
          correo,
          esSuperadmin: true,
        }),
      );
    }
  }

  private async seedUsuariosAdicionales(): Promise<void> {
    // Dev seed password: 'admin' (mismo que admin@sistema.com)
    const HASH = '$2b$10$3G96idl/t9r9MspBYfSG0emDgoeSpmBRiW0yHlrUwkImlhXmuI1qW';

    const usuarios = [
      {
        id: '550e8400-e29b-41d4-a716-446655440044',
        nombreUsuario: 'admin.paris',
        contrasena: HASH,
        nombre: 'Admin',
        apellido: 'Paris',
        telefono: '987654321',
        correo: 'admin.paris@paris.cl',
        esSuperadmin: false,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440045',
        nombreUsuario: 'vendedor.paris',
        contrasena: HASH,
        nombre: 'Vendedor',
        apellido: 'Paris',
        telefono: '987654322',
        correo: 'vendedor@paris.cl',
        esSuperadmin: false,
      },
    ];

    for (const data of usuarios) {
      const exists = await this.usuarioRepo.findOne({
        where: { correo: data.correo },
      });
      if (!exists) {
        await this.usuarioRepo.save(this.usuarioRepo.create(data));
      }
    }
  }

  private async seedTenants(): Promise<void> {
    const tenants: Array<{
      id: string;
      provinciaId: string;
      nombre: string;
      correo: string;
      telefono: string;
      direccion: string;
    }> = [
      {
        id: '550e8400-e29b-41d4-a716-446655440007',
        provinciaId: '550e8400-e29b-41d4-a716-446655440001',
        nombre: 'Demo Restaurante',
        correo: 'contacto@paris.cl',
        telefono: '+56226005000',
        direccion: 'Av. Presidente Kennedy 9001, Las Condes, Santiago',
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440040',
        provinciaId: '550e8400-e29b-41d4-a716-446655440001',
        nombre: 'Demo Bodega',
        correo: 'contacto@falabella.cl',
        telefono: '+56226007000',
        direccion: 'Av. Presidente Kennedy 6400, Las Condes, Santiago',
      },
    ];

    for (const data of tenants) {
      const exists = await this.tenantRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.tenantRepo.save(
          this.tenantRepo.create({
            ...data,
            calculoDescuentos: 'base',
            calculoRecargos: 'base',
            escalaCalculo: 6,
            modoRedondeo: 'HALF_UP',
            montoTolerancia: '0',
          }),
        );
      }
    }
  }

  private async seedCausasMerma(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const uuid = (n: number) =>
      `550e8400-e29b-41d4-a716-44665544${String(n).padStart(4, '0')}`;
    const nombres = [...CAUSAS_MERMA_FIJAS];

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_causas_merma_tenant_nombre
      ON causas_merma (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);

    let id = 266;
    for (const tenantId of [PARIS, FALABELLA]) {
      for (const nombre of nombres) {
        const causaId = uuid(id++);
        const exists: unknown[] = await this.dataSource.query(
          `SELECT 1 FROM causas_merma WHERE causa_merma_id = $1`,
          [causaId],
        );
        if (!exists.length) {
          await this.dataSource.query(
            `INSERT INTO causas_merma
               (causa_merma_id, tenant_id, nombre, activo, es_fijo)
             VALUES ($1,$2,$3,true,true)`,
            [causaId, tenantId, nombre],
          );
        }
      }
    }
  }

  private async seedCajasVirtuales(): Promise<void> {
    const cajas: Array<{ id: string; tenantId: string }> = [
      {
        id: '550e8400-e29b-41d4-a716-446655440150',
        tenantId: '550e8400-e29b-41d4-a716-446655440007', // Paris
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440151',
        tenantId: '550e8400-e29b-41d4-a716-446655440040', // Falabella
      },
    ];

    for (const data of cajas) {
      const exists = await this.cajaRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.cajaRepo.save(
          this.cajaRepo.create({
            id: data.id,
            tenantId: data.tenantId,
            tipo: 'virtual',
            estado: 'abierta',
            saldoInicial: '0',
          }),
        );
      }
    }
  }

  private async seedPropinaConfiguracion(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CONFIG_ID = '550e8400-e29b-41d4-a716-446655440264';
    const GRUPO_ID = '550e8400-e29b-41d4-a716-446655440265';

    const configExists = await this.propinaConfigRepo.findOne({
      where: { id: CONFIG_ID },
    });
    if (!configExists) {
      await this.propinaConfigRepo.save(
        this.propinaConfigRepo.create({
          id: CONFIG_ID,
          tenantId: PARIS,
          version: 1,
          porcentajeSugerido: '0.10',
          actualizadoPor: null,
        }),
      );
    }

    const grupoExists = await this.propinaGrupoRepo.findOne({
      where: { id: GRUPO_ID },
    });
    if (!grupoExists) {
      await this.propinaGrupoRepo.save(
        this.propinaGrupoRepo.create({
          id: GRUPO_ID,
          tenantId: PARIS,
          configuracionId: CONFIG_ID,
          tipoGarzon: TipoGarzon.GARZON,
          nombre: 'Garzones',
          porcentaje: '1.000000',
          criterio: CriterioDistribucion.PARTES_IGUALES,
          baseVentas: BaseVentasGrupo.TOTAL_FINAL,
          manualModo: null,
          activo: true,
          orden: 0,
        }),
      );
    }
  }

  private async seedTenantModulo(): Promise<void> {
    const entries: Partial<TenantModulo>[] = [
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440023',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440011', // Paris → Caja
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440061',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440058', // Paris → Ventas
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440155',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440152', // Paris → Tienda Online
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440156',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440152', // Falabella → Tienda Online
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440176',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440172', // Paris → Suscripciones
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440177',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440172', // Falabella → Suscripciones
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440043',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440011', // Falabella → Caja
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440200',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440180', // Paris → Pagos
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440201',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440181', // Paris → Inventario
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440202',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440182', // Paris → Items
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440203',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440183', // Paris → Terceros
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440204',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440180', // Falabella → Pagos
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440205',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440181', // Falabella → Inventario
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440206',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440182', // Falabella → Items
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440207',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440183', // Falabella → Terceros
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440213',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Paris → Pasarelas
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440228',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440222', // Paris → Salones
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440246',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440241', // Paris → Impresoras
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440263',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440257', // Paris → Propinas
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
    ];

    for (const data of entries) {
      const exists = await this.tenantModuloRepo.findOne({
        where: { moduloTenantId: data.moduloTenantId },
      });
      if (!exists) {
        await this.tenantModuloRepo.save(this.tenantModuloRepo.create(data));
      }
    }
  }

  private async seedSalones(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const salones: Partial<Salon>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440230',
        tenantId: PARIS,
        nombre: 'Salón Principal',
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440231',
        tenantId: PARIS,
        nombre: 'Terraza',
      },
    ];
    for (const data of salones) {
      const exists = await this.salonRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.salonRepo.save(this.salonRepo.create(data));
      }
    }
  }

  private async seedMesas(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const PRINCIPAL = '550e8400-e29b-41d4-a716-446655440230';
    const TERRAZA = '550e8400-e29b-41d4-a716-446655440231';
    const mesas: Partial<Mesa>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440232',
        tenantId: PARIS,
        salonId: PRINCIPAL,
        nombre: 'Mesa 1',
        posX: '0.15',
        posY: '0.20',
        forma: FormaMesa.REDONDA,
        tamano: TamanoMesa.PEQUENO,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440233',
        tenantId: PARIS,
        salonId: PRINCIPAL,
        nombre: 'Mesa 2',
        posX: '0.50',
        posY: '0.20',
        forma: FormaMesa.CUADRADA,
        tamano: TamanoMesa.MEDIANO,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440234',
        tenantId: PARIS,
        salonId: PRINCIPAL,
        nombre: 'Mesa 3',
        posX: '0.15',
        posY: '0.60',
        forma: FormaMesa.CUADRADA,
        tamano: TamanoMesa.MEDIANO,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440235',
        tenantId: PARIS,
        salonId: PRINCIPAL,
        nombre: 'Mesa 4',
        posX: '0.50',
        posY: '0.60',
        forma: FormaMesa.RECTANGULAR,
        tamano: TamanoMesa.GRANDE,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440236',
        tenantId: PARIS,
        salonId: TERRAZA,
        nombre: 'Mesa 1',
        posX: '0.25',
        posY: '0.35',
        forma: FormaMesa.REDONDA,
        tamano: TamanoMesa.MEDIANO,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440237',
        tenantId: PARIS,
        salonId: TERRAZA,
        nombre: 'Mesa 2',
        posX: '0.65',
        posY: '0.55',
        forma: FormaMesa.RECTANGULAR,
        tamano: TamanoMesa.EXTRA_GRANDE,
      },
    ];
    for (const data of mesas) {
      const exists = await this.mesaRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.mesaRepo.save(this.mesaRepo.create(data));
      }
    }
  }

  private async seedGarzones(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    // pinHash = bcrypt(PIN, 10). PINs de dev: Ana=111111, Bruno=222222, Carla=333333.
    const garzones: Partial<Garzon>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440238',
        tenantId: PARIS,
        nombre: 'Ana Torres',
        pinHash: '$2b$10$9a9L1ya.PTvsPU9p1lXO5uT1W4VNkLa9SlXokegdgEkfAWFMAXAdS',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440239',
        tenantId: PARIS,
        nombre: 'Bruno Díaz',
        pinHash: '$2b$10$USZItUwsBQ0wxbSH6oa9Z.yKnLmJnSa0Hm2z96hl/B7Za9tMpKpVq',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440240',
        tenantId: PARIS,
        nombre: 'Carla Rojas',
        pinHash: '$2b$10$j8RWk.ZD2t1QNqeareWYwOZLGXo.vX2WnkTpcl8qS1TTIeqTd/QMK',
        activo: true,
      },
      {
        // Placeholder "Mostrador": receptor neutro de la propina del POS.
        id: '550e8400-e29b-41d4-a716-446655440281',
        tenantId: PARIS,
        nombre: 'Mostrador',
        pinHash: '!', // inutilizable: no es bcrypt válido → nunca matchea un PIN
        activo: false,
        esPlaceholder: true,
      },
    ];
    for (const data of garzones) {
      const exists = await this.garzonRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.garzonRepo.save(this.garzonRepo.create(data));
      }
    }
  }

  private async seedTurnos(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const turnos: Partial<Turno>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440277',
        tenantId: PARIS,
        nombre: 'Mañana',
        horaInicio: '08:00',
        horaFin: '15:00',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440278',
        tenantId: PARIS,
        nombre: 'Tarde',
        horaInicio: '15:00',
        horaFin: '22:00',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440279',
        tenantId: PARIS,
        nombre: 'Noche',
        horaInicio: '22:00',
        horaFin: '08:00',
        activo: true,
      },
    ];
    for (const data of turnos) {
      const exists = await this.turnoRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.turnoRepo.save(this.turnoRepo.create(data));
      }
    }
  }

  private async seedImpresoras(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const impresoras: Partial<Impresora>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440247',
        tenantId: PARIS,
        nombre: 'Cocina',
        rol: 'comanda',
        tipoConexion: 'red',
        host: '192.168.100.13',
        puerto: 9100,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440248',
        tenantId: PARIS,
        nombre: 'Barra',
        rol: 'comanda',
        tipoConexion: 'red',
        host: '192.168.100.13',
        puerto: 9100,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440249',
        tenantId: PARIS,
        nombre: 'Caja',
        rol: 'boleta',
        tipoConexion: 'red',
        host: '192.168.100.13',
        puerto: 9100,
        activo: true,
      },
    ];
    for (const data of impresoras) {
      const exists = await this.impresoraRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.impresoraRepo.save(this.impresoraRepo.create(data));
      }
    }
  }

  private async seedPasarelas(): Promise<void> {
    const ONECLICK_ID = '550e8400-e29b-41d4-a716-446655440214';
    const existsPasarela = await this.pasarelaRepo.findOne({
      where: { pasarelaId: ONECLICK_ID },
    });
    if (!existsPasarela) {
      await this.pasarelaRepo.save(
        this.pasarelaRepo.create({
          pasarelaId: ONECLICK_ID,
          codigo: 'oneclick',
          nombre: 'Transbank Oneclick',
          soportaTokenizacion: true,
          soportaCobroRecurrente: true,
          soportaMall: true,
          urlProduccion: 'https://webpay3g.transbank.cl',
          urlPruebas: 'https://webpay3gint.transbank.cl',
          // Credenciales PÚBLICAS del ambiente de integración de Transbank (no son secretas)
          configuracionPruebas: this.credencialesService.cifrarJson({
            mallCommerceCode: '597055555541',
            apiKeySecret:
              '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
          }),
          configuracionProduccion: null,
          activo: true,
        }),
      );
    }

    // Webpay Plus Mall — pago único con redirect (segundo proveedor).
    const WEBPAY_PLUS_ID = '550e8400-e29b-41d4-a716-446655440216';
    const existsWebpay = await this.pasarelaRepo.findOne({
      where: { pasarelaId: WEBPAY_PLUS_ID },
      withDeleted: true,
    });
    if (!existsWebpay) {
      await this.pasarelaRepo.save(
        this.pasarelaRepo.create({
          pasarelaId: WEBPAY_PLUS_ID,
          codigo: 'webpay_plus',
          nombre: 'Transbank Webpay Plus',
          soportaTokenizacion: false,
          soportaCobroRecurrente: false,
          soportaMall: true,
          urlProduccion: 'https://webpay3g.transbank.cl',
          urlPruebas: 'https://webpay3gint.transbank.cl',
          // Credenciales PÚBLICAS de integración Webpay Plus Mall de Transbank
          // (comercio padre 597055555535, no secretas).
          configuracionPruebas: this.credencialesService.cifrarJson({
            mallCommerceCode: '597055555535',
            apiKeySecret:
              '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
          }),
          configuracionProduccion: null,
          activo: true,
        }),
      );
    }

    // Paris → Webpay Plus modo MALL, ambiente pruebas (tienda hija de integración)
    const TP_PARIS_WEBPAY_ID = '550e8400-e29b-41d4-a716-446655440217';
    const existsTpWebpay = await this.tenantPasarelaRepo.findOne({
      where: { tenantPasarelaId: TP_PARIS_WEBPAY_ID },
      withDeleted: true,
    });
    if (!existsTpWebpay) {
      await this.tenantPasarelaRepo.save(
        this.tenantPasarelaRepo.create({
          tenantPasarelaId: TP_PARIS_WEBPAY_ID,
          tenantId: '550e8400-e29b-41d4-a716-446655440007',
          pasarelaId: WEBPAY_PLUS_ID,
          ambiente: 'pruebas',
          modoIntegracion: 'mall',
          configuracion: this.credencialesService.cifrarJson({
            commerceCodeHijo: '597055555536',
          }),
          activo: true,
          prioridad: 2,
        }),
      );
    }

    // Paris → Oneclick modo MALL, ambiente pruebas (comercio hijo de integración)
    const TP_PARIS_ID = '550e8400-e29b-41d4-a716-446655440215';
    const existsTp = await this.tenantPasarelaRepo.findOne({
      where: { tenantPasarelaId: TP_PARIS_ID },
      withDeleted: true,
    });
    if (!existsTp) {
      await this.tenantPasarelaRepo.save(
        this.tenantPasarelaRepo.create({
          tenantPasarelaId: TP_PARIS_ID,
          tenantId: '550e8400-e29b-41d4-a716-446655440007',
          pasarelaId: ONECLICK_ID,
          ambiente: 'pruebas',
          modoIntegracion: 'mall',
          configuracion: this.credencialesService.cifrarJson({
            commerceCodeHijo: '597055555542',
          }),
          activo: true,
          prioridad: 1,
        }),
      );
    }
  }

  private async seedTenantFormulaPrecio(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';

    const formula = [
      { tenantId: PARIS, paso: 1, tipo: 'descuentos' },
      { tenantId: PARIS, paso: 2, tipo: 'recargos' },
      { tenantId: PARIS, paso: 3, tipo: 'impuestos' },
      { tenantId: FALABELLA, paso: 1, tipo: 'descuentos' },
      { tenantId: FALABELLA, paso: 2, tipo: 'recargos' },
      { tenantId: FALABELLA, paso: 3, tipo: 'impuestos' },
    ];

    for (const row of formula) {
      const exists = await this.tenantFormulaPrecioRepo.findOne({
        where: { tenantId: row.tenantId, paso: row.paso },
      });
      if (!exists) {
        await this.tenantFormulaPrecioRepo.save(
          this.tenantFormulaPrecioRepo.create(row),
        );
      }
    }
  }

  private async seedUsuariosTenants(): Promise<void> {
    const ADMIN = '550e8400-e29b-41d4-a716-446655440019';
    const ADMIN_PARIS = '550e8400-e29b-41d4-a716-446655440044';
    const VENDEDOR_PARIS = '550e8400-e29b-41d4-a716-446655440045';
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const pairs = [
      [ADMIN, PARIS], // superadmin → Paris
      [ADMIN, FALABELLA], // superadmin → Falabella
      [ADMIN_PARIS, PARIS], // admin tenant → Paris
      [VENDEDOR_PARIS, PARIS], // vendedor → Paris
    ];

    for (const [usuarioId, tenantId] of pairs) {
      await this.dataSource.query(
        `INSERT INTO usuarios_tenants (usuario_id, tenant_id, creado_el, actualizado_el)
         VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [usuarioId, tenantId],
      );
    }
  }

  private async seedRolesUsuarios(): Promise<void> {
    const SUPERADMIN = '550e8400-e29b-41d4-a716-446655440019';
    const ADMIN_PARIS = '550e8400-e29b-41d4-a716-446655440044';
    const VENDEDOR_PARIS = '550e8400-e29b-41d4-a716-446655440045';
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';

    // Crear rol Administrador en cada tenant y asignar superadmin + admin.paris en Paris
    const adminRoles = [
      { tenantId: PARIS, rolId: '550e8400-e29b-41d4-a716-446655440018' },
      { tenantId: FALABELLA, rolId: '550e8400-e29b-41d4-a716-446655440041' },
    ];

    for (const { tenantId, rolId } of adminRoles) {
      const existingRol: { rol_id: string }[] = await this.dataSource.query(
        `SELECT rol_id FROM roles WHERE tenant_id = $1 AND nombre = 'Administrador' AND eliminado_el IS NULL`,
        [tenantId],
      );

      if (existingRol.length === 0) {
        await this.dataSource.query(
          `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
           VALUES ($1, $2, 'Administrador', 'Acceso completo', true, NOW(), NOW())`,
          [rolId, tenantId],
        );
      }

      const resolvedRolId = existingRol[0]?.rol_id ?? rolId;

      await this.dataSource.query(
        `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SUPERADMIN, tenantId, resolvedRolId],
      );

      // admin.paris también tiene rol Administrador en Paris
      if (tenantId === PARIS) {
        await this.dataSource.query(
          `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
           VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [ADMIN_PARIS, PARIS, resolvedRolId],
        );
      }
    }

    // Crear rol Vendedor en Paris (no fijo) y asignar a vendedor@paris.cl
    const vendedorRolId = '550e8400-e29b-41d4-a716-446655440046';
    const existingVendedor: { rol_id: string }[] = await this.dataSource.query(
      `SELECT rol_id FROM roles WHERE tenant_id = $1 AND nombre = 'Vendedor' AND eliminado_el IS NULL`,
      [PARIS],
    );

    if (existingVendedor.length === 0) {
      await this.dataSource.query(
        `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
         VALUES ($1, $2, 'Vendedor', 'Acceso a ventas y caja', false, NOW(), NOW())`,
        [vendedorRolId, PARIS],
      );
    }

    const resolvedVendedorRolId = existingVendedor[0]?.rol_id ?? vendedorRolId;
    await this.dataSource.query(
      `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [VENDEDOR_PARIS, PARIS, resolvedVendedorRolId],
    );
  }

  private async seedMetodosPago(): Promise<void> {
    const metodos: Partial<MetodoPago>[] = [
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440105',
        nombre: 'Efectivo',
        abreviatura: 'EFE',
        activo: true,
      },
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440106',
        nombre: 'Tarjeta de débito',
        abreviatura: 'TDB',
        activo: true,
      },
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440107',
        nombre: 'Tarjeta de crédito',
        abreviatura: 'TDC',
        activo: true,
      },
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440108',
        nombre: 'Transferencia bancaria',
        abreviatura: 'TRF',
        activo: true,
      },
    ];

    for (const data of metodos) {
      const exists = await this.metodoPagoRepo.findOne({
        where: { metodoPagoId: data.metodoPagoId },
      });
      if (!exists) {
        await this.metodoPagoRepo.save(this.metodoPagoRepo.create(data));
      }
    }
  }

  private async seedTiposRegla(): Promise<void> {
    const tipos: Partial<TipoRegla>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440100',
        clase: 'descuento',
        codigo: 'pronto_pago',
        nombre: 'Pronto pago',
        descripcion:
          'Descuento por pago anticipado. Se aplica como porcentaje sobre el precio neto cuando el cliente paga al contado o dentro de los días de vencimiento configurados.',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440101',
        clase: 'descuento',
        codigo: 'por_mayor',
        nombre: 'Al por mayor',
        descripcion:
          'Descuento por volumen. Se define por tramos de cantidad mínima: a mayor cantidad de unidades, mayor descuento según el tramo alcanzado.',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440103',
        clase: 'recargo',
        codigo: 'interes_simple',
        nombre: 'Interés simple',
        descripcion:
          'Recargo por financiamiento sin capitalización. Aplica una tasa mensual fija sobre el monto original; el interés no se acumula sobre intereses previos.',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440104',
        clase: 'recargo',
        codigo: 'interes_compuesto',
        nombre: 'Interés compuesto',
        descripcion:
          'Recargo por financiamiento con capitalización. La tasa mensual se aplica sobre el saldo acumulado, generando intereses sobre intereses.',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440118',
        clase: 'descuento',
        codigo: 'metodo_pago',
        nombre: 'Por método de pago',
        descripcion:
          'Descuento condicionado al medio de pago. Se aplica solo cuando el cliente paga con alguno de los métodos seleccionados (ej. efectivo o transferencia).',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440119',
        clase: 'descuento',
        codigo: 'por_monto_venta',
        nombre: 'Por monto de venta',
        descripcion:
          'Descuento por monto de la venta. Se define por tramos de monto mínimo: al superar cierto total se aplica el descuento del tramo. Puede limitarse a un rango de fechas.',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440121',
        clase: 'descuento',
        codigo: 'promocional',
        nombre: 'Promocional',
        descripcion:
          'Descuento de campaña con vigencia obligatoria. Se aplica únicamente entre la fecha de inicio y fin definidas.',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440122',
        clase: 'recargo',
        codigo: 'general',
        nombre: 'Recargo general',
        descripcion:
          'Recargo de propósito general. Suma un porcentaje o monto fijo al total, sin condiciones especiales.',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440123',
        clase: 'recargo',
        codigo: 'mora',
        nombre: 'Mora por atraso',
        descripcion:
          'Recargo por pago atrasado. Se aplica cuando el pago se realiza después de los días de vencimiento configurados.',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440124',
        clase: 'recargo',
        codigo: 'recargo_metodo_pago',
        nombre: 'Por método de pago',
        descripcion:
          'Recargo condicionado al medio de pago. Se suma solo cuando el cliente paga con alguno de los métodos seleccionados (ej. tarjeta de crédito).',
        activo: true,
      },
    ];

    for (const data of tipos) {
      const exists = await this.tipoReglaRepo.findOne({
        where: { codigo: data.codigo },
      });
      if (exists) {
        await this.tipoReglaRepo.update(exists.id, {
          nombre: data.nombre,
          descripcion: data.descripcion,
        });
      } else {
        await this.tipoReglaRepo.save(this.tipoReglaRepo.create(data));
      }
    }
  }

  private async seedMetodoPagoPais(): Promise<void> {
    const CHILE = '550e8400-e29b-41d4-a716-446655440000';
    const metodoPagoIds = [
      '550e8400-e29b-41d4-a716-446655440105', // Efectivo
      '550e8400-e29b-41d4-a716-446655440106', // Tarjeta débito
      '550e8400-e29b-41d4-a716-446655440107', // Tarjeta crédito
      '550e8400-e29b-41d4-a716-446655440108', // Transferencia
    ];

    for (const metodoPagoId of metodoPagoIds) {
      const exists = await this.metodoPagoPaisRepo.findOne({
        where: { paisId: CHILE, metodoPagoId },
      });
      if (!exists) {
        await this.metodoPagoPaisRepo.save(
          this.metodoPagoPaisRepo.create({ paisId: CHILE, metodoPagoId }),
        );
      }
    }
  }

  private async seedTenantMetodosPago(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const metodoPagoIds = [
      '550e8400-e29b-41d4-a716-446655440105',
      '550e8400-e29b-41d4-a716-446655440106',
      '550e8400-e29b-41d4-a716-446655440107',
      '550e8400-e29b-41d4-a716-446655440108',
    ];

    for (const tenantId of [PARIS, FALABELLA]) {
      for (const metodoPagoId of metodoPagoIds) {
        const exists = await this.tenantMetodoPagoRepo.findOne({
          where: { tenantId, metodoPagoId },
        });
        if (!exists) {
          await this.tenantMetodoPagoRepo.save(
            this.tenantMetodoPagoRepo.create({
              tenantId,
              metodoPagoId,
              habilitada: true,
              permiteVuelto:
                metodoPagoId === '550e8400-e29b-41d4-a716-446655440105', // solo efectivo
            }),
          );
        }
      }
    }
  }

  private async seedTerceros(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const terceros: Partial<Tercero>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440147',
        tenantId: PARIS,
        tipo: 'proveedor',
        nombre: 'Distribuidora Andina',
        rut: '76.123.456-7',
        nombreLegal: 'Distribuidora Andina SpA',
        rutFiscal: '76.123.456-7',
        correo: 'contacto@andina.cl',
        telefono: '+56 2 2345 6789',
        direccion: 'Av. Providencia 1234, Santiago',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440148',
        tenantId: PARIS,
        tipo: 'empresa',
        nombre: 'Constructora del Sur',
        rut: '77.987.654-3',
        nombreLegal: 'Constructora del Sur Ltda.',
        rutFiscal: '77.987.654-3',
        correo: 'facturacion@delsur.cl',
        telefono: '+56 9 8765 4321',
        direccion: 'Camino Real 500, Concepción',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440149',
        tenantId: PARIS,
        tipo: 'persona_natural',
        nombre: 'Juan Pérez',
        rut: '12.345.678-9',
        nombreLegal: null,
        rutFiscal: null,
        correo: 'juan.perez@gmail.com',
        telefono: '+56 9 1234 5678',
        direccion: 'Los Álamos 45, Santiago',
        activo: true,
      },
    ];

    for (const data of terceros) {
      const exists = await this.terceroRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.terceroRepo.save(this.terceroRepo.create(data));
      }
    }
  }

  private async seedCategorias(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const categorias: Partial<Categoria>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440110',
        tenantId: PARIS,
        nombre: 'Electrónica',
        aplicaA: 'productos',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440111',
        tenantId: PARIS,
        nombre: 'Ropa y accesorios',
        aplicaA: 'ambos',
        activo: true,
        // Demo: rutea a "Cocina" para poder probar el flujo de comanda
        // sin configurar nada manualmente (ver seedImpresoras).
        impresoraId: '550e8400-e29b-41d4-a716-446655440247',
      },
    ];

    for (const data of categorias) {
      const exists = await this.categoriaRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.categoriaRepo.save(this.categoriaRepo.create(data));
      }
    }
  }

  /** Catálogo de impuestos del sistema (por país) + remapeo de duplicados legados. */
  private async seedImpuestos(): Promise<void> {
    const CHILE = '550e8400-e29b-41d4-a716-446655440000';
    const IVA_CL = '550e8400-e29b-41d4-a716-446655440280';

    const exists = await this.impuestoRepo.findOne({ where: { id: IVA_CL } });
    if (!exists) {
      await this.impuestoRepo.save(
        this.impuestoRepo.create({
          id: IVA_CL,
          tenantId: null,
          paisId: CHILE,
          nombre: 'IVA',
          porcentaje: '0.19',
          tipo: 'iva',
          activo: true,
        }),
      );
    }

    await this.remapImpuestosOficialesDuplicados();
  }

  /**
   * Migra impuestos personalizados que duplican un impuesto oficial del país del
   * tenant (mismo porcentaje y nombre con "IVA"): remapea item_impuestos al del
   * sistema y soft-deletea el duplicado. Idempotente: los duplicados quedan
   * soft-deleteados y no vuelven a matchear. Los snapshots de ventas_impuestos
   * NO se tocan (ya congelaron porcentaje y valor).
   */
  private async remapImpuestosOficialesDuplicados(): Promise<void> {
    const sistemas: {
      impuesto_id: string;
      pais_id: string;
      porcentaje: string;
    }[] = await this.dataSource.query(
      `SELECT impuesto_id, pais_id, porcentaje FROM impuestos
        WHERE tenant_id IS NULL AND tipo = 'iva' AND eliminado_el IS NULL`,
    );

    for (const sys of sistemas) {
      const duplicados: { impuesto_id: string }[] = await this.dataSource.query(
        `SELECT i.impuesto_id
           FROM impuestos i
           JOIN tenants t ON t.tenant_id = i.tenant_id
           JOIN provincia p ON p.provincia_id = t.provincia_id
          WHERE p.pais_id = $1
            AND i.eliminado_el IS NULL
            AND i.porcentaje = $2::numeric
            AND i.nombre ILIKE '%iva%'`,
        [sys.pais_id, sys.porcentaje],
      );

      for (const dup of duplicados) {
        await this.dataSource.query(
          `INSERT INTO item_impuestos (item_id, impuesto_id)
           SELECT item_id, $1 FROM item_impuestos WHERE impuesto_id = $2
           ON CONFLICT DO NOTHING`,
          [sys.impuesto_id, dup.impuesto_id],
        );
        await this.dataSource.query(
          `DELETE FROM item_impuestos WHERE impuesto_id = $1`,
          [dup.impuesto_id],
        );
        await this.dataSource.query(
          `UPDATE impuestos SET eliminado_el = NOW() WHERE impuesto_id = $1`,
          [dup.impuesto_id],
        );
      }
    }
  }

  private async seedDescuentos(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const TIPO_PRONTO_PAGO = '550e8400-e29b-41d4-a716-446655440100';
    const TIPO_POR_MAYOR = '550e8400-e29b-41d4-a716-446655440101';
    const TIPO_METODO_PAGO = '550e8400-e29b-41d4-a716-446655440118';
    const TIPO_POR_MONTO_VENTA = '550e8400-e29b-41d4-a716-446655440119';
    const TIPO_PROMOCIONAL = '550e8400-e29b-41d4-a716-446655440121';
    const descuentos: Partial<Descuento>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440114',
        tenantId: PARIS,
        tipoReglaId: TIPO_PRONTO_PAGO,
        nombre: 'Descuento pronto pago 10%',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.10',
        condicionTipo: CondicionTipo.VENCIMIENTO,
        condicionValor: '30',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440125',
        tenantId: PARIS,
        tipoReglaId: TIPO_METODO_PAGO,
        nombre: 'Descuento pago en efectivo 3%',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.03',
        condicionTipo: CondicionTipo.METODO_PAGO,
        condicionValor: null,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440126',
        tenantId: PARIS,
        tipoReglaId: TIPO_POR_MAYOR,
        nombre: 'Descuento mayorista por volumen',
        modo: ModoRegla.PORCENTAJE,
        valor: null,
        condicionTipo: CondicionTipo.CANTIDAD_MINIMA,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440127',
        tenantId: PARIS,
        tipoReglaId: TIPO_POR_MONTO_VENTA,
        nombre: 'Descuento compra grande',
        modo: ModoRegla.PORCENTAJE,
        valor: null,
        condicionTipo: CondicionTipo.MONTO_MINIMO,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440128',
        tenantId: PARIS,
        tipoReglaId: TIPO_PROMOCIONAL,
        nombre: 'Promo verano 2026-27',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.15',
        condicionTipo: CondicionTipo.FECHA,
        fechaInicio: '2026-12-01',
        fechaFin: '2027-01-31',
        activo: true,
      },
    ];

    for (const data of descuentos) {
      const exists = await this.descuentoRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.descuentoRepo.save(this.descuentoRepo.create(data));
      }
    }
  }

  private async seedDescuentoTramos(): Promise<void> {
    const POR_MAYOR = '550e8400-e29b-41d4-a716-446655440126';
    const POR_MONTO_VENTA = '550e8400-e29b-41d4-a716-446655440127';

    const tramos: Partial<DescuentoTramo>[] = [
      // por_mayor: 10+ unidades 5%, 50+ unidades 12%
      {
        id: '550e8400-e29b-41d4-a716-446655440133',
        descuentoId: POR_MAYOR,
        minimo: '10',
        valor: '0.05',
        orden: 1,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440134',
        descuentoId: POR_MAYOR,
        minimo: '50',
        valor: '0.12',
        orden: 2,
      },
      // por_monto_venta: $100.000+ 3%, $500.000+ 7%
      {
        id: '550e8400-e29b-41d4-a716-446655440135',
        descuentoId: POR_MONTO_VENTA,
        minimo: '100000',
        valor: '0.03',
        orden: 1,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440136',
        descuentoId: POR_MONTO_VENTA,
        minimo: '500000',
        valor: '0.07',
        orden: 2,
      },
    ];

    for (const data of tramos) {
      const exists = await this.descuentoTramoRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.descuentoTramoRepo.save(
          this.descuentoTramoRepo.create(data),
        );
      }
    }
  }

  private async seedDescuentoMetodosPago(): Promise<void> {
    const DESCUENTO_EFECTIVO = '550e8400-e29b-41d4-a716-446655440125';
    const EFECTIVO = '550e8400-e29b-41d4-a716-446655440105';

    const entries: Partial<DescuentoMetodoPago>[] = [
      { descuentoId: DESCUENTO_EFECTIVO, metodoPagoId: EFECTIVO },
    ];

    for (const data of entries) {
      const exists = await this.descuentoMetodoPagoRepo.findOne({
        where: {
          descuentoId: data.descuentoId,
          metodoPagoId: data.metodoPagoId,
        },
      });
      if (!exists) {
        await this.descuentoMetodoPagoRepo.save(
          this.descuentoMetodoPagoRepo.create(data),
        );
      }
    }
  }

  private async seedRecargos(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const TIPO_INTERES_SIMPLE = '550e8400-e29b-41d4-a716-446655440103';
    const TIPO_INTERES_COMPUESTO = '550e8400-e29b-41d4-a716-446655440104';
    const TIPO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';
    const TIPO_MORA = '550e8400-e29b-41d4-a716-446655440123';
    const TIPO_RECARGO_METODO_PAGO = '550e8400-e29b-41d4-a716-446655440124';
    const recargos: Partial<Recargo>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440115',
        tenantId: PARIS,
        tipoReglaId: TIPO_INTERES_SIMPLE,
        nombre: 'Interés cuotas 5%',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.05',
        condicionTipo: CondicionTipo.NINGUNA,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440129',
        tenantId: PARIS,
        tipoReglaId: TIPO_GENERAL,
        nombre: 'Recargo administrativo 2%',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.02',
        condicionTipo: CondicionTipo.NINGUNA,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440130',
        tenantId: PARIS,
        tipoReglaId: TIPO_MORA,
        nombre: 'Mora por atraso 15 días',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.01',
        condicionTipo: CondicionTipo.VENCIMIENTO,
        condicionValor: '15',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440131',
        tenantId: PARIS,
        tipoReglaId: TIPO_RECARGO_METODO_PAGO,
        nombre: 'Recargo tarjeta de crédito 3%',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.03',
        condicionTipo: CondicionTipo.METODO_PAGO,
        condicionValor: null,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440132',
        tenantId: PARIS,
        tipoReglaId: TIPO_INTERES_COMPUESTO,
        nombre: 'Interés compuesto cuotas 4%',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.04',
        condicionTipo: CondicionTipo.NINGUNA,
        activo: true,
      },
    ];

    for (const data of recargos) {
      const exists = await this.recargoRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.recargoRepo.save(this.recargoRepo.create(data));
      }
    }
  }

  private async seedRecargoMetodosPago(): Promise<void> {
    const RECARGO_TARJETA_CREDITO = '550e8400-e29b-41d4-a716-446655440131';
    const TARJETA_CREDITO = '550e8400-e29b-41d4-a716-446655440107';

    const entries: Partial<RecargoMetodoPago>[] = [
      { recargoId: RECARGO_TARJETA_CREDITO, metodoPagoId: TARJETA_CREDITO },
    ];

    for (const data of entries) {
      const exists = await this.recargoMetodoPagoRepo.findOne({
        where: { recargoId: data.recargoId, metodoPagoId: data.metodoPagoId },
      });
      if (!exists) {
        await this.recargoMetodoPagoRepo.save(
          this.recargoMetodoPagoRepo.create(data),
        );
      }
    }
  }

  private async seedItems(): Promise<void> {
    await this.seedProductoDemoVentas();
    await this.seedIngredientesBase();
    await this.seedPapasFritas();
    await this.seedGruposModificadores();
    await this.seedComboEspecial();
  }

  /**
   * Ingredientes base del cluster food-service demo: pan, carne molida y
   * queso laminado, con stock inicial. Los consume "Hamburguesa Especial"
   * (pan/queso fijos) y el grupo "Proteína" (carne como opción). Carne molida
   * también es el producto seed que ejercita el flujo de mermas.
   * Carne/queso se compran en kg; las recetas los consumen en gramos, para
   * ejercitar la conversión de unidades.
   */
  private async seedIngredientesBase(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const uuid = (suffix: number): string =>
      `550e8400-e29b-41d4-a716-44665544${String(suffix).padStart(4, '0')}`;

    const PAN_ID = uuid(256);
    const CARNE_ID = uuid(257);
    const QUESO_ID = uuid(258);
    const MOV_PAN_ID = uuid(263);
    const MOV_CARNE_ID = uuid(264);
    const MOV_QUESO_ID = uuid(265);

    // Migración soft: DBs ya sembradas con tipo=producto
    await this.dataSource.query(
      `UPDATE items SET tipo = 'ingrediente', precio_base = '0', actualizado_el = NOW()
       WHERE item_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
      [[PAN_ID, CARNE_ID, QUESO_ID]],
    );

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items WHERE item_id = $1`,
      [CARNE_ID],
    );
    if (exists.length) {
      return;
    }

    const ingredientes = [
      {
        id: PAN_ID,
        movId: MOV_PAN_ID,
        nombre: 'Pan de hamburguesa',
        unidad: 'unidad',
        stock: '50',
        costo: '500',
      },
      {
        id: CARNE_ID,
        movId: MOV_CARNE_ID,
        nombre: 'Carne molida',
        unidad: 'kg',
        // 1.5 kg: stock bajo para probar descuentos, con margen sobre el
        // consumo del e2e (mermas 1 kg + combos 0.15 kg).
        stock: '1.5',
        costo: '8000',
      },
      {
        id: QUESO_ID,
        movId: MOV_QUESO_ID,
        nombre: 'Queso laminado',
        unidad: 'kg',
        stock: '5',
        costo: '6000',
      },
    ];

    for (const ing of ingredientes) {
      await this.dataSource.query(
        `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, precio_base, precio_incluye_impuesto, activo, tipo)
         VALUES ($1,$2,$3,$4,'0',$5,$6,'ingrediente')`,
        [ing.id, PARIS, CLP, ing.nombre, false, true],
      );
      await this.dataSource.query(
        `INSERT INTO item_producto (item_id, stock, unidad_medida, modo_inventario, costo_actual)
         VALUES ($1,'0',$2,'cantidad',$3)`,
        [ing.id, ing.unidad, ing.costo],
      );
      await this.dataSource.query(
        `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
        [ing.stock, ing.id],
      );
      await this.dataSource.query(
        `INSERT INTO movimientos_inventario
           (movimiento_id, tenant_id, item_id, tipo, motivo, cantidad, stock_anterior, stock_resultante, costo_unitario, comentario)
         VALUES ($1,$2,$3,'entrada','inventario_inicial',$4,'0',$4,$5,'Stock inicial (seed ingredientes base)')`,
        [ing.movId, PARIS, ing.id, ing.stock, ing.costo],
      );
    }
  }

  /**
   * Papas fritas: producto con stock propio (costo 800/unidad). Componente
   * fijo bloqueante del "Combo Especial" (ver seedComboEspecial).
   */
  private async seedPapasFritas(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const uuid = (suffix: number): string =>
      `550e8400-e29b-41d4-a716-44665544${String(suffix).padStart(4, '0')}`;

    const PAPAS_ID = uuid(281);
    const MOV_PAPAS_ID = uuid(282);

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items WHERE item_id = $1`,
      [PAPAS_ID],
    );
    if (exists.length) {
      return;
    }

    const PAPAS_COSTO = '800';
    const PAPAS_STOCK = '40';
    await this.dataSource.query(
      `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, precio_base, precio_incluye_impuesto, activo, tipo)
       VALUES ($1,$2,$3,'Papas fritas','1500',false,true,'producto')`,
      [PAPAS_ID, PARIS, CLP],
    );
    await this.dataSource.query(
      `INSERT INTO item_producto (item_id, stock, unidad_medida, modo_inventario, costo_actual)
       VALUES ($1,'0','unidad','cantidad',$2)`,
      [PAPAS_ID, PAPAS_COSTO],
    );
    await this.dataSource.query(
      `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
      [PAPAS_STOCK, PAPAS_ID],
    );
    await this.dataSource.query(
      `INSERT INTO movimientos_inventario
         (movimiento_id, tenant_id, item_id, tipo, motivo, cantidad, stock_anterior, stock_resultante, costo_unitario, comentario)
       VALUES ($1,$2,$3,'entrada','inventario_inicial',$4,'0',$4,$5,'Stock inicial (seed papas fritas)')`,
      [MOV_PAPAS_ID, PARIS, PAPAS_ID, PAPAS_STOCK, PAPAS_COSTO],
    );
  }

  /**
   * Grupo de modificadores reutilizable demo — pieza final del cluster
   * food-service. "Proteína" (familia ingrediente, derivada de sus opciones):
   * carne (reutiliza la de seedIngredientesBase) y pollo con recargo $0,
   * chuleta con recargo $1.500, 150 g por elección. Asociado a la receta
   * "Hamburguesa Especial" (min:1, max:1 — obligatorio, una sola proteína),
   * que lleva pan y queso fijos como receta_ingrediente pero NO proteína fija:
   * la proteína se elige vía el grupo y su costo se realiza al vender.
   * Idempotente: guarda por la existencia del grupo "Proteína".
   */
  private async seedGruposModificadores(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const uuid = (suffix: number): string =>
      `550e8400-e29b-41d4-a716-44665544${String(suffix).padStart(4, '0')}`;

    // Reutilizados de seedIngredientesBase().
    const PAN_ID = uuid(256);
    const CARNE_ID = uuid(257);
    const QUESO_ID = uuid(258);

    const POLLO_ID = uuid(286);
    const MOV_POLLO_ID = uuid(287);
    const CHULETA_ID = uuid(288);
    const MOV_CHULETA_ID = uuid(289);
    const PROTEINA_GRUPO_ID = uuid(290);
    const PROTEINA_OP_CARNE_ID = uuid(291);
    const PROTEINA_OP_POLLO_ID = uuid(292);
    const PROTEINA_OP_CHULETA_ID = uuid(293);
    const HAMBURGUESA_ESPECIAL_ID = uuid(294);
    const HE_RI_PAN_ID = uuid(295);
    const HE_RI_QUESO_ID = uuid(296);
    const HE_ITEM_GRUPO_ID = uuid(297);

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM grupos_modificadores WHERE grupo_modificador_id = $1`,
      [PROTEINA_GRUPO_ID],
    );
    if (exists.length) {
      return;
    }

    // Pollo y chuleta: ingredientes demo nuevos (carne reutiliza la de
    // seedIngredientesBase, mismo estilo que "Papas fritas").
    const nuevosIngredientes = [
      {
        id: POLLO_ID,
        movId: MOV_POLLO_ID,
        nombre: 'Pechuga de pollo',
        unidad: 'kg',
        // 300 g = 0.3 kg: ningún e2e lo consume, así que es el caso limpio para
        // probar validaciones a mano (2 ventas de 150 g y a la 3ª "sin stock").
        stock: '0.3',
        costo: '6000',
      },
      {
        id: CHULETA_ID,
        movId: MOV_CHULETA_ID,
        nombre: 'Chuleta de cerdo',
        unidad: 'kg',
        // 0.6 kg: stock bajo para probar descuentos, con margen sobre el
        // consumo del e2e de combos (0.3 kg).
        stock: '0.6',
        costo: '9000',
      },
    ];
    for (const ing of nuevosIngredientes) {
      await this.dataSource.query(
        `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, precio_base, precio_incluye_impuesto, activo, tipo)
         VALUES ($1,$2,$3,$4,'0',$5,$6,'ingrediente')`,
        [ing.id, PARIS, CLP, ing.nombre, false, true],
      );
      await this.dataSource.query(
        `INSERT INTO item_producto (item_id, stock, unidad_medida, modo_inventario, costo_actual)
         VALUES ($1,'0',$2,'cantidad',$3)`,
        [ing.id, ing.unidad, ing.costo],
      );
      await this.dataSource.query(
        `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
        [ing.stock, ing.id],
      );
      await this.dataSource.query(
        `INSERT INTO movimientos_inventario
           (movimiento_id, tenant_id, item_id, tipo, motivo, cantidad, stock_anterior, stock_resultante, costo_unitario, comentario)
         VALUES ($1,$2,$3,'entrada','inventario_inicial',$4,'0',$4,$5,'Stock inicial (seed grupo Proteína)')`,
        [ing.movId, PARIS, ing.id, ing.stock, ing.costo],
      );
    }

    // Grupo "Proteína" (familia ingrediente, derivada de sus opciones):
    // carne y pollo sin recargo, chuleta +$1.500. 150 g por elección.
    await this.dataSource.query(
      `INSERT INTO grupos_modificadores (grupo_modificador_id, tenant_id, nombre)
       VALUES ($1,$2,'Proteína')`,
      [PROTEINA_GRUPO_ID, PARIS],
    );
    await this.dataSource.query(
      `INSERT INTO grupo_modificador_opciones
         (grupo_opcion_id, tenant_id, grupo_modificador_id, item_id, cantidad, unidad_codigo, precio_extra, orden)
       VALUES
         ($1,$5,$6,$2,'150','g','0',0),
         ($3,$5,$6,$7,'150','g','0',1),
         ($4,$5,$6,$8,'150','g','1500',2)`,
      [
        PROTEINA_OP_CARNE_ID,
        CARNE_ID,
        PROTEINA_OP_POLLO_ID,
        PROTEINA_OP_CHULETA_ID,
        PARIS,
        PROTEINA_GRUPO_ID,
        POLLO_ID,
        CHULETA_ID,
      ],
    );

    // Receta "Hamburguesa Especial": pan (1 unidad, bloqueante) + queso
    // (20 g, no bloqueante) fijos — SIN proteína fija como receta_ingrediente:
    // la proteína se elige vía el grupo "Proteína" (min:1, max:1, obligatorio)
    // y su costo se realiza al vender, con el movimiento de inventario de la
    // opción elegida.
    // costo_actual = costo pan (500×1) + costo queso (6000×0.02) = 620.
    await this.dataSource.query(
      `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, descripcion, precio_base, precio_incluye_impuesto, activo, tipo)
       VALUES ($1,$2,$3,'Hamburguesa Especial','Pan y queso fijos; elige tu proteína','3900',false,true,'receta')`,
      [HAMBURGUESA_ESPECIAL_ID, PARIS, CLP],
    );
    await this.dataSource.query(
      `INSERT INTO item_receta (item_id, costo_actual) VALUES ($1,'620.0000')`,
      [HAMBURGUESA_ESPECIAL_ID],
    );
    await this.dataSource.query(
      `INSERT INTO receta_ingredientes
         (receta_ingrediente_id, tenant_id, receta_item_id, ingrediente_item_id, cantidad, unidad_codigo, bloqueante)
       VALUES
         ($1,$4,$5,$2,'1','unidad',true),
         ($3,$4,$5,$6,'20','g',false)`,
      [
        HE_RI_PAN_ID,
        PAN_ID,
        HE_RI_QUESO_ID,
        PARIS,
        HAMBURGUESA_ESPECIAL_ID,
        QUESO_ID,
      ],
    );
    await this.dataSource.query(
      `INSERT INTO item_grupos_modificadores
         (item_grupo_id, tenant_id, item_id, grupo_modificador_id, min, max, orden)
       VALUES ($1,$2,$3,$4,1,1,0)`,
      [HE_ITEM_GRUPO_ID, PARIS, HAMBURGUESA_ESPECIAL_ID, PROTEINA_GRUPO_ID],
    );
  }

  /**
   * Combo demo "Combo Especial" — grupos anidados en combos (un nivel):
   * componentes "Hamburguesa Especial" (receta, `…440294`, ya trae su propio
   * grupo "Proteína" asociado) + "Papas fritas" (producto, `…440281`).
   * Demuestra que el grupo de un COMPONENTE receta se expone automáticamente
   * al vender el combo — sin asociar nada al combo mismo.
   * Precio propio fijo ($4300); costo_actual = costo Hamburguesa Especial
   * (receta, 620) + costo Papas fritas (producto, 800) = 1420.
   * Idempotente: guarda por la existencia del propio combo.
   */
  private async seedComboEspecial(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const uuid = (suffix: number): string =>
      `550e8400-e29b-41d4-a716-44665544${String(suffix).padStart(4, '0')}`;

    const HAMBURGUESA_ESPECIAL_ID = uuid(294); // ya sembrada por seedGruposModificadores
    const PAPAS_ID = uuid(281); // ya sembrada por seedPapasFritas
    const COMBO_ESPECIAL_ID = uuid(313);
    const CC_HAMBURGUESA_ESPECIAL_ID = uuid(314);
    const CC_PAPAS_ID = uuid(315);

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items WHERE item_id = $1`,
      [COMBO_ESPECIAL_ID],
    );
    if (exists.length) {
      return;
    }

    await this.dataSource.query(
      `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, descripcion, precio_base, precio_incluye_impuesto, activo, tipo)
       VALUES ($1,$2,$3,'Combo Especial','Hamburguesa Especial (elige tu proteína) + Papas fritas','4300',false,true,'combo')`,
      [COMBO_ESPECIAL_ID, PARIS, CLP],
    );
    await this.dataSource.query(
      `INSERT INTO item_combo (item_id, costo_actual) VALUES ($1,'1420.0000')`,
      [COMBO_ESPECIAL_ID],
    );
    await this.dataSource.query(
      `INSERT INTO combo_componentes
         (combo_componente_id, tenant_id, combo_item_id, componente_item_id, cantidad, bloqueante)
       VALUES
         ($1,$3,$4,$2,'1',true),
         ($5,$3,$4,$6,'1',true)`,
      [
        CC_HAMBURGUESA_ESPECIAL_ID,
        HAMBURGUESA_ESPECIAL_ID,
        PARIS,
        COMBO_ESPECIAL_ID,
        CC_PAPAS_ID,
        PAPAS_ID,
      ],
    );
  }

  /**
   * Producto demo unidad·CLP con IVA 19% — base de los tests E2E de ventas.
   * IDs 116 (item) / 120 (movimiento) reservados para esos tests.
   */
  private async seedProductoDemoVentas(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const ELECTRONICA = '550e8400-e29b-41d4-a716-446655440110';
    const IVA_19 = '550e8400-e29b-41d4-a716-446655440280'; // IVA sistema Chile
    const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';
    const MOV_ID = '550e8400-e29b-41d4-a716-446655440120';
    const STOCK = '50';

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items WHERE item_id = $1`,
      [ITEM_ID],
    );
    if (exists.length) {
      return;
    }

    await this.dataSource.query(
      `INSERT INTO items (item_id, tenant_id, moneda_id, categoria_id, nombre, descripcion,
                          precio_base, precio_incluye_impuesto, activo, tipo)
       VALUES ($1,$2,$3,$4,'Producto demo (unidad · CLP)','Item de desarrollo: Unidad, precio en CLP','5000',false,true,'producto')`,
      [ITEM_ID, PARIS, CLP, ELECTRONICA],
    );
    await this.dataSource.query(
      `INSERT INTO item_producto (item_id, stock, unidad_medida, modo_inventario)
       VALUES ($1,'0','unidad','cantidad')`,
      [ITEM_ID],
    );
    await this.dataSource.query(
      `INSERT INTO item_impuestos (item_id, impuesto_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [ITEM_ID, IVA_19],
    );
    await this.dataSource.query(
      `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
      [STOCK, ITEM_ID],
    );
    await this.dataSource.query(
      `INSERT INTO movimientos_inventario
         (movimiento_id, tenant_id, item_id, tipo, motivo, cantidad,
          stock_anterior, stock_resultante, comentario)
       VALUES ($1,$2,$3,'entrada','inventario_inicial',$4,'0',$4,'Stock inicial (seed producto demo ventas)')`,
      [MOV_ID, PARIS, ITEM_ID, STOCK],
    );
  }

  private async seedTiposDocumentoTributario(): Promise<void> {
    const CHILE = '550e8400-e29b-41d4-a716-446655440000';
    const tipos: Partial<TipoDocumentoTributario>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440145',
        paisId: CHILE,
        nombre: 'Boleta de Venta',
        codigo: '39',
        descripcion: 'Boleta electrónica de venta al consumidor final',
        activo: true,
        customerRequerido: false,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440146',
        paisId: CHILE,
        nombre: 'Factura Electrónica',
        codigo: '33',
        descripcion: 'Factura electrónica afecta a IVA',
        activo: true,
        customerRequerido: true,
      },
      {
        // activo:false — no aparece en el selector del POS; solo lo usa el
        // flujo de reembolso vía TIPO_DOCUMENTO_NC_ID.
        id: '550e8400-e29b-41d4-a716-446655440218',
        paisId: CHILE,
        nombre: 'Nota de Crédito',
        codigo: '61',
        descripcion: 'Nota de crédito interna por reembolso (sin emisión SII)',
        activo: false,
        customerRequerido: false,
      },
    ];

    for (const data of tipos) {
      const existing = await this.tipoDocumentoRepo.findOne({
        where: { id: data.id },
      });
      if (!existing) {
        await this.tipoDocumentoRepo.save(this.tipoDocumentoRepo.create(data));
      } else {
        await this.tipoDocumentoRepo.save({ ...existing, ...data });
      }
    }
  }

  private async seedRazonesSociales(): Promise<void> {
    const razones: Partial<RazonSocial>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440056',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        nombre: 'Demo Restaurante S.A.',
        rut: '76.123.456-7',
        direccion: 'Av. Presidente Kennedy 9001, Las Condes',
        telefono: '+56226005000',
        habilitado: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440057',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        nombre: 'Demo Bodega S.A.',
        rut: '96.654.390-9',
        direccion: 'Av. Presidente Kennedy 6400, Las Condes',
        telefono: '+56226007000',
        habilitado: true,
      },
    ];

    for (const data of razones) {
      const exists = await this.razonSocialRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.razonSocialRepo.save(this.razonSocialRepo.create(data));
      }
    }
  }

  private async seedVendedorPermisosCaja(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    // moduloTenantId para Paris → Caja (definido en seedTenantModulo)
    const MODULO_TENANT_CAJA = '550e8400-e29b-41d4-a716-446655440023';
    // moduloTenantId para Paris → Ventas (recién agregado en Paso 3)
    const MODULO_TENANT_VENTAS = '550e8400-e29b-41d4-a716-446655440061';
    // moduloTenantId para Paris → Pagos
    const MODULO_TENANT_PAGOS = '550e8400-e29b-41d4-a716-446655440200';
    // moduloTenantId para Paris → Items (POS necesita leer el catálogo)
    const MODULO_TENANT_ITEMS = '550e8400-e29b-41d4-a716-446655440202';
    // moduloAppPermiso IDs de Caja (definidos en seedModuloAppPermisos)
    const CAJA_LEER = '550e8400-e29b-41d4-a716-446655440034';
    const CAJA_CREAR = '550e8400-e29b-41d4-a716-446655440035';
    const CAJA_ACTUALIZAR = '550e8400-e29b-41d4-a716-446655440036';
    // moduloAppPermiso IDs de Ventas (recién agregados en Paso 2)
    const VENTAS_LEER = '550e8400-e29b-41d4-a716-446655440059';
    const VENTAS_CREAR = '550e8400-e29b-41d4-a716-446655440060';
    // moduloAppPermiso IDs de Pagos
    const PAGOS_LEER = '550e8400-e29b-41d4-a716-446655440187';
    const PAGOS_CREAR = '550e8400-e29b-41d4-a716-446655440188';
    // moduloAppPermiso ID de Items (leer catálogo, necesario para POS)
    const ITEMS_LEER = '550e8400-e29b-41d4-a716-446655440192';

    const vendedorRows: { rol_id: string }[] = await this.dataSource.query(
      `SELECT rol_id FROM roles WHERE tenant_id = $1 AND nombre = 'Vendedor' AND eliminado_el IS NULL`,
      [PARIS],
    );

    if (vendedorRows.length === 0) {
      this.logger.warn(
        'seedVendedorPermisosCaja: rol Vendedor not found in Paris, skipping.',
      );
      return;
    }

    const rolId = vendedorRows[0].rol_id;

    // Asociar Vendedor al módulo Caja del tenant Paris
    await this.dataSource.query(
      `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_CAJA],
    );

    // Asociar Vendedor al módulo Ventas del tenant Paris
    await this.dataSource.query(
      `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_VENTAS],
    );

    // Asociar Vendedor al módulo Pagos del tenant Paris
    await this.dataSource.query(
      `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_PAGOS],
    );

    // Asociar Vendedor al módulo Items del tenant Paris (POS necesita leer el catálogo)
    await this.dataSource.query(
      `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_ITEMS],
    );

    // Asignar Caja: Leer, Crear, Actualizar (sin VerTodas — ese es el diferenciador admin/supervisor)
    for (const moduloAppPermisoId of [CAJA_LEER, CAJA_CREAR, CAJA_ACTUALIZAR]) {
      await this.dataSource.query(
        `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [rolId, MODULO_TENANT_CAJA, moduloAppPermisoId],
      );
    }

    // Asignar Ventas: Leer, Crear
    for (const moduloAppPermisoId of [VENTAS_LEER, VENTAS_CREAR]) {
      await this.dataSource.query(
        `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [rolId, MODULO_TENANT_VENTAS, moduloAppPermisoId],
      );
    }

    // Asignar Pagos: Leer, Crear
    for (const moduloAppPermisoId of [PAGOS_LEER, PAGOS_CREAR]) {
      await this.dataSource.query(
        `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [rolId, MODULO_TENANT_PAGOS, moduloAppPermisoId],
      );
    }

    // Asignar Items: Leer (POS necesita listar el catálogo)
    await this.dataSource.query(
      `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_ITEMS, ITEMS_LEER],
    );
  }
}
