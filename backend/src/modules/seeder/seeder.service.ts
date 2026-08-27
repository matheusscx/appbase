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
import {
  ModoRegla,
  CondicionTipo,
  NivelRegla,
} from '../../common/enums/reglas.enums';
import { TipoDocumentoTributario } from '../ventas/entities/tipo-documento-tributario.entity';
import { Tercero } from '../terceros/entities/tercero.entity';
import { Garzon } from '../garzones/entities/garzon.entity';
import { PIN_INUTILIZABLE } from '../garzones/garzones.service';
import { Turno } from '../turnos/entities/turno.entity';
import { Impresora } from '../impresoras/entities/impresora.entity';
import { PropinaConfiguracion } from '../propinas/entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from '../propinas/entities/propina-grupo-distribucion.entity';
import { Promocion } from '../promociones/entities/promocion.entity';
import { PromocionScope } from '../promociones/entities/promocion-scope.entity';
import { PromocionScopeItem } from '../promociones/entities/promocion-scope-item.entity';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { CriterioDistribucion } from '../propinas/enums/criterio-distribucion.enum';
import { BaseVentasGrupo } from '../propinas/enums/base-ventas-grupo.enum';
import { Caja } from '../caja/entities/caja.entity';
import { Cajon } from '../cajones/entities/cajon.entity';
import { Pasarela } from '../pasarela/entities/pasarela.entity';
import { TenantPasarela } from '../pasarela/entities/tenant-pasarela.entity';
import { CredencialesService } from '../pasarela/services/credenciales.service';
import { Salon } from '../salones/entities/salon.entity';
import { Mesa, FormaMesa, TamanoMesa } from '../salones/entities/mesa.entity';
import { CAUSAS_MERMA_FIJAS } from '../mermas/causas-merma.defaults';
import { MOTIVOS_DIFERENCIA_DEFAULTS } from '../motivos-diferencia/motivos-diferencia.defaults';
import { MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS } from '../motivos-diferencia-inventario/motivos-diferencia-inventario.defaults';

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
    @InjectRepository(Cajon)
    private readonly cajonRepo: Repository<Cajon>,
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
    @InjectRepository(Promocion)
    private readonly promocionRepo: Repository<Promocion>,
    @InjectRepository(PromocionScope)
    private readonly promocionScopeRepo: Repository<PromocionScope>,
    @InjectRepository(PromocionScopeItem)
    private readonly promocionScopeItemRepo: Repository<PromocionScopeItem>,
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
    await this.seedMotivosDiferencia();
    await this.seedMotivosDiferenciaInventario();
    await this.seedRecuentoInventarioLineaIndex();
    await this.seedPromocionesIndices();
    await this.seedCajasVirtuales();
    await this.seedCajones();
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
    await this.seedRecargoTramos();
    await this.seedRecargoMetodosPago();
    await this.seedItems();
    await this.seedPromociones();
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
    await this.seedRolesInventario();
    await this.seedRolSupervisorCajas();
    await this.seedRolEncargadoCajas();
    await this.seedRolEncargadoSalon();
    await this.seedRolSalon();
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
          habilitada: true,
          valorDelDia: '1',
        },
        {
          tenantId,
          monedaId: UF,
          habilitada: true,
          valorDelDia: '38000',
        },
        {
          tenantId,
          monedaId: USD,
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
        nombre: 'MiCaja',
        url: '/mi-caja',
        icono: 'mdi-cash-register',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282',
        nombre: 'Cajas',
        url: '/cajas',
        icono: 'mdi-cash-multiple',
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
      {
        // Anular una venta pendiente sin pagos ni documento. Permiso propio y no
        // `Actualizar`: es la operación más sensible del módulo y el mercado la
        // trata aparte (en Toteat, por defecto solo el dueño).
        permisoId: '550e8400-e29b-41d4-a716-446655440333',
        nombre: 'Anular',
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
    const ANULAR = '550e8400-e29b-41d4-a716-446655440333';
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
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440283',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Cajas
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440288',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Cajas
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440289',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Cajas
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440290',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Cajas
        permisoId: ELIMINAR,
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
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440291',
        moduloAppId: INVENTARIO,
        permisoId: ACTUALIZAR,
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
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440334',
        moduloAppId: VENTAS,
        permisoId: ANULAR,
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
      // Crear/Actualizar/Eliminar de Propinas existen desde el 2026-08-22 por
      // la gestión de garzones, que ahora habilitan `Salones` **o** `Propinas`
      // (ver `garzones.controller.ts`). Sin estas tres filas, un tenant que
      // contrató Propinas y no Salones podía leer la pantalla de liquidación
      // pero no dar de alta ni editar al garzón que la propia alta le creó.
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440357',
        moduloAppId: PROPINAS,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440358',
        moduloAppId: PROPINAS,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440359',
        moduloAppId: PROPINAS,
        permisoId: ELIMINAR,
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
          // Ver el comentario gemelo en `seedUsuariosAdicionales`.
          correoVerificadoEl: new Date(),
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
      // Los dos lados del modo del dispositivo (Fase 2 del garzón). Sin estas
      // dos cuentas, ni el modo personal ni el override del tótem se pueden
      // ejercer: la resolución del garzón actuante sale de la cuenta con la que
      // se opera, no de un parámetro.
      {
        id: '550e8400-e29b-41d4-a716-446655440341',
        nombreUsuario: 'ana.torres',
        contrasena: HASH,
        nombre: 'Ana',
        apellido: 'Torres',
        telefono: '987654341',
        correo: 'ana.torres@paris.cl',
        esSuperadmin: false,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440342',
        nombreUsuario: 'totem.paris',
        contrasena: HASH,
        nombre: 'Tótem',
        apellido: 'Salón',
        telefono: '987654342',
        correo: 'totem@paris.cl',
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
      // Los dos lados de la asimetría de recuentos: contar y aprobar son
      // permisos distintos a propósito, y sin estos usuarios esa separación no
      // se puede ejercer ni a mano ni desde un test — el único no-admin previo
      // (vendedor.paris) no tiene Inventario. Ver seedRolesInventario.
      {
        id: '550e8400-e29b-41d4-a716-446655440328',
        nombreUsuario: 'contador.paris',
        contrasena: HASH,
        nombre: 'Contador',
        apellido: 'Inventario',
        telefono: '987654323',
        correo: 'contador@paris.cl',
        esSuperadmin: false,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440329',
        nombreUsuario: 'aprobador.paris',
        contrasena: HASH,
        nombre: 'Aprobador',
        apellido: 'Inventario',
        telefono: '987654324',
        correo: 'aprobador@paris.cl',
        esSuperadmin: false,
      },
      // El supervisor de cajas que el cierre ciego necesitaba y no existía: ve
      // TODAS las cajas (`Cajas:Leer`) y NO es admin, que es justo la
      // combinación a la que el ciego sí le aplica. Ver seedRolSupervisorCajas.
      {
        id: '550e8400-e29b-41d4-a716-446655440335',
        nombreUsuario: 'supervisor.paris',
        contrasena: HASH,
        nombre: 'Supervisor',
        apellido: 'Cajas',
        telefono: '987654325',
        correo: 'supervisor@paris.cl',
        esSuperadmin: false,
      },
      // El encargado que fuerza el cierre sin ser admin (decisión del owner
      // 2026-08-13): `Cajas:Leer` + `Cajas:Actualizar`, y NO admin — la
      // combinación exacta a la que el ciego sigue aplicando aun pudiendo
      // forzar. No reusar `supervisor.paris` (solo `Cajas:Leer`, arnés de
      // otros tests) ni `admin.paris` (short-circuita todo). Ver
      // seedRolEncargadoCajas.
      {
        id: '550e8400-e29b-41d4-a716-446655440344',
        nombreUsuario: 'encargado.paris',
        contrasena: HASH,
        nombre: 'Encargado',
        apellido: 'Cajas',
        telefono: '987654344',
        correo: 'encargado@paris.cl',
        esSuperadmin: false,
      },
      // Cuenta exclusiva del e2e `garzon-pin.e2e-spec.ts`: NO reusar a Ana,
      // Bruno ni Carla, cuya sesión de garzón comparten seis specs. Este
      // garzón nace vinculado y sin PIN usable (`PIN_INUTILIZABLE`), igual
      // que en producción — ver seedGarzones.
      {
        id: '550e8400-e29b-41d4-a716-446655440346',
        nombreUsuario: 'garzon.pin',
        contrasena: HASH,
        nombre: 'PIN',
        apellido: 'Fixture',
        telefono: '987654346',
        correo: 'garzon.pin@paris.cl',
        esSuperadmin: false,
      },
      // El encargado del SALÓN: `Salones:Leer` + `Salones:Actualizar` y **NO
      // admin**. Es la combinación exacta a la que se le muestra el aviso de
      // "esa cuenta todavía no puede operar el salón… hasta que se lo des", y
      // por lo tanto la única con la que se puede probar que ahora puede
      // dárselo sin ser admin (decisión del owner, 2026-08-15). No sirve
      // `admin.paris` —short-circuita todo por `es_fijo`— ni `ana.torres`, que
      // tiene `Salones:Operar` pero no `Actualizar`. Ver seedRolEncargadoSalon.
      {
        id: '550e8400-e29b-41d4-a716-446655440348',
        nombreUsuario: 'encargado.salon',
        contrasena: HASH,
        nombre: 'Encargado',
        apellido: 'Salon',
        telefono: '987654348',
        correo: 'encargado.salon@paris.cl',
        esSuperadmin: false,
      },
    ];

    for (const data of usuarios) {
      const exists = await this.usuarioRepo.findOne({
        where: { correo: data.correo },
      });
      if (!exists) {
        // `correoVerificadoEl` sellado: sin esto `validateUser` corta el login
        // de TODAS las cuentas del seed —el correo sin verificar no entra— y se
        // caen los cientos de e2e que arrancan logueándose. Las direcciones del
        // seed son ficticias y no hay ningún mail que abrir.
        await this.usuarioRepo.save(
          this.usuarioRepo.create({ ...data, correoVerificadoEl: new Date() }),
        );
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
            nivelRedondeo: 'linea',
            montoTolerancia: '0',
            // Umbrales de descuadre al cierre, en CLP (moneda oficial de los
            // dos tenants del seed, 0 decimales). Se siembran ACTIVOS y no en
            // `'0'` —el default de un tenant real, que nace apagado— para que
            // la bandeja de pendientes de revisar tenga de dónde poblarse en el
            // demo: con los dos en cero la feature entera es invisible.
            // $2.000 avisa, $10.000 va a la bandeja.
            umbralDescuadreAviso: '2000',
            umbralDescuadreAlto: '10000',
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

  private async seedMotivosDiferencia(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const uuid = (n: number) =>
      `550e8400-e29b-41d4-a716-44665544${String(n).padStart(4, '0')}`;

    // El nombre correcto es el de `startup-pos.sql`. Este índice se llamaba
    // `uq_motivo_diferencia_tenant_nombre` solo acá: la definición era idéntica
    // y la conducta la misma en las dos bases, pero buscarlo por nombre no
    // encontraba nada. Su gemelo de inventario (`uq_motivo_dif_inv_tenant_nombre`)
    // sí coincidía en los dos lados; este era el único desalineado.
    // Se **renombra**, no se recrea. `seedCajones()` hace `DROP` + `CREATE`
    // porque allá la definición vieja era distinta (case-sensitive, sin
    // `lower()`) y había que reconstruir el índice. Acá la definición es
    // idéntica y solo cambia el nombre: `ALTER INDEX … RENAME` es atómico,
    // mientras que `DROP` + `CREATE` en dos sentencias deja una ventana con la
    // tabla **sin unicidad** —y si el arranque muere en el medio (cosa que
    // pasa: el watcher reinicia el backend seguido), la deja sin índice.
    // Condicional a los dos nombres, así que en una base nueva o ya migrada no
    // hace nada.
    await this.dataSource.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'uq_motivo_diferencia_tenant_nombre'
        ) THEN
          IF EXISTS (
            SELECT 1 FROM pg_indexes
             WHERE schemaname = 'public'
               AND indexname = 'uq_motivo_diferencia_caja_tenant_nombre'
          ) THEN
            EXECUTE 'DROP INDEX uq_motivo_diferencia_tenant_nombre';
          ELSE
            EXECUTE 'ALTER INDEX uq_motivo_diferencia_tenant_nombre'
                 || ' RENAME TO uq_motivo_diferencia_caja_tenant_nombre';
          END IF;
        END IF;
      END $$;
    `);
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_motivo_diferencia_caja_tenant_nombre
      ON motivo_diferencia_caja (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);

    let id = 291;
    for (const tenantId of [PARIS, FALABELLA]) {
      for (const m of MOTIVOS_DIFERENCIA_DEFAULTS) {
        const motivoId = uuid(id++);
        const exists: unknown[] = await this.dataSource.query(
          `SELECT 1 FROM motivo_diferencia_caja WHERE motivo_diferencia_id = $1`,
          [motivoId],
        );
        if (!exists.length) {
          await this.dataSource.query(
            `INSERT INTO motivo_diferencia_caja
               (motivo_diferencia_id, tenant_id, nombre, activo, requiere_comentario, es_fijo)
             VALUES ($1, $2, $3, true, $4, true)`,
            [motivoId, tenantId, m.nombre, m.requiereComentario],
          );
        }
      }
    }
  }

  private async seedMotivosDiferenciaInventario(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const uuid = (n: number) =>
      `550e8400-e29b-41d4-a716-44665544${String(n).padStart(4, '0')}`;

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_motivo_dif_inv_tenant_nombre
      ON motivo_diferencia_inventario (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);

    // Empieza en 316: 291-304 lo ocupa el rango dinámico de
    // seedMotivosDiferencia (2 tenants x 7 nombres, let id = 291) y 305-315
    // lo ocupan uuid(N) de seedGruposModificadores/seedComboEspecial — ninguno
    // de los dos visible a un grep de literales, porque ambos se generan en
    // runtime (uuid(id++) / uuid(N)), no como string `44665544XXXX` fijo.
    const filas: { id: string; tenantId: string; nombre: string }[] = [];
    let id = 316;
    for (const tenantId of [PARIS, FALABELLA]) {
      for (const nombre of MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS) {
        filas.push({ id: uuid(id++), tenantId, nombre });
      }
    }

    const valores = filas
      .map(
        (_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, true, true)`,
      )
      .join(', ');
    const params = filas.flatMap((f) => [f.id, f.tenantId, f.nombre]);
    await this.dataSource.query(
      `INSERT INTO motivo_diferencia_inventario
         (motivo_diferencia_inventario_id, tenant_id, nombre, activo, es_fijo)
       VALUES ${valores}
       ON CONFLICT (motivo_diferencia_inventario_id) DO NOTHING`,
      params,
    );
  }

  // No hay filas fijas que sembrar (las sesiones las crean los usuarios): solo
  // la defensa declarada en startup-pos.sql que faltaba en la BD real — una
  // línea viva por item dentro de un mismo recuento.
  private async seedRecuentoInventarioLineaIndex(): Promise<void> {
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_recuento_linea_item_vivo
      ON recuento_inventario_linea (recuento_id, item_id) WHERE eliminado_el IS NULL
    `);
  }

  /**
   * Solo el índice, sin demo rows: el seed de promos vive en una tarea
   * aparte del plan (no se siembra ninguna al crear tenant — no es parte
   * del kit mínimo rol/fórmula/caja virtual). Mismo molde que
   * `seedDescuentos()` — `lower(nombre)` no lo puede expresar `@Index` de
   * TypeORM, así que va acá con SQL cruda — pero separado porque acá no
   * hay filas que sembrar todavía.
   * `PromocionesService.validarNombreUnico` + `traducirColisionDeNombre`
   * asumen este índice para traducir la carrera de nombre (23505) al mismo
   * 400 que el pre-chequeo; sin él, esa rama nunca dispara.
   */
  private async seedPromocionesIndices(): Promise<void> {
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_promociones_tenant_nombre_vivo
      ON promociones (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);
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

  private async seedCajones(): Promise<void> {
    // Ver `seedDescuentos()`: mismo motivo para crearlo acá y no en la entity.
    //
    // El `DROP` condicional limpia el índice case-sensitive que quedó en las
    // bases de dev creadas antes de este cambio —`cajon.entity.ts` lo declaraba
    // con `@Index` y `synchronize` lo creaba sobre `nombre` pelado—. Solo
    // dispara si el que existe NO es el de `lower()`, así que en una base ya
    // correcta no hay churn. Mismo patrón que `seedGruposModificadores()`.
    await this.dataSource.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'ux_cajones_tenant_nombre'
             AND indexdef NOT ILIKE '%lower%'
        ) THEN
          EXECUTE 'DROP INDEX ux_cajones_tenant_nombre';
        END IF;
      END $$;
    `);
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_cajones_tenant_nombre
      ON cajones (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);

    const cajones: Array<{ id: string; tenantId: string; nombre: string }> = [
      {
        id: '550e8400-e29b-41d4-a716-446655440286',
        tenantId: '550e8400-e29b-41d4-a716-446655440007', // Paris
        nombre: 'Mostrador',
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440287',
        tenantId: '550e8400-e29b-41d4-a716-446655440040', // Falabella
        nombre: 'Mostrador',
      },
    ];

    for (const data of cajones) {
      const exists = await this.cajonRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.cajonRepo.save(
          this.cajonRepo.create({
            id: data.id,
            tenantId: data.tenantId,
            nombre: data.nombre,
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
        // Falabella → Ventas. Faltaba, y el hueco recién se vio el 2026-08-16 al
        // cerrar el short-circuit de `es_fijo`: mientras el admin llegaba a
        // cualquier módulo, tener o no contratado `Ventas` no cambiaba nada.
        // Un tenant con MiCaja, Cajas, Pagos y Tienda Online que no puede
        // registrar una venta no es un tenant que compró menos: es un seed
        // incoherente.
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440350',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440058',
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        // Falabella → **Propinas**, y este contrato dice algo del negocio en vez
        // de tapar un acoplamiento.
        //
        // Hasta el 2026-08-22 acá decía `Salones`, contratado a una bodega sin
        // mesas por una sola razón: `TenantsService.create` le crea a TODO
        // tenant el garzón placeholder "Mostrador" (`asegurarMostrador`) y las
        // rutas que lo gestionan pedían el módulo `Salones`. Era un parche de
        // seed, anotado como tal. Ahora la gestión del garzón la habilitan
        // `Salones` **o** `Propinas`, así que la bodega contrata lo que de
        // verdad usa —cobra propina directa desde el POS— y deja de figurar
        // como un tenant con salones que no tiene.
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440351',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440257',
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440284',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Paris → Cajas
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440285',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440282', // Falabella → Cajas
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
        // Tiene Tienda Online: sin este módulo no puede entrar a Configuración →
        // Pasarelas, o sea que no puede prender ni apagar el único medio de
        // cobro que su tienda usa.
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440364',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Falabella → Pasarelas
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
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_garzones_mostrador_tenant
      ON garzones (tenant_id) WHERE es_placeholder = true AND eliminado_el IS NULL
    `);

    // Una cuenta no puede ser dos garzones vivos del mismo tenant: si lo fuera,
    // `resolverGarzonActuante` elegiría uno al azar al resolver por JWT.
    // Acá y no solo en `startup-pos.sql` porque los índices PARCIALES los crea
    // el seeder: `synchronize` de TypeORM no los genera, y el .sql documenta el
    // esquema pero no es lo que se aplica.
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_garzones_usuario_tenant
      ON garzones (tenant_id, usuario_id)
      WHERE usuario_id IS NOT NULL AND eliminado_el IS NULL
    `);

    // pinHash = bcrypt(PIN, 10). PINs de dev: Bruno=222222, Carla=333333. Ana
    // NO tiene PIN de dev: está vinculada desde el seed (ver más abajo), así
    // que su `pinHash` es `PIN_INUTILIZABLE` como cualquier garzón con cuenta.
    const garzones: Partial<Garzon>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440238',
        tenantId: PARIS,
        nombre: 'Ana Torres',
        // Modo personal: opera desde su propia tablet y no teclea PIN. Su PIN
        // muere en el momento en que se vincula la cuenta
        // (`GarzonesService.actualizar()`, transición `usuario_id: null →
        // uuid`) — desde ahí la identidad la prueba el JWT, y ella fijaría el
        // suyo propio desde `fijarMiPin` si quisiera volver a usar el tótem.
        // ⚠️ Antes este seed la sembraba con un PIN vivo ('111111') y un
        // comentario que decía "puede usar cualquiera de los dos": eso dejó
        // de ser cierto en `6758e7b2` — la API ya no puede producir ese
        // estado — y un ambiente de dev con un estado irreproducible por API
        // esconde bugs (decisión del owner, 2026-08-14: corregir, no dejarlo).
        pinHash: PIN_INUTILIZABLE,
        activo: true,
        usuarioId: '550e8400-e29b-41d4-a716-446655440341',
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
        // El id NO es `…440281`: ese lo tiene el ítem "Papas fritas"
        // (`seedPapasFritas`), y compartir literal entre dos filas sin relación
        // ya confundió a dos revisores independientes.
        id: '550e8400-e29b-41d4-a716-446655440339',
        tenantId: PARIS,
        nombre: 'Mostrador',
        pinHash: PIN_INUTILIZABLE,
        activo: false,
        esPlaceholder: true,
      },
      {
        // Garzón de OTRO tenant. Existe solo para que el e2e pueda ejercer el
        // aislamiento multi-tenant de la propina: activo y válido, así que el
        // único motivo por el que una venta de Paris debe rechazarlo es el
        // tenant. Sin un garzón ajeno sembrado, esa distinción no la ejerce nada
        // y un bug de fuga pasa los gates (ver `verify-feature` §2c).
        id: '550e8400-e29b-41d4-a716-446655440332',
        tenantId: FALABELLA,
        nombre: 'Diego Soto (Falabella)',
        pinHash: PIN_INUTILIZABLE, // no opera por PIN: es fixture de aislamiento, no un garzón real
        activo: true,
      },
      {
        // Fixture exclusiva de garzon-pin.e2e-spec.ts. Vinculado desde el
        // seed (no por API) para que el e2e arranque directo en "vinculado,
        // sin PIN fijado", el mismo estado que un garzón recién dado de alta
        // con cuenta.
        id: '550e8400-e29b-41d4-a716-446655440347',
        tenantId: PARIS,
        nombre: 'PIN Fixture',
        pinHash: PIN_INUTILIZABLE, // nace sin PIN usable, igual que en producción
        activo: true,
        usuarioId: '550e8400-e29b-41d4-a716-446655440346',
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
    // Ver `seedDescuentos()`: mismo motivo para crearlo acá y no en la entity.
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_turnos_tenant_nombre_vivo
      ON turnos (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);

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

    // Pasarela demo — aprueba todo sin cobrar. Existe para que un local que
    // todavía no conectó Transbank pueda PRENDERLA a propósito desde
    // Configuración → Pasarelas; hasta el 2026-08-26 la tienda caía al flujo
    // simulado por el solo hecho de no tener Webpay, sin que nadie lo eligiera.
    // Sin credenciales que cifrar: no habla con ningún proveedor, y las URLs
    // apuntan a la propia pantalla porque las columnas son NOT NULL.
    const DEMO_ID = '550e8400-e29b-41d4-a716-446655440361';
    const existsDemo = await this.pasarelaRepo.findOne({
      where: { pasarelaId: DEMO_ID },
      withDeleted: true,
    });
    if (!existsDemo) {
      await this.pasarelaRepo.save(
        this.pasarelaRepo.create({
          pasarelaId: DEMO_ID,
          codigo: 'demo',
          nombre: 'Pasarela demo (solo pruebas)',
          soportaTokenizacion: false,
          soportaCobroRecurrente: false,
          soportaMall: false,
          urlProduccion: '/tienda/pasarela',
          urlPruebas: '/tienda/pasarela',
          configuracionPruebas: null,
          configuracionProduccion: null,
          activo: true,
        }),
      );
    }

    // Paris → demo prendida junto a Webpay. Webpay le gana por precedencia, así
    // que no cambia nada hasta que alguien la apague: esa es la puerta a la
    // pantalla simulada en el tenant que sí tiene catálogo.
    const TP_PARIS_DEMO_ID = '550e8400-e29b-41d4-a716-446655440362';
    const existsTpParisDemo = await this.tenantPasarelaRepo.findOne({
      where: { tenantPasarelaId: TP_PARIS_DEMO_ID },
      withDeleted: true,
    });
    if (!existsTpParisDemo) {
      await this.tenantPasarelaRepo.save(
        this.tenantPasarelaRepo.create({
          tenantPasarelaId: TP_PARIS_DEMO_ID,
          tenantId: '550e8400-e29b-41d4-a716-446655440007',
          pasarelaId: DEMO_ID,
          ambiente: 'pruebas',
          modoIntegracion: 'individual',
          configuracion: null,
          activo: true,
          prioridad: 3,
        }),
      );
    }

    // Falabella → demo prendida. Es el tenant sin Webpay: hasta hoy llegaba al
    // simulado por descarte, y con el cambio se quedaría sin checkout.
    const TP_FALABELLA_DEMO_ID = '550e8400-e29b-41d4-a716-446655440363';
    const existsTpFalaDemo = await this.tenantPasarelaRepo.findOne({
      where: { tenantPasarelaId: TP_FALABELLA_DEMO_ID },
      withDeleted: true,
    });
    if (!existsTpFalaDemo) {
      await this.tenantPasarelaRepo.save(
        this.tenantPasarelaRepo.create({
          tenantPasarelaId: TP_FALABELLA_DEMO_ID,
          tenantId: '550e8400-e29b-41d4-a716-446655440040',
          pasarelaId: DEMO_ID,
          ambiente: 'pruebas',
          modoIntegracion: 'individual',
          configuracion: null,
          activo: true,
          prioridad: 1,
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
    const CONTADOR_PARIS = '550e8400-e29b-41d4-a716-446655440328';
    const APROBADOR_PARIS = '550e8400-e29b-41d4-a716-446655440329';
    const SUPERVISOR_PARIS = '550e8400-e29b-41d4-a716-446655440335';
    const ANA_TORRES = '550e8400-e29b-41d4-a716-446655440341';
    const TOTEM_PARIS = '550e8400-e29b-41d4-a716-446655440342';
    const ENCARGADO_PARIS = '550e8400-e29b-41d4-a716-446655440344';
    const GARZON_PIN_PARIS = '550e8400-e29b-41d4-a716-446655440346';
    const ENCARGADO_SALON_PARIS = '550e8400-e29b-41d4-a716-446655440348';
    const pairs = [
      [ADMIN, PARIS], // superadmin → Paris
      [ADMIN, FALABELLA], // superadmin → Falabella
      [ADMIN_PARIS, PARIS], // admin tenant → Paris
      [VENDEDOR_PARIS, PARIS], // vendedor → Paris
      [CONTADOR_PARIS, PARIS], // cuenta recuentos, no los aplica → Paris
      [APROBADOR_PARIS, PARIS], // aplica recuentos, no cuenta → Paris
      [SUPERVISOR_PARIS, PARIS], // ve todas las cajas, no es admin → Paris
      [ANA_TORRES, PARIS], // tablet personal: vinculada al garzón Ana Torres
      [TOTEM_PARIS, PARIS], // dispositivo compartido: siempre pide PIN
      [ENCARGADO_PARIS, PARIS], // fuerza cierres, Cajas:Actualizar, no admin → Paris
      [GARZON_PIN_PARIS, PARIS], // fixture exclusiva de garzon-pin.e2e-spec.ts → Paris
      [ENCARGADO_SALON_PARIS, PARIS], // Salones:Actualizar sin ser admin → Paris
    ];

    for (const [usuarioId, tenantId] of pairs) {
      await this.dataSource.query(
        `INSERT INTO usuarios_tenants (usuario_id, tenant_id, creado_el, actualizado_el)
         VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [usuarioId, tenantId],
      );
    }

    // El marcador va aparte del INSERT de arriba porque `ON CONFLICT DO NOTHING`
    // no lo aplicaría en una base ya sembrada.
    await this.dataSource.query(
      `UPDATE usuarios_tenants SET es_totem = true
        WHERE usuario_id = $1 AND tenant_id = $2`,
      [TOTEM_PARIS, PARIS],
    );
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

  /**
   * Los dos lados de la asimetría de recuentos, en Paris: quien cuenta
   * (`Inventario/Crear`) y quien aprueba (`Inventario/Actualizar`). Ninguno es
   * admin, y ninguno tiene el permiso del otro — esa es toda la gracia.
   *
   * Existe porque la separación contar/aprobar no se podía ejercer con nada:
   * el único no-admin del seed (vendedor.paris) no tiene Inventario, y el admin
   * tiene todo. Un bug de UI que le escondía "Aplicar" al aprobador pasó los
   * tres gates sin que nada pudiera detectarlo.
   *
   * IDs 330-331: el 328-329 lo ocupan los usuarios de estos roles y el máximo
   * previo era 327 (el loop `let id = 316` de seedMotivosDiferenciaInventario
   * siembra 6 motivos x 2 tenants, invisible a un grep de literales).
   */
  private async seedRolesInventario(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CONTADOR = '550e8400-e29b-41d4-a716-446655440328';
    const APROBADOR = '550e8400-e29b-41d4-a716-446655440329';
    // moduloTenantId para Paris → Inventario (definido en seedTenantModulo)
    const MODULO_TENANT_INVENTARIO = '550e8400-e29b-41d4-a716-446655440201';
    // moduloTenantId para Paris → Items: ambas pantallas listan productos
    // (`GET /items`) para elegir qué contar y para filtrar el kardex. Sin este
    // permiso el rol no puede ni empezar un recuento.
    const MODULO_TENANT_ITEMS = '550e8400-e29b-41d4-a716-446655440202';
    // moduloAppPermiso IDs (definidos en seedModuloAppPermisos)
    const INVENTARIO_LEER = '550e8400-e29b-41d4-a716-446655440189';
    const INVENTARIO_CREAR = '550e8400-e29b-41d4-a716-446655440190';
    const INVENTARIO_ACTUALIZAR = '550e8400-e29b-41d4-a716-446655440291';
    const ITEMS_LEER = '550e8400-e29b-41d4-a716-446655440192';

    const INV = MODULO_TENANT_INVENTARIO;
    const ITEMS = MODULO_TENANT_ITEMS;

    const roles = [
      {
        rolId: '550e8400-e29b-41d4-a716-446655440330',
        nombre: 'Inventario · Conteo',
        descripcion: 'Cuenta y carga recuentos, pero no los aplica',
        usuarioId: CONTADOR,
        permisos: [
          { modulo: INV, permiso: INVENTARIO_LEER },
          { modulo: INV, permiso: INVENTARIO_CREAR },
          { modulo: ITEMS, permiso: ITEMS_LEER },
        ],
      },
      {
        rolId: '550e8400-e29b-41d4-a716-446655440331',
        nombre: 'Inventario · Aprobación',
        descripcion: 'Aplica recuentos y ajusta costos, pero no cuenta',
        usuarioId: APROBADOR,
        permisos: [
          { modulo: INV, permiso: INVENTARIO_LEER },
          { modulo: INV, permiso: INVENTARIO_ACTUALIZAR },
          { modulo: ITEMS, permiso: ITEMS_LEER },
        ],
      },
    ];

    for (const rol of roles) {
      const existing: { rol_id: string }[] = await this.dataSource.query(
        `SELECT rol_id FROM roles
          WHERE tenant_id = $1 AND nombre = $2 AND eliminado_el IS NULL`,
        [PARIS, rol.nombre],
      );

      if (existing.length === 0) {
        await this.dataSource.query(
          `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
           VALUES ($1, $2, $3, $4, false, NOW(), NOW())`,
          [rol.rolId, PARIS, rol.nombre, rol.descripcion],
        );
      }

      const rolId = existing[0]?.rol_id ?? rol.rolId;

      for (const moduloTenantId of new Set(rol.permisos.map((p) => p.modulo))) {
        await this.dataSource.query(
          `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
           VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [rolId, moduloTenantId],
        );
      }

      for (const { modulo, permiso } of rol.permisos) {
        await this.dataSource.query(
          `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [rolId, modulo, permiso],
        );
      }

      await this.dataSource.query(
        `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [rol.usuarioId, PARIS, rolId],
      );
    }
  }

  /**
   * El supervisor de cajas de Paris: `Cajas:Leer` y nada más. No es admin del
   * tenant y no tiene `MiCaja`, así que no opera ninguna caja propia — solo
   * mira las ajenas.
   *
   * Existe porque el **cierre ciego** se define contra exactamente este
   * usuario: `esAdmin = esSuperadmin || userIsTenantAdmin`, y el ciego aplica a
   * quien NO lo es. Con el seed anterior esa combinación no existía —admin.paris
   * hacía de "supervisor" pero es admin, y vendedor.paris no ve cajas ajenas—,
   * así que la retención del esperado solo la cubrían mocks: ningún e2e podía
   * distinguir "no ve el número porque es ciego" de "no ve el número porque no
   * llega a la caja".
   *
   * ID 335/336: el máximo previo era 334 (`moduloAppPermisoId` de Ventas/Anular).
   */
  private async seedRolSupervisorCajas(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const SUPERVISOR = '550e8400-e29b-41d4-a716-446655440335';
    const ROL_ID = '550e8400-e29b-41d4-a716-446655440336';
    const NOMBRE = 'Cajas · Supervisión';
    // moduloTenantId para Paris → Cajas (definido en seedTenantModulo)
    const MODULO_TENANT_CAJAS = '550e8400-e29b-41d4-a716-446655440284';
    // moduloAppPermiso Cajas/Leer (definido en seedModuloAppPermisos)
    const CAJAS_LEER = '550e8400-e29b-41d4-a716-446655440283';

    const existing: { rol_id: string }[] = await this.dataSource.query(
      `SELECT rol_id FROM roles
        WHERE tenant_id = $1 AND nombre = $2 AND eliminado_el IS NULL`,
      [PARIS, NOMBRE],
    );

    if (existing.length === 0) {
      await this.dataSource.query(
        `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
         VALUES ($1, $2, $3, 'Ve todas las cajas del tenant; no opera ninguna ni es admin', false, NOW(), NOW())`,
        [ROL_ID, PARIS, NOMBRE],
      );
    }

    const rolId = existing[0]?.rol_id ?? ROL_ID;

    await this.dataSource.query(
      `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_CAJAS],
    );

    await this.dataSource.query(
      `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_CAJAS, CAJAS_LEER],
    );

    await this.dataSource.query(
      `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SUPERVISOR, PARIS, rolId],
    );
  }

  /**
   * El encargado que fuerza el cierre de una caja ajena sin ser admin del
   * tenant (decisión del owner 2026-08-13, `caja.controller.ts` →
   * `resolverEscrituraCompartida`): `Cajas:Leer` + `Cajas:Actualizar`, y NO
   * admin — es la combinación que el ciego (`!esAdmin`, sin tocar) sigue
   * reteniendo aun pudiendo forzar. `supervisor.paris` (`seedRolSupervisorCajas`)
   * no sirve para esto a propósito: solo tiene `Cajas:Leer` y es el arnés de
   * otros tests que verifican el 403 de "no puede forzar sin `Actualizar`".
   *
   * ID 344/345: el máximo previo era 343 (`ROL_SALON` en `seedRolSalon`).
   */
  private async seedRolEncargadoCajas(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const ENCARGADO = '550e8400-e29b-41d4-a716-446655440344';
    const ROL_ID = '550e8400-e29b-41d4-a716-446655440345';
    const NOMBRE = 'Cajas · Encargado';
    // moduloTenantId para Paris → Cajas (definido en seedTenantModulo)
    const MODULO_TENANT_CAJAS = '550e8400-e29b-41d4-a716-446655440284';
    // moduloAppPermiso Cajas/Leer y Cajas/Actualizar (definidos en seedModuloAppPermisos)
    const CAJAS_LEER = '550e8400-e29b-41d4-a716-446655440283';
    const CAJAS_ACTUALIZAR = '550e8400-e29b-41d4-a716-446655440289';

    const existing: { rol_id: string }[] = await this.dataSource.query(
      `SELECT rol_id FROM roles
        WHERE tenant_id = $1 AND nombre = $2 AND eliminado_el IS NULL`,
      [PARIS, NOMBRE],
    );

    if (existing.length === 0) {
      await this.dataSource.query(
        `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
         VALUES ($1, $2, $3, 'Ve todas las cajas del tenant y puede forzar el cierre de una ajena; no es admin', false, NOW(), NOW())`,
        [ROL_ID, PARIS, NOMBRE],
      );
    }

    const rolId = existing[0]?.rol_id ?? ROL_ID;

    await this.dataSource.query(
      `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_CAJAS],
    );

    for (const permisoId of [CAJAS_LEER, CAJAS_ACTUALIZAR]) {
      await this.dataSource.query(
        `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [rolId, MODULO_TENANT_CAJAS, permisoId],
      );
    }

    await this.dataSource.query(
      `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ENCARGADO, PARIS, rolId],
    );
  }

  /**
   * El encargado que administra el salón sin ser admin del tenant:
   * `Salones:Leer` + `Salones:Crear` + `Salones:Actualizar`. Es a quien `garzones.service.ts` le
   * muestra el aviso *"…no va a poder entrar en modo personal hasta que se lo
   * des"*, y desde el 2026-08-16 el único fixture con el que se puede probar
   * que ese "se lo des" está en su mano: `POST /garzones/:id/permiso-operar`
   * pide este permiso y **no** `TenantAdminGuard`.
   *
   * No reusa `ana.torres` (tiene `Salones:Operar`, no `Actualizar` — sirve
   * justo para el 403 del mismo e2e) ni `admin.paris`, que short-circuita todo
   * por `es_fijo` y probaría otra cosa.
   *
   * ID 348/349: el máximo previo era 347.
   */
  private async seedRolEncargadoSalon(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const ENCARGADO_SALON = '550e8400-e29b-41d4-a716-446655440348';
    const ROL_ID = '550e8400-e29b-41d4-a716-446655440349';
    const NOMBRE = 'Salones · Encargado';
    // moduloTenantId para Paris → Salones (definido en seedTenantModulo)
    const MODULO_TENANT_SALONES = '550e8400-e29b-41d4-a716-446655440228';
    // moduloAppPermiso Salones/Leer y Salones/Actualizar (seedModuloAppPermisos)
    const SALONES_LEER = '550e8400-e29b-41d4-a716-446655440223';
    const SALONES_CREAR = '550e8400-e29b-41d4-a716-446655440224';
    const SALONES_ACTUALIZAR = '550e8400-e29b-41d4-a716-446655440225';

    await this.dataSource.query(
      `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
       VALUES ($1, $2, $3, 'Administra garzones y salones; no es admin del tenant', false, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [ROL_ID, PARIS, NOMBRE],
    );
    await this.dataSource.query(
      `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ROL_ID, MODULO_TENANT_SALONES],
    );
    // `Crear` va incluido porque la persona que describe la decisión del owner
    // es "quien puede dar de alta y vincular garzones": el aviso de "…hasta
    // que se lo des" sale tanto de `crear()` como de `actualizar()`, y un
    // fixture que solo pudiera actualizar no podría ejercer la mitad del caso.
    for (const permisoId of [SALONES_LEER, SALONES_CREAR, SALONES_ACTUALIZAR]) {
      await this.dataSource.query(
        `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [ROL_ID, MODULO_TENANT_SALONES, permisoId],
      );
    }
    await this.dataSource.query(
      `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ENCARGADO_SALON, PARIS, ROL_ID],
    );
  }

  private async seedMetodosPago(): Promise<void> {
    const metodos: Partial<MetodoPago>[] = [
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440105',
        nombre: 'Efectivo',
        abreviatura: 'EFE',
        esEfectivo: true,
      },
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440106',
        nombre: 'Tarjeta de débito',
        abreviatura: 'TDB',
      },
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440107',
        nombre: 'Tarjeta de crédito',
        abreviatura: 'TDC',
      },
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440108',
        nombre: 'Transferencia bancaria',
        abreviatura: 'TRF',
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

    // Backfill idempotente del flag es_efectivo (los métodos ya existentes no se
    // re-guardan por el if(!exists) de arriba; synchronize los crea con default false).
    await this.metodoPagoRepo.update(
      { metodoPagoId: '550e8400-e29b-41d4-a716-446655440105' },
      { esEfectivo: true },
    );
  }

  /**
   * ⚠️ **Agregar un `codigo` acá obliga a agregarlo también en
   * `frontend/app/utils/reglas-form-config.ts`** (`DESCUENTO_CONFIG` /
   * `RECARGO_CONFIG`) y en la lista espejo de su spec.
   *
   * Sin entrada allá, el drawer de descuentos/recargos **no renderiza modo ni
   * valor** para ese tipo y el usuario crea la regla sin importe. No lo ve
   * nada: el mapa es un `Record<string, …>`, así que la clave faltante no es
   * un error de tipos, y el consumidor la traga con `?? null`. Ya pasó con
   * `directo` (2026-08-01), que estuvo mudo hasta que se encontró a mano.
   *
   * El espejo es a mano porque backend y frontend son proyectos separados por
   * decisión del owner: un test de allá no lee archivos de acá.
   */
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
      {
        id: '550e8400-e29b-41d4-a716-446655440353',
        clase: 'recargo',
        codigo: 'recargo_por_monto_venta',
        nombre: 'Por monto de venta',
        descripcion:
          'Recargo por escalones de monto: se define por tramos de monto mínimo y se cobra el del tramo alcanzado. El caso típico es el recargo por pedido chico, que baja a medida que sube el total.',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440337',
        clase: 'descuento',
        codigo: 'directo',
        nombre: 'Descuento directo',
        descripcion:
          'Descuento de propósito general. Resta un porcentaje o monto fijo del total, sin condiciones especiales.',
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

    // Ver `seedDescuentos()`: mismo motivo para crearlo acá y no en la entity
    // (el índice va sobre `lower(nombre)` y TypeORM no puede expresarlo en
    // `@Index`).
    //
    // ⚠️ Va DESPUÉS del remap y no al principio de la función como en las
    // hermanas, y la diferencia no es cosmética: `remapImpuestosOficialesDuplicados`
    // soft-deletea los impuestos del tenant que duplican el IVA oficial, y el
    // índice es parcial (`WHERE eliminado_el IS NULL`). Creándolo antes, una
    // base con ese duplicado vivo haría fallar el `CREATE UNIQUE INDEX` y el
    // backend no arrancaría; creándolo después, el remap ya despejó el caso.
    //
    // `tenant_id` es NULLABLE acá (en `descuentos`/`recargos` no lo es), y eso
    // es justamente lo que deja al catálogo del país fuera del índice sin
    // ninguna cláusula extra: `CHK_impuestos_scope` fuerza `tenant_id` XOR
    // `pais_id`, las filas del país tienen `tenant_id` nulo, y en Postgres dos
    // NULL nunca colisionan en un índice único. La unicidad es por tenant y el
    // IVA del país no entra — no puede, por el CHECK (ADR-018).
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_impuestos_tenant_nombre_vivo
      ON impuestos (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);
  }

  /**
   * Desasocia impuestos personalizados que duplican un impuesto oficial del país
   * del tenant (mismo porcentaje y nombre con "IVA"): borra sus asociaciones
   * item_impuestos y soft-deletea el duplicado.
   *
   * Lo que evita la doble tributación es el **soft delete del duplicado**, no el
   * borrado de la asociación: el duplicado es un impuesto del tenant, y como
   * `tipo` no se expone en la API de escritura, entra como `'otro'` — que el
   * motor NO filtra, así que se sumaría al IVA derivado (38%).
   *
   * El paso que se quitó era el remapeo hacia el impuesto oficial. Ese sí es
   * inofensivo —la fila oficial es `tipo='iva'` y el motor la descarta antes de
   * derivar—, pero quedó sin sentido: el IVA sale de
   * `items.clasificacion_tributaria`, no de `item_impuestos`. Idempotente:
   * los duplicados quedan soft-deleteados y no vuelven a matchear. Los snapshots
   * de ventas_impuestos NO se tocan (ya congelaron porcentaje y valor).
   *
   * Los JOIN filtran `eliminado_el` (invariante 3) para NO mutar el catálogo de
   * un tenant que ya no existe: el barrido soft-deletea impuestos ajenos, y
   * hacerlo sobre una empresa eliminada es destruir datos que nadie pidió tocar.
   * No pierde cobertura: un tenant eliminado no vende, y si se restaura el
   * próximo arranque vuelve a alcanzarlo.
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
           JOIN tenants t ON t.tenant_id = i.tenant_id AND t.eliminado_el IS NULL
           JOIN provincia p ON p.provincia_id = t.provincia_id
                AND p.eliminado_el IS NULL
          WHERE p.pais_id = $1
            AND i.eliminado_el IS NULL
            AND i.porcentaje = $2::numeric
            AND i.nombre ILIKE '%iva%'`,
        [sys.pais_id, sys.porcentaje],
      );

      for (const dup of duplicados) {
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
    // Ver la nota de `seedGruposModificadores()`: el índice va sobre
    // `lower(nombre)` y TypeORM no puede expresarlo en `@Index`, así que la
    // entity no lo declara y lo crea acá con SQL cruda.
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_descuentos_tenant_nombre_vivo
      ON descuentos (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);

    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const TIPO_PRONTO_PAGO = '550e8400-e29b-41d4-a716-446655440100';
    const TIPO_POR_MAYOR = '550e8400-e29b-41d4-a716-446655440101';
    const TIPO_METODO_PAGO = '550e8400-e29b-41d4-a716-446655440118';
    const TIPO_POR_MONTO_VENTA = '550e8400-e29b-41d4-a716-446655440119';
    const TIPO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
    const descuentos: Partial<Descuento>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440114',
        // El nivel se declara en TODAS las filas, no solo en las que no son el
        // default: el seed es la referencia de cómo se ve una regla completa, y
        // una fila que lo omite enseña que es opcional pensarlo.
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_PRONTO_PAGO,
        nombre: 'Descuento pronto pago 10%',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: '0.10',
        condicionTipo: CondicionTipo.VENCIMIENTO,
        condicionValor: '30',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440125',
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_METODO_PAGO,
        nombre: 'Descuento pago en efectivo 3%',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: '0.03',
        condicionTipo: CondicionTipo.METODO_PAGO,
        condicionValor: null,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440126',
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_POR_MAYOR,
        nombre: 'Descuento mayorista por volumen',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: null,
        condicionTipo: CondicionTipo.CANTIDAD_MINIMA,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440127',
        // Nivel VENTA, y es el único sentido que tiene: sus tramos se miden
        // contra el monto de la COMPRA. Asociada a un ítem se dispararía con
        // una línea que alcance el mínimo aunque la venta no lo alcance.
        nivel: NivelRegla.VENTA,
        tenantId: PARIS,
        tipoReglaId: TIPO_POR_MONTO_VENTA,
        nombre: 'Descuento compra grande',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: null,
        condicionTipo: CondicionTipo.MONTO_MINIMO,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440128',
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_DIRECTO,
        nombre: 'Promo verano 2026-27',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: '0.15',
        // `NINGUNA` y no `FECHA`: es lo que `derivarCondicionTipo` produce para
        // `directo`, así una fila sembrada y una creada por API son iguales.
        // Verificado el 2026-08-23: nadie lee `condicion_tipo`.
        condicionTipo: CondicionTipo.NINGUNA,
        fechaInicio: '2026-12-01',
        fechaFin: '2027-01-31',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440338',
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_DIRECTO,
        nombre: 'Promo fija $5.000',
        modo: ModoRegla.MONTO_FIJO,
        valorMonto: '5000',
        condicionTipo: CondicionTipo.NINGUNA,
        activo: true,
      },
      {
        // Gemela de "Promo fija $5.000" pero de nivel VENTA, y existe para que
        // el demo —y el e2e— tengan un descuento que se elige al cobrar y se
        // descuenta del total. La de arriba se asocia a ítems; ésta no puede,
        // y ésa es toda la diferencia. Mismo monto a propósito: las dos topean
        // igual sobre una venta chica, así que el caso "topeado" se prueba a
        // los dos niveles con la misma aritmética.
        id: '550e8400-e29b-41d4-a716-446655440360',
        nivel: NivelRegla.VENTA,
        tenantId: PARIS,
        tipoReglaId: TIPO_DIRECTO,
        nombre: 'Promo del total $5.000',
        modo: ModoRegla.MONTO_FIJO,
        valorMonto: '5000',
        condicionTipo: CondicionTipo.NINGUNA,
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
        minimoCantidad: '10',
        valorPorcentaje: '0.05',
        orden: 1,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440134',
        descuentoId: POR_MAYOR,
        minimoCantidad: '50',
        valorPorcentaje: '0.12',
        orden: 2,
      },
      // por_monto_venta: $100.000+ 3%, $500.000+ 7%
      {
        id: '550e8400-e29b-41d4-a716-446655440135',
        descuentoId: POR_MONTO_VENTA,
        minimoMonto: '100000',
        valorPorcentaje: '0.03',
        orden: 1,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440136',
        descuentoId: POR_MONTO_VENTA,
        minimoMonto: '500000',
        valorPorcentaje: '0.07',
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
    // Ver `seedDescuentos()`: mismo motivo para crearlo acá y no en la entity.
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_recargos_tenant_nombre_vivo
      ON recargos (tenant_id, lower(nombre)) WHERE eliminado_el IS NULL
    `);

    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const TIPO_INTERES_SIMPLE = '550e8400-e29b-41d4-a716-446655440103';
    const TIPO_INTERES_COMPUESTO = '550e8400-e29b-41d4-a716-446655440104';
    const TIPO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';
    const TIPO_MORA = '550e8400-e29b-41d4-a716-446655440123';
    const TIPO_RECARGO_METODO_PAGO = '550e8400-e29b-41d4-a716-446655440124';
    const TIPO_POR_MONTO_VENTA = '550e8400-e29b-41d4-a716-446655440353';
    const recargos: Partial<Recargo>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440115',
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_INTERES_SIMPLE,
        nombre: 'Interés cuotas 5%',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: '0.05',
        condicionTipo: CondicionTipo.NINGUNA,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440129',
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_GENERAL,
        nombre: 'Recargo administrativo 2%',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: '0.02',
        condicionTipo: CondicionTipo.NINGUNA,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440130',
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_MORA,
        nombre: 'Mora por atraso 15 días',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: '0.01',
        condicionTipo: CondicionTipo.VENCIMIENTO,
        condicionValor: '15',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440131',
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_RECARGO_METODO_PAGO,
        nombre: 'Recargo tarjeta de crédito 3%',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: '0.03',
        condicionTipo: CondicionTipo.METODO_PAGO,
        condicionValor: null,
        activo: true,
      },
      {
        // El caso típico del tipo por escalones: recargo por pedido chico, que
        // baja a medida que sube el total. Las DOS columnas de importe en null
        // a propósito — el monto lo dicen los tramos (`seedRecargoTramos`),
        // que por ser esta regla `monto_fijo` lo llevan en `valorMonto`.
        id: '550e8400-e29b-41d4-a716-446655440354',
        // Espejo de "Descuento compra grande": el escalón lo decide el total del
        // pedido, así que es de nivel venta.
        nivel: NivelRegla.VENTA,
        tenantId: PARIS,
        tipoReglaId: TIPO_POR_MONTO_VENTA,
        nombre: 'Recargo por pedido chico',
        modo: ModoRegla.MONTO_FIJO,
        valorMonto: null,
        condicionTipo: CondicionTipo.NINGUNA,
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440132',
        nivel: NivelRegla.LINEA,
        tenantId: PARIS,
        tipoReglaId: TIPO_INTERES_COMPUESTO,
        nombre: 'Interés compuesto cuotas 4%',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: '0.04',
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

  /**
   * Tramos del recargo por escalones de monto. Espejo de
   * `seedDescuentoTramos`: el recargo NO queda asociado a ningún ítem, así que
   * no altera ninguna venta del seed — está para que el tipo se vea en la
   * pantalla de recargos con datos reales.
   */
  private async seedRecargoTramos(): Promise<void> {
    const POR_PEDIDO_CHICO = '550e8400-e29b-41d4-a716-446655440354';

    const tramos: Partial<RecargoTramo>[] = [
      // Bajo $20.000 recarga $2.000; de ahí en adelante, $500.
      {
        id: '550e8400-e29b-41d4-a716-446655440355',
        recargoId: POR_PEDIDO_CHICO,
        minimoMonto: '0',
        valorMonto: '2000',
        orden: 1,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440356',
        recargoId: POR_PEDIDO_CHICO,
        minimoMonto: '20000',
        valorMonto: '500',
        orden: 2,
      },
    ];

    for (const data of tramos) {
      const exists = await this.recargoTramoRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.recargoTramoRepo.save(this.recargoTramoRepo.create(data));
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
    await this.seedSuscripcionDemo();
    await this.seedIngredientesBase();
    await this.seedPapasFritas();
    await this.seedGruposModificadores();
    await this.seedComboEspecial();
  }

  /**
   * Dos promos demo (Tarea 10 del plan de motor de promociones), va DESPUÉS de
   * `seedItems()` porque el scope de la primera cuelga de ítems reales — no
   * antes, como `seedPromocionesIndices()` (esa es solo el índice, sin filas;
   * ver su docblock: al crear tenant no se siembra ninguna promo, esto es
   * aparte y demo-only).
   *
   * "2x1 de la casa (martes)": `nxm` cadaN=2 (paga 1 de cada 2), franja
   * 18:00–20:00, solo martes (`diasSemana=[2]`, ISO-8601 1=lunes). Nombre
   * genérico a propósito: el seed no tiene bebidas, así que el scope usa los
   * vendibles reales que sí existen (nada de ingredientes) — un nombre
   * temático a un rubro que el demo no cubre ("tragos") confundía a quien lo
   * abriera y viera hamburguesas descontadas. "Producto demo (unidad · CLP)"
   * (…440116, `seedProductoDemoVentas`), "Papas fritas" (…440281,
   * `seedPapasFritas`) y "Hamburguesa Especial" (…440294, tipo `receta` con
   * precio propio, `seedGruposModificadores`) — 3 tipos vendibles distintos
   * (producto/receta) a propósito, para que el demo no dependa de una sola
   * fila.
   *
   * "Happy hour 20%": `porcentaje` 0.20, sin `diasSemana` (todos los días),
   * franja 18:00–02:00 — cruza medianoche a propósito (horaInicio > horaFin),
   * es el diferenciador que el demo tiene que mostrar. Scope `venta`: aplica
   * a toda la venta, sin ítems ni categoría.
   *
   * Fechas 2026-01-01→2027-12-31: rango largo para cubrir la demo, pero CON
   * fin — el guardarraíl heredado de `promocional` (nunca sin fecha de
   * término) vale también acá.
   *
   * **Las dos nacen `activo: false` (pausadas).** Paris (…440007) es el único
   * tenant con catálogo del seed y trece specs e2e afirman totales exactos
   * sobre él (p. ej. `calculo-precios.e2e-spec.ts` espera `'100.000000'` /
   * `'0.000000'` de descuento) — activar una promo de scope `'venta'` sin
   * filtro de ítems/categoría cambia la plata de CUALQUIER venta de Paris que
   * caiga en su franja horaria, y con `promos_acumulan_descuentos` en su
   * default también puede anular el descuento de catálogo en vez de sumarse.
   * El otro tenant del seed (Falabella, …440040) tiene el mismo problema: lo
   * usan igual de specs e2e, así que no hay un tenant "libre" donde sembrarlas
   * activas (ambos tenants del seed están comprometidos). La trampa para el
   * próximo agente: sembrar una promo ACTIVA de scope `'venta'` —o de scope
   * `'items'` sobre ítems que otros e2e también usan— en un tenant que corre
   * suites ajenas rompe esas suites sin que el diff que las rompe se vea
   * relacionado. El valor del demo no se pierde: la pantalla muestra ambas
   * con badge "Pausada" y se activan con un clic desde
   * `configuracion/promociones.vue`.
   */
  private async seedPromociones(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';

    const DOSXUNO_ID = '550e8400-e29b-41d4-a716-446655440365';
    const DOSXUNO_SCOPE_ID = '550e8400-e29b-41d4-a716-446655440366';
    const HAPPYHOUR_ID = '550e8400-e29b-41d4-a716-446655440367';
    const HAPPYHOUR_SCOPE_ID = '550e8400-e29b-41d4-a716-446655440368';

    const ITEM_PRODUCTO_DEMO = '550e8400-e29b-41d4-a716-446655440116';
    const ITEM_PAPAS_FRITAS = '550e8400-e29b-41d4-a716-446655440281';
    const ITEM_HAMBURGUESA_ESPECIAL = '550e8400-e29b-41d4-a716-446655440294';

    const promociones: Partial<Promocion>[] = [
      {
        id: DOSXUNO_ID,
        tenantId: PARIS,
        nombre: '2x1 de la casa (martes)',
        descripcion: 'Lleva 2 y paga 1, los martes de 18:00 a 20:00.',
        activo: false,
        fechaInicio: '2026-01-01',
        fechaFin: '2027-12-31',
        horaInicio: '18:00',
        horaFin: '20:00',
        diasSemana: [2],
        canal: null,
        tipo: 'nxm',
        valorPorcentaje: '1.0000',
        cadaN: 2,
        valorMonto: null,
      },
      {
        id: HAPPYHOUR_ID,
        tenantId: PARIS,
        nombre: 'Happy hour 20%',
        descripcion: '20% de descuento en toda la venta, de 18:00 a 02:00.',
        activo: false,
        fechaInicio: '2026-01-01',
        fechaFin: '2027-12-31',
        horaInicio: '18:00',
        horaFin: '02:00',
        diasSemana: null,
        canal: null,
        tipo: 'porcentaje',
        valorPorcentaje: '0.2000',
        cadaN: null,
        valorMonto: null,
      },
    ];

    for (const data of promociones) {
      const exists = await this.promocionRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.promocionRepo.save(this.promocionRepo.create(data));
      }
    }

    const scopes: Partial<PromocionScope>[] = [
      {
        id: DOSXUNO_SCOPE_ID,
        promocionId: DOSXUNO_ID,
        slot: 0,
        tipoScope: 'items',
        categoriaId: null,
        cantidad: 1,
      },
      {
        id: HAPPYHOUR_SCOPE_ID,
        promocionId: HAPPYHOUR_ID,
        slot: 0,
        tipoScope: 'venta',
        categoriaId: null,
        cantidad: 1,
      },
    ];

    for (const data of scopes) {
      const exists = await this.promocionScopeRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.promocionScopeRepo.save(
          this.promocionScopeRepo.create(data),
        );
      }
    }

    const scopeItems: Partial<PromocionScopeItem>[] = [
      { scopeId: DOSXUNO_SCOPE_ID, itemId: ITEM_PRODUCTO_DEMO },
      { scopeId: DOSXUNO_SCOPE_ID, itemId: ITEM_PAPAS_FRITAS },
      { scopeId: DOSXUNO_SCOPE_ID, itemId: ITEM_HAMBURGUESA_ESPECIAL },
    ];

    for (const data of scopeItems) {
      const exists = await this.promocionScopeItemRepo.findOne({
        where: { scopeId: data.scopeId, itemId: data.itemId },
      });
      if (!exists) {
        await this.promocionScopeItemRepo.save(
          this.promocionScopeItemRepo.create(data),
        );
      }
    }
  }

  /**
   * Un ítem `tipo='suscripcion'`, que el seed no tenía.
   *
   * Sin él, `/tienda/suscripciones` se ve **vacía**: no hay nada a lo que
   * suscribirse, así que la pantalla no se puede mirar ni testear, y el bug de
   * que el drawer mostrara el neto mientras se cobraba el total con IVA hubo que
   * medirlo creando el ítem a mano.
   *
   * `afecto` y `precio_incluye_impuesto = false` a propósito: es justo la
   * combinación que hace visible la diferencia entre el neto del catálogo y lo
   * que se le autoriza a la tarjeta (30.000 → 35.700 con IVA 19%).
   */
  private async seedSuscripcionDemo(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const ELECTRONICA = '550e8400-e29b-41d4-a716-446655440110';
    const ITEM_ID = '550e8400-e29b-41d4-a716-446655440352';

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items WHERE item_id = $1`,
      [ITEM_ID],
    );
    if (exists.length) {
      return;
    }

    await this.dataSource.query(
      `INSERT INTO items (item_id, tenant_id, moneda_id, categoria_id, nombre, descripcion,
                          precio_base, precio_incluye_impuesto, activo, tipo, clasificacion_tributaria)
       VALUES ($1,$2,$3,$4,'Plan mensual demo','Item de desarrollo: suscripción mensual afecta a IVA','30000',false,true,'suscripcion','afecto')`,
      [ITEM_ID, PARIS, CLP, ELECTRONICA],
    );
    await this.dataSource.query(
      `INSERT INTO item_suscripcion (item_id, frecuencia) VALUES ($1,'mensual')`,
      [ITEM_ID],
    );
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

    // Migración soft: DBs ya sembradas con tipo=producto. clasificacion_tributaria
    // también se fuerza a NULL acá: sin esto, una BD que ya corrió esta
    // migración antes de que la columna existiera queda con
    // tipo='ingrediente' + clasificacion_tributaria='afecto' (el default),
    // violando la regla de que un ingrediente no tiene tratamiento fiscal.
    await this.dataSource.query(
      `UPDATE items SET tipo = 'ingrediente', precio_base = '0', clasificacion_tributaria = NULL, actualizado_el = NOW()
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
        // clasificacion_tributaria NULL explícito: el ítem no se vende, no
        // tiene tratamiento fiscal. La columna tiene DEFAULT 'afecto' para
        // protegerse de un INSERT que la omita por accidente — acá el NULL
        // es intencional, así que se manda explícito (gana sobre el default).
        `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, precio_base, precio_incluye_impuesto, activo, tipo, clasificacion_tributaria)
         VALUES ($1,$2,$3,$4,'0',$5,$6,'ingrediente',NULL)`,
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
      `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, precio_base, precio_incluye_impuesto, activo, tipo, clasificacion_tributaria)
       VALUES ($1,$2,$3,'Papas fritas','1500',false,true,'producto','afecto')`,
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
    // El índice de nombre único vivo va acá y NO en `@Index` de la entity:
    // `assertNombreLibre` compara con `LOWER(...)` y `startup-pos.sql` declara
    // el índice sobre `LOWER("nombre")`, pero **TypeORM no sabe expresar una
    // función en `@Index`**, así que `synchronize` creaba uno sobre `nombre`
    // pelado — case-sensitive. Resultado: la regla existía una sola vez, pero
    // dev la reproducía distinto de producción, y el único guard que quedaba
    // del lado de la base era el equivocado.
    //
    // Mismo patrón que `seedCausasMerma()` (y los dos de motivos-diferencia),
    // que ya resolvían esto así: la entity no declara el índice y el seeder lo
    // crea con SQL cruda.
    //
    // El `DROP` condicional limpia el índice case-sensitive que quedó en las
    // bases de dev creadas antes de este cambio. Solo dispara si el que existe
    // NO es el de `lower()`, así que en una base ya correcta no hay churn.
    //
    // ⚠️ Contrapartida de sacar el `@Index`: en dev, `synchronize` puede dejar
    // la tabla SIN el índice hasta que este seeder lo recree, o sea que la
    // única red del constraint pasa a ser que el seeder corra y no falle. Es
    // el mismo perfil de riesgo que ya tienen `causas_merma` y los dos
    // `motivos_diferencia` —que nunca declararon su índice en la entity—, no
    // uno nuevo; queda dicho porque ahora aplica a un caso más.
    await this.dataSource.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'uq_grupo_modificador_nombre_vivo'
             AND indexdef NOT ILIKE '%lower%'
        ) THEN
          EXECUTE 'DROP INDEX uq_grupo_modificador_nombre_vivo';
        END IF;
      END $$;
    `);
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_grupo_modificador_nombre_vivo
      ON grupos_modificadores (tenant_id, lower(nombre))
      WHERE eliminado_el IS NULL
    `);

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
        // clasificacion_tributaria NULL explícito — ver el comentario del
        // mismo patrón en seedIngredientesBase().
        `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, precio_base, precio_incluye_impuesto, activo, tipo, clasificacion_tributaria)
         VALUES ($1,$2,$3,$4,'0',$5,$6,'ingrediente',NULL)`,
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
    //
    // Va con `categoria_id`, y esa es la única razón por la que se le pone una:
    // `agruparEstacionesComanda` agrupa por la impresora de la CATEGORÍA del
    // ítem, así que un catálogo sin categorías ruteadas devuelve `[]` y **la
    // comanda no se puede ver en pantalla con el seed a secas**. La categoría
    // ya existía ruteada a "Cocina" a propósito (ver `seedCategorias`), pero
    // estaba vacía: la intención estaba escrita y no llegaba a ningún ítem.
    // Es la receta y no un producto porque una comanda de cocina con una
    // hamburguesa es el demo que alguien va a querer mirar.
    await this.dataSource.query(
      `INSERT INTO items (item_id, tenant_id, moneda_id, categoria_id, nombre, descripcion, precio_base, precio_incluye_impuesto, activo, tipo, clasificacion_tributaria)
       VALUES ($1,$2,$3,$4,'Hamburguesa Especial','Pan y queso fijos; elige tu proteína','3900',false,true,'receta','afecto')`,
      [
        HAMBURGUESA_ESPECIAL_ID,
        PARIS,
        CLP,
        '550e8400-e29b-41d4-a716-446655440111',
      ],
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
      `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, descripcion, precio_base, precio_incluye_impuesto, activo, tipo, clasificacion_tributaria)
       VALUES ($1,$2,$3,'Combo Especial','Hamburguesa Especial (elige tu proteína) + Papas fritas','4300',false,true,'combo','afecto')`,
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
   * Producto demo unidad·CLP, `afecto` — el motor le deriva el IVA 19% del país
   * (no se asocia por `item_impuestos`). Base de los tests E2E de ventas.
   * IDs 116 (item) / 120 (movimiento) reservados para esos tests.
   */
  private async seedProductoDemoVentas(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const ELECTRONICA = '550e8400-e29b-41d4-a716-446655440110';
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
                          precio_base, precio_incluye_impuesto, activo, tipo, clasificacion_tributaria)
       VALUES ($1,$2,$3,$4,'Producto demo (unidad · CLP)','Item de desarrollo: Unidad, precio en CLP','5000',false,true,'producto','afecto')`,
      [ITEM_ID, PARIS, CLP, ELECTRONICA],
    );
    await this.dataSource.query(
      `INSERT INTO item_producto (item_id, stock, unidad_medida, modo_inventario)
       VALUES ($1,'0','unidad','cantidad')`,
      [ITEM_ID],
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

  /**
   * Rol **Salón**: lo mínimo para operar el salón, sin nada de administración.
   *
   * Existe por el modo del dispositivo (Fase 2 del garzón). La tablet personal
   * y el tótem son cuentas comunes del tenant, y **la del tótem queda logueada
   * en un dispositivo compartido y desatendido**: si se la loguea con la cuenta
   * del admin, cualquiera que pase tiene permisos de administración. Este rol
   * es la recomendación operativa de `docs/features/garzones.md`, hecha
   * ejercitable.
   *
   * `Leer` además de `Operar` porque la pantalla del salón necesita el plano;
   * el selector de garzones va por `Operar` justamente para no exigir `Leer`.
   */
  private async seedRolSalon(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const ROL_SALON = '550e8400-e29b-41d4-a716-446655440343';
    const MODULO_TENANT_SALONES = '550e8400-e29b-41d4-a716-446655440228';
    const SALONES_LEER = '550e8400-e29b-41d4-a716-446655440223';
    const SALONES_OPERAR = '550e8400-e29b-41d4-a716-446655440227';
    const ANA_TORRES = '550e8400-e29b-41d4-a716-446655440341';
    const TOTEM_PARIS = '550e8400-e29b-41d4-a716-446655440342';
    // Fixture exclusiva de garzon-pin.e2e-spec.ts: necesita Salones:Operar
    // para resolver su vínculo con GET /garzones/mi-vinculo. Se suma al rol
    // Salón ya existente (que también trae Salones:Leer, no solo Operar) en
    // vez de crear un rol mínimo aparte — es la forma ya establecida acá.
    const GARZON_PIN_PARIS = '550e8400-e29b-41d4-a716-446655440346';

    await this.dataSource.query(
      `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
       VALUES ($1, $2, 'Salón', 'Operación del salón: mesas y cuentas', false, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [ROL_SALON, PARIS],
    );
    await this.dataSource.query(
      `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ROL_SALON, MODULO_TENANT_SALONES],
    );
    for (const permisoId of [SALONES_LEER, SALONES_OPERAR]) {
      await this.dataSource.query(
        `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [ROL_SALON, MODULO_TENANT_SALONES, permisoId],
      );
    }
    for (const usuarioId of [ANA_TORRES, TOTEM_PARIS, GARZON_PIN_PARIS]) {
      await this.dataSource.query(
        `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [usuarioId, PARIS, ROL_SALON],
      );
    }
  }

  private async seedVendedorPermisosCaja(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    // moduloTenantId para Paris → MiCaja (definido en seedTenantModulo)
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

    // Asignar MiCaja: Leer, Crear, Actualizar (sin el módulo Cajas — ese es el
    // diferenciador supervisor/encargado, que da lectura de todas las cajas)
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
