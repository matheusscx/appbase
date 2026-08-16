import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull, type EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { Usuario } from '../users/usuario.entity';
import { CrearUsuarioTenantDto } from './dto/crear-usuario-tenant.dto';
import { Tenant } from './entities/tenant.entity';
import { UsuarioTenant } from './entities/usuario-tenant.entity';
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from '../caja/entities/caja.entity';
import { RazonSocial } from './entities/razon-social.entity';
import { PropinaConfiguracion } from '../propinas/entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from '../propinas/entities/propina-grupo-distribucion.entity';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { GarzonesService } from '../garzones/garzones.service';
import { TokensAccesoService } from '../auth/tokens-acceso.service';
import {
  TipoTokenAcceso,
  type TokenAcceso,
} from '../auth/entities/token-acceso.entity';
import { MailService } from '../mail/mail.service';
import { CriterioDistribucion } from '../propinas/enums/criterio-distribucion.enum';
import { BaseVentasGrupo } from '../propinas/enums/base-ventas-grupo.enum';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateMyTenantDto } from './dto/update-my-tenant.dto';
import { UpdatePreferenciasFinancierasDto } from './dto/update-preferencias-financieras.dto';
import { CreateRazonSocialDto } from './dto/create-razon-social.dto';
import { UpdateRazonSocialDto } from './dto/update-razon-social.dto';
import { CAUSAS_MERMA_FIJAS } from '../mermas/causas-merma.defaults';
import { MOTIVOS_DIFERENCIA_DEFAULTS } from '../motivos-diferencia/motivos-diferencia.defaults';
import { MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS } from '../motivos-diferencia-inventario/motivos-diferencia-inventario.defaults';

export interface TenantMember {
  usuarioId: string;
  nombre: string;
  apellido: string;
  correo: string;
  /** La cuenta se usa como tótem compartido: en el salón siempre se pide PIN. */
  esTotem: boolean;
  roles: { rolId: string; nombre: string }[];
  /**
   * `true` = **todavía no es miembro**: el alta le mandó un mail y la persona no
   * confirmó. No tiene fila en `usuarios_tenants` ni en `roles_usuarios`; los
   * `roles` de abajo son los que va a recibir cuando confirme, no los que tiene.
   *
   * Sale en esta lista porque si no, el admin que acaba de dar de alta a alguien
   * no ve nada y cree que el alta falló.
   */
  pendienteConfirmacion: boolean;
}

/**
 * Lo mínimo para poblar un selector de cuentas: **sin correo y sin roles**.
 *
 * Existe porque esos dos campos son los que no se pueden repartir. El correo es
 * PII y además el identificador de login; la lista de roles dice quién es admin,
 * o sea a quién conviene atacar. Un selector no necesita ninguno de los dos.
 */
export interface TenantMemberSelector {
  usuarioId: string;
  nombre: string;
  apellido: string;
  esTotem: boolean;
}

/**
 * El cuerpo del mail de invitación. Texto plano: son dos mails y ninguno
 * necesita HTML.
 *
 * El link lleva el token en claro, que es la **única** vez que existe fuera de
 * la memoria del proceso: en la base solo queda su hash.
 */
function mailDeInvitacion(correo: string, token: string, base: string) {
  return {
    para: correo,
    asunto: 'Te sumaron a un equipo — elegí tu contraseña',
    cuerpo:
      `Te dieron de alta en un equipo del sistema.\n\n` +
      `Elegí tu contraseña acá (el link vence en 7 días):\n` +
      `${base}/invitacion/${token}\n\n` +
      `Si no esperabas este mail, ignoralo: sin entrar a ese link no se puede ` +
      `usar la cuenta.`,
  };
}

/**
 * El mail del alta cuando **la cuenta ya existe y ya tiene contraseña**.
 *
 * No dice "confirmá tu correo" a propósito. El caso legítimo más común no es
 * alguien probando su dirección: es alguien que ya trabaja en otra empresa del
 * sistema y a quien esta lo suma. Para esa persona "confirmá tu correo" no
 * describe nada de lo que está pasando —su correo ya funciona hace meses— y el
 * dato que necesita para decidir es **quién la está sumando y a dónde**.
 *
 * Y nombra al tenant también por el otro lado: si el alta la disparó alguien que
 * no debía, el mail es la única señal que recibe el dueño de la casilla, y una
 * señal sin nombre no se puede accionar.
 */
function mailDeConfirmacion(
  correo: string,
  token: string,
  tenant: string,
  base: string,
) {
  return {
    para: correo,
    asunto: `Te están sumando a ${tenant}`,
    cuerpo:
      `Un administrador de ${tenant} te sumó a su equipo con esta dirección.\n\n` +
      `Tu cuenta ya existe: no cambia tu contraseña ni nada de lo que ya usás. ` +
      `Solo falta que confirmes que este correo es tuyo y que aceptás entrar ` +
      `(el link vence en 7 días):\n` +
      `${base}/confirmacion/${token}\n\n` +
      `Hasta que entres a ese link NO formás parte de ${tenant} y nadie de ahí ` +
      `ve nada tuyo.\n\n` +
      `Si no conocés ${tenant}, ignorá este mail: sin el link no pasa nada.`,
  };
}

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(UsuarioTenant)
    private readonly usuarioTenantRepo: Repository<UsuarioTenant>,
    @InjectRepository(TenantModulo)
    private readonly tenantModuloRepo: Repository<TenantModulo>,
    @InjectRepository(TenantFormulaPrecio)
    private readonly tenantFormulaPrecioRepo: Repository<TenantFormulaPrecio>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(RazonSocial)
    private readonly razonSocialRepo: Repository<RazonSocial>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly garzonesService: GarzonesService,
    private readonly tokensAcceso: TokensAccesoService,
    private readonly mail: MailService,
    // Por `ConfigService` y no `process.env`: `process.env` no se puede mockear.
    private readonly config: ConfigService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Admin group (superadmin)
  // ─────────────────────────────────────────────────────────────────────────

  async create(dto: CreateTenantDto, creadorId: string): Promise<Tenant> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Create tenant
      const tenant = manager.create(Tenant, {
        provinciaId: dto.provinciaId,
        nombre: dto.nombre,
        correo: dto.correo,
        telefono: dto.telefono ?? null,
        direccion: dto.direccion ?? null,
        calculoDescuentos: 'base',
        calculoRecargos: 'base',
        escalaCalculo: 6,
        modoRedondeo: 'HALF_UP',
        montoTolerancia: '0',
      });
      const savedTenant = await manager.save(Tenant, tenant);

      // 2. Create rol Administrador (raw — entidad Rol no existe aún)
      const rolId = randomUUID();
      await manager.query(
        `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
         VALUES ($1, $2, 'Administrador', 'Acceso completo', true, NOW(), NOW())`,
        [rolId, savedTenant.id],
      );

      // 3. Create usuarios_tenants
      const usuarioTenant = manager.create(UsuarioTenant, {
        usuarioId: creadorId,
        tenantId: savedTenant.id,
      });
      await manager.save(UsuarioTenant, usuarioTenant);

      // 4. Create roles_usuarios (raw — entidad RolUsuario no existe aún)
      await manager.query(
        `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [creadorId, savedTenant.id, rolId],
      );

      // 5. Create tenant_formula_precio (default: descuentos → recargos → impuestos)
      const formula: Partial<TenantFormulaPrecio>[] = [
        { tenantId: savedTenant.id, paso: 1, tipo: 'descuentos' },
        { tenantId: savedTenant.id, paso: 2, tipo: 'recargos' },
        { tenantId: savedTenant.id, paso: 3, tipo: 'impuestos' },
      ];
      for (const row of formula) {
        await manager.save(
          TenantFormulaPrecio,
          manager.create(TenantFormulaPrecio, row),
        );
      }

      // 6. Create caja virtual
      const caja = manager.create(Caja, {
        tenantId: savedTenant.id,
        tipo: 'virtual',
        estado: 'abierta',
        saldoInicial: '0',
      });
      await manager.save(Caja, caja);

      // 6a. Garzón placeholder "Mostrador" (receptor neutro de propina del POS)
      await this.garzonesService.asegurarMostrador(manager, savedTenant.id);

      // 6b. Configuración default de distribución de propinas (100% Garzones)
      const propinaConfig = await manager.save(
        PropinaConfiguracion,
        manager.create(PropinaConfiguracion, {
          tenantId: savedTenant.id,
          version: 1,
          porcentajeSugerido: '0.10',
          actualizadoPor: null,
        }),
      );
      await manager.save(
        PropinaGrupoDistribucion,
        manager.create(PropinaGrupoDistribucion, {
          tenantId: savedTenant.id,
          configuracionId: propinaConfig.id,
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

      // 7. Sembrar causas de merma fijas del sistema
      for (const nombre of CAUSAS_MERMA_FIJAS) {
        await manager.query(
          `INSERT INTO causas_merma (tenant_id, nombre, activo, es_fijo)
           VALUES ($1, $2, true, true)`,
          [savedTenant.id, nombre],
        );
      }

      // 7b. Sembrar los motivos de diferencia por defecto del sistema
      for (const m of MOTIVOS_DIFERENCIA_DEFAULTS) {
        await manager.query(
          `INSERT INTO motivo_diferencia_caja
             (tenant_id, nombre, activo, requiere_comentario, es_fijo)
           VALUES ($1, $2, true, $3, true)`,
          [savedTenant.id, m.nombre, m.requiereComentario],
        );
      }

      // 7c. Sembrar los motivos de diferencia de inventario del sistema
      const valores = MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS.map(
        (_, i) => `($1, $${i + 2}, true, true)`,
      ).join(', ');
      await manager.query(
        `INSERT INTO motivo_diferencia_inventario (tenant_id, nombre, activo, es_fijo)
         VALUES ${valores}`,
        [savedTenant.id, ...MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS],
      );

      // 8. Habilitar la moneda oficial del país del tenant (default, tasa = 1)
      const oficialRows: { moneda_oficial_id: string | null }[] =
        await manager.query(
          `SELECT p.moneda_oficial_id
           FROM provincia prov
           JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
           WHERE prov.provincia_id = $1 AND prov.eliminado_el IS NULL`,
          [savedTenant.provinciaId],
        );
      const monedaOficialId = oficialRows[0]?.moneda_oficial_id;
      if (monedaOficialId) {
        await manager.query(
          `INSERT INTO tenant_moneda
             (tenant_id, moneda_id, es_default, habilitada, valor_del_dia, creado_el, actualizado_el)
           VALUES ($1, $2, true, true, 1, NOW(), NOW())
           ON CONFLICT (tenant_id, moneda_id) DO NOTHING`,
          [savedTenant.id, monedaOficialId],
        );
      }

      // 9. Habilitar los métodos de pago disponibles en el país del tenant
      const paisRows: { pais_id: string }[] = await manager.query(
        `SELECT prov.pais_id
         FROM provincia prov
         WHERE prov.provincia_id = $1 AND prov.eliminado_el IS NULL`,
        [savedTenant.provinciaId],
      );
      const paisId = paisRows[0]?.pais_id;
      if (paisId) {
        await manager.query(
          `INSERT INTO tenant_metodo_pago
             (tenant_id, metodo_pago_id, habilitada, permite_vuelto, creado_el, actualizado_el)
           SELECT $1, mpp.metodo_pago_id, true, false, NOW(), NOW()
           FROM metodo_pago_pais mpp
           WHERE mpp.pais_id = $2 AND mpp.eliminado_el IS NULL
           ON CONFLICT (tenant_id, metodo_pago_id) DO NOTHING`,
          [savedTenant.id, paisId],
        );
      }

      return savedTenant;
    });
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepo.find();
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} no encontrado`);
    }
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findOne(id);
    Object.assign(tenant, dto);
    return this.tenantRepo.save(tenant);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.tenantRepo.softDelete({ id });
  }

  async addModule(
    tenantId: string,
    moduloAppId: string,
  ): Promise<TenantModulo> {
    const modulo = this.tenantModuloRepo.create({
      tenantId,
      moduloAppId,
      estado: 'activo',
    });
    return this.tenantModuloRepo.save(modulo);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tenant-active group (authenticated users with tenantId in JWT)
  // ─────────────────────────────────────────────────────────────────────────

  async findMine(tenantId: string): Promise<Tenant> {
    return this.findOne(tenantId);
  }

  /**
   * El roster del tenant: los miembros **y** las altas que esperan confirmación.
   *
   * Los pendientes no tienen fila en `usuarios_tenants` —por diseño: quien no
   * confirmó no es miembro, ver el docblock de `TokenAcceso.datos`—, así que la
   * segunda mitad de la unión los saca de su token vivo y expande los `rolIds`
   * congelados para mostrar qué roles va a recibir.
   *
   * **`UNION ALL` y no dos consultas mergeadas en JS**: son dos formas de la
   * misma fila y el resultado se agrupa igual. Dos consultas serían dos
   * round-trips para una sola pantalla, y la variante por fila sería el N+1 de
   * siempre.
   */
  async findMembers(tenantId: string): Promise<TenantMember[]> {
    const rows: {
      usuario_id: string;
      nombre: string;
      apellido: string;
      correo: string;
      es_totem: boolean;
      rol_id: string | null;
      rol_nombre: string | null;
      pendiente: boolean;
    }[] = await this.dataSource.query(
      `SELECT u.usuario_id,
              u.nombre,
              u.apellido,
              u.correo,
              ut.es_totem,
              r.rol_id,
              r.nombre AS rol_nombre,
              false AS pendiente
       FROM usuarios_tenants ut
       JOIN usuarios u ON u.usuario_id = ut.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN roles_usuarios ru ON ru.usuario_id = ut.usuario_id
            AND ru.tenant_id = ut.tenant_id AND ru.eliminado_el IS NULL
       LEFT JOIN roles r ON r.rol_id = ru.rol_id AND r.tenant_id = ru.tenant_id
            AND r.eliminado_el IS NULL
       WHERE ut.tenant_id = $1
         AND ut.eliminado_el IS NULL

       UNION ALL

       -- El alta que todavía no confirmó. La condición de "vivo" es la misma
       -- que la de \`buscarVigente\`: sin usar y sin vencer. Un token vencido
       -- desaparece solo de esta lista, que es lo correcto — ya no va a
       -- confirmar nadie y el admin tiene que volver a dar el alta.
       SELECT u.usuario_id,
              u.nombre,
              u.apellido,
              u.correo,
              false AS es_totem,
              r.rol_id,
              r.nombre AS rol_nombre,
              true AS pendiente
       FROM tokens_acceso ta
       JOIN usuarios u ON u.usuario_id = ta.usuario_id AND u.eliminado_el IS NULL
       -- Los \`rolIds\` congelados en el token, uno por fila. Son UUIDs válidos
       -- por el DTO del alta, así que el cast no puede reventar; y el LATERAL
       -- solo produce filas para \`datos\` no nulo, que es exclusivo de este tipo.
       LEFT JOIN LATERAL jsonb_array_elements_text(ta.datos -> 'rolIds') AS rid
            ON true
       LEFT JOIN roles r ON r.rol_id = rid::uuid AND r.tenant_id = $1
            AND r.eliminado_el IS NULL
       WHERE ta.tipo = 'confirmacion'
         AND ta.usado_el IS NULL
         AND ta.eliminado_el IS NULL
         AND ta.expira_el > NOW()
         -- $2 es el mismo tenant que $1, pasado aparte porque acá se compara
         -- contra texto (jsonb) y allá contra \`uuid\`: un solo parámetro con dos
         -- tipos deducidos rompe la unión.
         AND ta.datos ->> 'tenantId' = $2
       -- Los pendientes al final, y no intercalados por nombre: son otra cosa
       -- que un miembro.
       ORDER BY pendiente, nombre, apellido`,
      [tenantId, tenantId],
    );

    const porUsuario = new Map<string, TenantMember>();
    for (const row of rows) {
      let member = porUsuario.get(row.usuario_id);
      if (!member) {
        member = {
          usuarioId: row.usuario_id,
          nombre: row.nombre,
          apellido: row.apellido,
          correo: row.correo,
          esTotem: row.es_totem,
          roles: [],
          pendienteConfirmacion: row.pendiente,
        };
        porUsuario.set(row.usuario_id, member);
      } else if (member.pendienteConfirmacion !== row.pendiente) {
        // La misma persona en las dos mitades: es miembro **y** tiene un token
        // vivo (se la sumó por otro camino después del alta). Gana la membresía
        // —está adentro de verdad— y las filas del token se descartan enteras,
        // para no mezclar roles que tiene con roles que recibiría. Se descartan
        // y no se listan aparte a propósito: `usuarioId` es la llave de la fila
        // en la pantalla y duplicarla rompe la lista.
        continue;
      }
      if (row.rol_id && row.rol_nombre) {
        member.roles.push({ rolId: row.rol_id, nombre: row.rol_nombre });
      }
    }

    return [...porUsuario.values()];
  }

  /**
   * El roster mínimo para los selectores de cuenta (cajones y garzones).
   *
   * Es `findMembers` sin lo sensible y sin el JOIN a roles —que es el único
   * motivo por el que aquella devuelve varias filas por usuario y necesita
   * deduplicar—. Acá una fila es un miembro.
   */
  async findMembersParaSelector(
    tenantId: string,
  ): Promise<TenantMemberSelector[]> {
    const rows: {
      usuario_id: string;
      nombre: string;
      apellido: string;
      es_totem: boolean;
    }[] = await this.dataSource.query(
      `SELECT u.usuario_id,
              u.nombre,
              u.apellido,
              ut.es_totem
       FROM usuarios_tenants ut
       JOIN usuarios u ON u.usuario_id = ut.usuario_id AND u.eliminado_el IS NULL
       WHERE ut.tenant_id = $1
         AND ut.eliminado_el IS NULL
       ORDER BY u.nombre, u.apellido`,
      [tenantId],
    );

    return rows.map((r) => ({
      usuarioId: r.usuario_id,
      nombre: r.nombre,
      apellido: r.apellido,
      esTotem: r.es_totem,
    }));
  }

  /**
   * Suma una cuenta **existente** al tenant, por su `usuarioId`.
   *
   * ⚠️ **Mismo criterio que `crearUsuario`: una cuenta con contraseña puesta no
   * queda asociada sin que la persona confirme** (decisión del owner,
   * 2026-08-15). Este método es la **otra puerta** al mismo efecto, y cerrar
   * sólo el alta dejaba el invariante a medias: `POST /tenants/usuarios`
   * devuelve el `usuarioId` incluso cuando deja la confirmación pendiente, así
   * que el camino completo eran dos requests. Buscar por conducta —"asociar una
   * cuenta a un tenant"— y no por nombre de método es lo que encontró esto.
   *
   * Se diferencia del alta en una sola cosa: acá **no vienen roles**. El token
   * viaja con `rolIds: []`, y `confirmarIngreso` lo lee como "sumar sin roles"
   * en vez de como "los roles se murieron" — que es lo que significa un array
   * que quedó vacío al revalidar.
   */
  async addMember(
    tenantId: string,
    usuarioId: string,
  ): Promise<{ usuarioId: string; pendienteConfirmacion: boolean }> {
    // Idempotent: restore if soft-deleted, create if new
    const existing = await this.usuarioTenantRepo.findOne({
      where: { tenantId, usuarioId },
      withDeleted: true,
    });

    // Ya es miembro vivo: no hay nada que hacer ni nada que confirmar. Sigue
    // siendo idempotente, como antes.
    if (existing && !existing.eliminadoEl) {
      return { usuarioId, pendienteConfirmacion: false };
    }

    const cuenta = await this.cuentaParaAsociar(usuarioId);

    if (cuenta.contrasena !== null) {
      // `!== null` estricto y no un truthy: si algún día el `SELECT` deja de
      // traer la columna, `undefined` cae del lado de pedir confirmación, no
      // del de asociar en silencio.
      const tenant = await this.tenantRepo.findOne({
        where: { id: tenantId, eliminadoEl: IsNull() },
      });
      if (!tenant) throw new NotFoundException('Tenant no encontrado');

      // Acotado al tenant: este usuario puede tener un alta pendiente en otra
      // empresa, y quemarla desde acá la haría desaparecer de aquel roster.
      await this.tokensAcceso.invalidarAnteriores(
        usuarioId,
        TipoTokenAcceso.CONFIRMACION,
        undefined,
        tenantId,
      );
      const token = await this.tokensAcceso.emitir(
        usuarioId,
        TipoTokenAcceso.CONFIRMACION,
        undefined,
        { tenantId, rolIds: [] },
      );
      await this.mail.enviar(
        mailDeConfirmacion(
          cuenta.correo,
          token,
          tenant.nombre,
          this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173',
        ),
      );
      return { usuarioId, pendienteConfirmacion: true };
    }

    // Sin contraseña: nadie controla esa cuenta todavía, así que no hay a quién
    // pedirle permiso. Conducta de siempre.
    if (existing) {
      // El tótem es override duro: si esta cuenta lo era antes de la baja,
      // resucitarla en silencio con `es_totem` todavía en `true` bloquea
      // sin explicación un intento posterior de vincularle un garzón
      // personal. Nadie decidió que el tótem sobreviviera a la baja — el
      // admin que vuelve a sumar a alguien está dando de alta una cuenta
      // normal, no restaurando la configuración vieja.
      existing.eliminadoEl = null;
      existing.esTotem = false;
      await this.usuarioTenantRepo.save(existing);
      return { usuarioId, pendienteConfirmacion: false };
    }

    await this.usuarioTenantRepo.save(
      this.usuarioTenantRepo.create({ tenantId, usuarioId }),
    );
    return { usuarioId, pendienteConfirmacion: false };
  }

  /** La cuenta que se va a asociar, viva. Sólo lo que decide el camino. */
  private async cuentaParaAsociar(
    usuarioId: string,
  ): Promise<{ correo: string; contrasena: string | null }> {
    const filas = await this.dataSource.query<
      { correo: string; contrasena: string | null }[]
    >(
      `SELECT correo, contrasena FROM usuarios
        WHERE usuario_id = $1 AND eliminado_el IS NULL`,
      [usuarioId],
    );
    if (filas.length === 0) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return filas[0];
  }

  /**
   * Alta de un usuario del tenant por su admin. Cuatro caminos:
   *
   * 1. **El correo no existe** → se crea **sin contraseña**, se asocia, se le
   *    asignan los roles y le llega una **invitación por link** para que elija
   *    la suya. El admin no conoce nunca una credencial ajena.
   * 2. **Existe, no es miembro y NO tiene contraseña** (la invitaron en otro
   *    lado y nunca la eligió) → se asocia y le quedan **exactamente** los roles
   *    del alta *en este tenant*; los que tenga en otros no se tocan. No hay
   *    nada que confirmar: **nadie controla esa cuenta todavía**.
   * 3. **Existe, no es miembro y SÍ tiene contraseña** → **no se asocia nada**.
   *    Se emite un token de confirmación con el tenant y los roles adentro, y
   *    sale un mail "te están sumando a X". La membresía y los roles los escribe
   *    `confirmarIngreso`, cuando la persona entra al link.
   * 4. **Existe y ya es miembro** → `409`. No es idempotente **a propósito**, a
   *    diferencia de `addMember`: acá vienen roles, y un 200 en silencio tendría
   *    dos lecturas —no hice nada, o le pisé los roles que ya tenía— y la
   *    segunda le cambia los permisos a alguien sin que el admin lo pida.
   *
   * ⚠️ **Por qué el 3 existe** (decisión del owner, 2026-08-15): hasta acá el
   * alta **adoptaba** cualquier cuenta cuyo correo coincidiera. Alguien que
   * pre-registrara `futuro.empleado@empresa.cl` con una contraseña suya recibía,
   * el día del alta, los roles que el admin eligiera para otra persona — y nadie
   * se enteraba, porque ese camino no mandaba ninguna señal. **"El correo
   * coincide" no es prueba de identidad**: la prueba es que quien lee esa casilla
   * haga clic.
   *
   * Todo en **una transacción**: si falla la asignación de roles no puede quedar
   * un usuario creado y asociado sin poder hacer nada.
   *
   * ⚠️ **El único borde de `rolIds` es el DTO**, y este método tiene un solo
   * llamador (el controller). La baja de los roles que no vinieron usa
   * `rol_id <> ALL($3)`, que con un array vacío es TRUE para todos: sin
   * `@ArrayMinSize(1)` sería un borrado de todos los permisos de esa persona en
   * el tenant. Si algún día esto gana un segundo llamador —seeder, import
   * masivo, otro service— el chequeo tiene que mudarse acá adentro.
   *
   * ⚠️ **Lo que sigue sin resolver:** un admin puede dar de alta cualquier
   * dirección, así que al dueño de esa casilla le llega un mail que no pidió.
   * Eso queda asumido; lo que ya no pasa es que la dirección quede *adentro* del
   * tenant sin que nadie de ese lado diga que sí.
   */
  async crearUsuario(
    tenantId: string,
    dto: CrearUsuarioTenantDto,
  ): Promise<{
    usuarioId: string;
    correo: string;
    /** `true` si se creó la cuenta y salió el mail de invitación. */
    invitado: boolean;
    /**
     * `true` si la cuenta ya existía **con contraseña**: no se asoció nada y
     * salió el mail de confirmación. La persona todavía **no es miembro**.
     */
    pendienteConfirmacion: boolean;
  }> {
    let invitacion: string | undefined;
    let confirmacion: { token: string; tenant: string } | undefined;
    let resultado: { usuarioId: string; correo: string };
    try {
      resultado = await this.dataSource.transaction(async (manager) => {
        // Los roles se validan contra ESTE tenant: no hay roles globales
        // (verificado), así que sin este chequeo un admin podría asignar el rol de
        // otra empresa pasando su id.
        const rolesDelTenant = await manager.query<{ rol_id: string }[]>(
          `SELECT rol_id FROM roles
          WHERE rol_id = ANY($1::uuid[]) AND tenant_id = $2
            AND eliminado_el IS NULL`,
          [dto.rolIds, tenantId],
        );
        if (rolesDelTenant.length !== dto.rolIds.length) {
          throw new BadRequestException(
            'Alguno de los roles no existe en este tenant',
          );
        }

        // El correo se normaliza ANTES de buscar y de guardar, no solo al
        // comparar. Buscar en minúsculas y guardar como vino tapaba la mitad del
        // problema: no se duplicaba la cuenta, pero el admin que tipea
        // `Juan.Perez@x.cl` dejaba dos formas del mismo correo dando vueltas: una
        // en la base y otra en el mail de invitación. Con el login ya
        // case-insensitive (`UsersService.findByEmail`), guardar normalizado deja
        // una sola forma canónica.
        const correo = dto.correo.trim().toLowerCase();

        // El id y **si la cuenta tiene contraseña**, que es lo que decide entre
        // adoptarla y pedir confirmación. El hash no se lee ni se compara: lo
        // único que importa es que exista, porque una cuenta con contraseña es
        // una cuenta que alguien ya controla.
        const usuarioPrevio = await manager
          .createQueryBuilder(Usuario, 'u')
          .select(['u.id', 'u.contrasena'])
          .where('LOWER(u.correo) = :correo', { correo })
          .getOne();

        let usuarioId: string;

        if (usuarioPrevio) {
          // ⚠️ `withDeleted` es obligatorio: `UsuarioTenant` tiene
          // `@DeleteDateColumn`, así que sin esto TypeORM filtra las borradas, la
          // rama de revivir queda INALCANZABLE y volver a dar de alta a alguien
          // que se eliminó del tenant respondía 201 sin asociarlo — el admin veía
          // éxito y la persona seguía afuera. Mismo recurso que `addMember`.
          const miembro = await manager.findOne(UsuarioTenant, {
            where: { usuarioId: usuarioPrevio.id, tenantId },
            withDeleted: true,
          });
          if (miembro && !miembro.eliminadoEl) {
            throw new ConflictException(
              'Ese correo ya es miembro de este tenant. Editá sus roles desde la tabla.',
            );
          }
          usuarioId = usuarioPrevio.id;

          // ⚠️ `!== null` estricto, no `!usuarioPrevio.contrasena` ni `!= null`:
          // acá se falla CERRADO. Si algún día el `select` de arriba deja de
          // traer la columna, `undefined !== null` manda el alta a confirmar —un
          // mail de más— en vez de adoptar la cuenta en silencio, que es
          // exactamente el agujero que este camino cierra.
          if (usuarioPrevio.contrasena !== null) {
            // No se escribe NADA de la membresía: ni `usuarios_tenants` ni
            // `roles_usuarios`. Sin fila en `usuarios_tenants` esta persona no
            // es miembro **por construcción**, así que ninguna de las nueve
            // lecturas de membresía del backend necesita saber que existe un
            // estado "pendiente". Ver el docblock de `TokenAcceso.datos`.
            //
            // Los anteriores se invalidan primero: dar de alta dos veces tiene
            // que dejar **un** link válido, el último. Si no, el mail viejo
            // —con los roles viejos congelados adentro— sigue sirviendo.
            // Acotado al tenant: ver el gemelo en `addMember`.
            await this.tokensAcceso.invalidarAnteriores(
              usuarioId,
              TipoTokenAcceso.CONFIRMACION,
              manager,
              tenantId,
            );
            const token = await this.tokensAcceso.emitir(
              usuarioId,
              TipoTokenAcceso.CONFIRMACION,
              manager,
              { tenantId, rolIds: dto.rolIds },
            );
            // El nombre del tenant va en el mail, no el id: es el único dato con
            // el que el dueño de la casilla puede decidir si esto lo esperaba.
            const [fila] = await manager.query<{ nombre: string }[]>(
              `SELECT nombre FROM tenants
                WHERE tenant_id = $1 AND eliminado_el IS NULL`,
              [tenantId],
            );
            if (!fila) {
              throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
            }
            confirmacion = { token, tenant: fila.nombre };
            return { usuarioId, correo };
          }

          if (miembro) {
            // Mismo motivo que `addMember`: revivir la membresía no puede
            // resucitar en silencio un `es_totem` de una configuración
            // anterior — nadie lo pidió, y un tótem fantasma bloquea sin
            // explicación un vínculo de garzón personal más tarde.
            miembro.eliminadoEl = null;
            miembro.esTotem = false;
            await manager.save(UsuarioTenant, miembro);
          } else {
            await manager.save(
              UsuarioTenant,
              manager.create(UsuarioTenant, { tenantId, usuarioId }),
            );
          }
        } else {
          // La cuenta se crea **sin contraseña** (`contrasena` es nullable) y la
          // persona la elige desde el link de invitación. Así nadie más que ella
          // conoce jamás una credencial suya — antes el admin dictaba una
          // temporal, y todo el andamiaje de "cambio obligatorio" existía solo
          // por eso.
          const creado = await manager.save(
            Usuario,
            manager.create(Usuario, {
              nombre: dto.nombre,
              apellido: dto.apellido ?? null,
              correo,
              telefono: dto.telefono ?? null,
              contrasena: null,
            }),
          );
          usuarioId = creado.id;
          await manager.save(
            UsuarioTenant,
            manager.create(UsuarioTenant, { tenantId, usuarioId }),
          );
          // Dentro de la transacción: si el alta falla, no puede quedar una
          // invitación viva apuntando a un usuario que no existe.
          invitacion = await this.tokensAcceso.emitir(
            usuarioId,
            TipoTokenAcceso.INVITACION,
            manager,
          );
        }

        await this.fijarRolesExactos(manager, usuarioId, tenantId, dto.rolIds);

        // Se devuelve el correo normalizado, no el tipeado: es el que la persona
        // tiene que usar para entrar.
        return { usuarioId, correo };
      });
    } catch (err: unknown) {
      // Check-then-act: el `SELECT` de arriba no ve la fila que otro request
      // concurrente todavía no comiteó, así que sin este `catch` el perdedor de
      // la carrera revienta con un 500 crudo donde correspondía el mismo 409 que
      // ya tira el chequeo deliberado un poco más arriba. Dos índices únicos
      // pueden dispararlo: `usuarios.correo` (dos altas con el mismo correo
      // nuevo) y la PK de `usuarios_tenants` (el mismo correo existente
      // asociándose dos veces al mismo tenant). Los índices evitan que la
      // carrera duplique datos; esto solo traduce el error que le llega al
      // perdedor.
      const pg = err as { code?: string };
      if (pg.code === '23505') {
        throw new ConflictException(
          'Ese correo ya es miembro de este tenant. Editá sus roles desde la tabla.',
        );
      }
      throw err;
    }

    // El mail sale DESPUÉS de commitear, nunca adentro: mandar dentro de la
    // transacción manda un link que apunta a filas que todavía pueden
    // revertirse. `MailService` no lanza, así que un SMTP caído no rompe el
    // alta — el token ya está emitido y el link se puede reenviar.
    const base =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    if (invitacion) {
      await this.mail.enviar(
        mailDeInvitacion(resultado.correo, invitacion, base),
      );
    }
    if (confirmacion) {
      await this.mail.enviar(
        mailDeConfirmacion(
          resultado.correo,
          confirmacion.token,
          confirmacion.tenant,
          base,
        ),
      );
    }
    return {
      ...resultado,
      invitado: invitacion !== undefined,
      pendienteConfirmacion: confirmacion !== undefined,
    };
  }

  /**
   * Deja al usuario con **exactamente** estos roles en este tenant: inserta (o
   * revive) los que vinieron y da de baja los que no. Dos sentencias, ninguna
   * por rol.
   *
   * ⚠️ **El array vacío es un borrado total.** La baja usa `rol_id <> ALL($3)`,
   * que con un array vacío es TRUE para todas las filas: le quitaría a esa
   * persona todos sus permisos en el tenant. Hoy los dos llamadores garantizan
   * al menos uno —`@ArrayMinSize(1)` en el DTO del alta, y el rechazo explícito
   * de `confirmarIngreso` cuando no sobrevivió ningún rol—, pero cualquier
   * llamador nuevo tiene que garantizarlo también.
   *
   * ⚠️ **Por qué la baja existe:** `removeMember` da de baja la membresía pero
   * **deja vivas** las filas de `roles_usuarios`, así que sin esto re-dar de alta
   * a alguien eliminado le restituía en silencio sus roles viejos —incluido
   * `Administrador`— encima de los que el admin acababa de elegir. Lo elegido en
   * el alta **es** el conjunto de roles, no un agregado.
   */
  private async fijarRolesExactos(
    manager: EntityManager,
    usuarioId: string,
    tenantId: string,
    rolIds: string[],
  ): Promise<void> {
    await manager.query(
      `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
       SELECT $1, $2, r, NOW(), NOW() FROM unnest($3::uuid[]) AS r
       ON CONFLICT (usuario_id, tenant_id, rol_id)
       DO UPDATE SET eliminado_el = NULL, actualizado_el = NOW()`,
      [usuarioId, tenantId, rolIds],
    );
    await manager.query(
      `UPDATE roles_usuarios SET eliminado_el = NOW(), actualizado_el = NOW()
        WHERE usuario_id = $1 AND tenant_id = $2
          AND rol_id <> ALL($3::uuid[]) AND eliminado_el IS NULL`,
      [usuarioId, tenantId, rolIds],
    );
  }

  /**
   * Lo que hay que pintar en la pantalla del link de confirmación: **no lo
   * quema**. Mismo criterio que `AuthService.verificarToken` — quemarlo acá
   * haría que abrir el link dos veces, o un prefetch del navegador, lo
   * inutilizara antes de que la persona decida nada.
   *
   * Público a propósito: quien entra todavía no es miembro de este tenant, así
   * que no hay JWT que lo pruebe. La prueba de identidad es el token del link.
   */
  async verificarConfirmacion(
    token: string,
  ): Promise<{ correo: string; tenant: string }> {
    const { fila, datos } = await this.confirmacionVigente(token);
    return this.cuentaYTenantDelLink(
      this.dataSource.manager,
      fila.usuarioId,
      datos.tenantId,
    );
  }

  /**
   * El correo de la cuenta y el nombre del tenant, en **una** consulta: no hay
   * FK entre las dos tablas, así que el `JOIN` es el producto de dos filas
   * puntuales y existe solo para no hacer dos viajes.
   *
   * Que no devuelva nada significa que la cuenta o el tenant se dieron de baja
   * mientras el mail estaba en la casilla. Los dos casos se cuentan igual: el
   * motivo exacto no es asunto de quien recibió el link.
   */
  private async cuentaYTenantDelLink(
    manager: EntityManager,
    usuarioId: string,
    tenantId: string,
  ): Promise<{ correo: string; tenant: string }> {
    const [row] = await manager.query<{ correo: string; tenant: string }[]>(
      `SELECT u.correo, t.nombre AS tenant
         FROM usuarios u
         JOIN tenants t ON t.tenant_id = $2 AND t.eliminado_el IS NULL
        WHERE u.usuario_id = $1 AND u.eliminado_el IS NULL`,
      [usuarioId, tenantId],
    );
    if (!row) throw new BadRequestException('Ese link ya no sirve');
    return row;
  }

  /**
   * La persona dice que sí: **acá** se crea la membresía y se asignan los roles
   * que el alta congeló en el token. Todo en una transacción.
   *
   * El token se quema **primero**, igual que en `AuthService.elegirContrasena`:
   * `quemar()` corta con un `UPDATE ... WHERE usado_el IS NULL`, así que de dos
   * clics simultáneos sobre el mismo link solo uno sigue.
   *
   * ⚠️ **El `tenantId` NO sale de un JWT, y no es una violación de la regla.**
   * Sale de `tokens_acceso.datos`, que lo escribió el backend al dar el alta y
   * que el cliente no puede tocar: para llegar acá hay que presentar un token de
   * 256 bits cuyo SHA-256 esté en la tabla, y lo único que el cliente aporta es
   * ese token. La regla existe para que el cliente no elija el tenant en el que
   * escribe; acá lo eligió el admin que dio el alta. Mismo modelo que
   * `/auth/invitacion/:token`, que tampoco tiene JWT.
   */
  async confirmarIngreso(token: string): Promise<{ message: string }> {
    const { fila, datos } = await this.confirmacionVigente(token);

    return this.dataSource.transaction(async (manager) => {
      await this.tokensAcceso.quemar(fila.id, manager);

      // Haber abierto este link **prueba la dirección**, igual que aceptar una
      // invitación: es el cuarto camino que sella `correo_verificado_el`. No es
      // redundante — una cuenta auto-registrada que nunca abrió su link de
      // verificación tiene contraseña (por eso cayó en la rama de confirmar) y
      // sigue sin poder entrar. Sin esto, la persona confirmaría que la suman a
      // la empresa y después el login la rechazaría igual.
      // `eliminadoEl: IsNull()` explícito: `EntityManager.update` **no** aplica
      // el filtro de `@DeleteDateColumn` —sólo los `SELECT` lo hacen—, así que
      // sin esto se escribe sobre una cuenta borrada. Hoy la transacción
      // revertiría igual porque `cuentaYTenantDelLink` corta más abajo, pero eso
      // hace depender la corrección del orden de dos sentencias en vez del
      // criterio del `UPDATE`. El gemelo en `auth.service.ts` lo lleva.
      await manager.update(
        Usuario,
        {
          id: fila.usuarioId,
          correoVerificadoEl: IsNull(),
          eliminadoEl: IsNull(),
        },
        { correoVerificadoEl: () => 'NOW()' },
      );

      // La misma consulta que la pantalla, y no solo el nombre del tenant:
      // también prueba que la **cuenta** siga viva. Sin eso, una cuenta dada de
      // baja mientras el mail esperaba entraría igual al tenant, y no la vería
      // nadie —`findMembers` filtra `usuarios.eliminado_el IS NULL`—.
      const { tenant } = await this.cuentaYTenantDelLink(
        manager,
        fila.usuarioId,
        datos.tenantId,
      );

      // Los roles se revalidan contra el tenant: el token vive 7 días y en esa
      // semana el admin pudo borrar alguno. Se entra con los que sobrevivieron.
      const vivos = await manager.query<{ rol_id: string }[]>(
        `SELECT rol_id FROM roles
          WHERE rol_id = ANY($1::uuid[]) AND tenant_id = $2
            AND eliminado_el IS NULL`,
        [datos.rolIds, datos.tenantId],
      );
      // ⚠️ **Vacío de origen no es lo mismo que vacío por revalidación.** El
      // token de `addMember` nace con `rolIds: []` porque esa puerta no asigna
      // roles, y ahí entrar sin rol es exactamente lo pedido. El error de abajo
      // es para el otro caso: había roles y se murieron. `CrearUsuarioTenantDto`
      // tiene `@ArrayMinSize(1)`, así que el alta nunca emite un array vacío y
      // los dos casos no se pueden confundir.
      const sinRolesPorDiseno = datos.rolIds.length === 0;
      // Ninguno sobrevivió: entrar sin rol es entrar y no ver nada, o sea un
      // alta rota. Se corta acá —la transacción revierte el quemado, así que el
      // link sigue sirviendo si el admin recrea los roles— y el admin repite el
      // alta, que es quien puede arreglarlo.
      if (!sinRolesPorDiseno && vivos.length === 0) {
        throw new BadRequestException(
          `Los roles que te asignaron en ${tenant} ya no existen. ` +
            `Pedile al administrador que te dé de alta otra vez.`,
        );
      }

      // Mismo `withDeleted` y mismo reseteo de `esTotem` que el alta: una
      // membresía vieja soft-borrada se revive, no se duplica, y no puede
      // resucitar un tótem que nadie volvió a pedir.
      const miembro = await manager.findOne(UsuarioTenant, {
        where: { usuarioId: fila.usuarioId, tenantId: datos.tenantId },
        withDeleted: true,
      });
      if (miembro && !miembro.eliminadoEl) {
        // Ya entró por otro camino (`POST /tenants/members`) entre el mail y el
        // clic. No hay nada que crear y tampoco corresponde pisarle los roles
        // que tenga hoy con los que se congelaron hace una semana.
        throw new BadRequestException(
          `Ya formás parte de ${tenant}. Entrá con tu cuenta de siempre.`,
        );
      }
      if (miembro) {
        miembro.eliminadoEl = null;
        miembro.esTotem = false;
        await manager.save(UsuarioTenant, miembro);
      } else {
        await manager.save(
          UsuarioTenant,
          manager.create(UsuarioTenant, {
            tenantId: datos.tenantId,
            usuarioId: fila.usuarioId,
          }),
        );
      }

      // ⛔ Con `rolIds: []` NO se llama: `fijarRolesExactos` da de baja los que
      // no vinieron, y `rol_id <> ALL('{}')` es TRUE para todos, así que un
      // array vacío borraría **todos** los roles de esa persona en el tenant.
      // El token de `addMember` nace vacío a propósito y esa puerta nunca tocó
      // `roles_usuarios`; cambiar eso sería una decisión aparte, no un efecto
      // colateral de agregarle la confirmación.
      if (!sinRolesPorDiseno) {
        await this.fijarRolesExactos(
          manager,
          fila.usuarioId,
          datos.tenantId,
          vivos.map((r) => r.rol_id),
        );
      }

      return { message: `Listo: ya formás parte de ${tenant}.` };
    });
  }

  /**
   * El token de confirmación vivo, con sus `datos` ya probados. Lo comparten las
   * dos rutas públicas para que "el link no sirve" se diga igual en las dos.
   *
   * `datos` es nullable en la tabla —los otros dos tipos de token no lo usan—,
   * así que hay que probarlo antes de leerlo: un `confirmacion` sin `datos` es
   * una fila que nadie sabe cómo aplicar.
   */
  private async confirmacionVigente(token: string): Promise<{
    fila: TokenAcceso;
    datos: { tenantId: string; rolIds: string[] };
  }> {
    const fila = await this.tokensAcceso.buscarVigente(
      token,
      TipoTokenAcceso.CONFIRMACION,
    );
    if (!fila || !fila.datos) {
      throw new BadRequestException(
        'Ese link ya no sirve: puede estar vencido o ya usado. Pedí uno nuevo.',
      );
    }
    return { fila, datos: fila.datos };
  }

  /**
   * Marca o desmarca una cuenta como tótem compartido de este tenant.
   *
   * **No se puede marcar una cuenta que tiene un garzón vinculado**: sería la
   * contradicción directa —"esta persona es este garzón" contra "acá no se
   * sabe quién opera"—. `resolverGarzonActuante` ya resuelve el empate a favor
   * del PIN, pero dejar crear la contradicción es dejar que el admin crea que
   * configuró algo que no rige. Desmarcar nunca se bloquea: es la salida.
   */
  async marcarTotem(
    tenantId: string,
    usuarioId: string,
    esTotem: boolean,
  ): Promise<{ usuarioId: string; esTotem: boolean }> {
    const miembro = await this.usuarioTenantRepo.findOne({
      where: { usuarioId, tenantId },
    });
    if (!miembro) {
      throw new NotFoundException('Esa cuenta no es miembro de este tenant');
    }

    if (esTotem) {
      const [vinculado] = await this.dataSource.query<{ nombre: string }[]>(
        `SELECT nombre FROM garzones
          WHERE usuario_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [usuarioId, tenantId],
      );
      if (vinculado) {
        throw new ConflictException(
          `Esa cuenta está vinculada al garzón ${vinculado.nombre}, que opera sin PIN desde ` +
            `su propio dispositivo. Desvinculalo primero desde Garzones.`,
        );
      }
    }

    miembro.esTotem = esTotem;
    await this.usuarioTenantRepo.save(miembro);
    return { usuarioId, esTotem };
  }

  async removeMember(tenantId: string, usuarioId: string): Promise<void> {
    await this.usuarioTenantRepo.softDelete({ tenantId, usuarioId });
  }

  async findModules(tenantId: string): Promise<TenantModulo[]> {
    return this.tenantModuloRepo.find({ where: { tenantId } });
  }

  async updateMine(tenantId: string, dto: UpdateMyTenantDto): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant)
      throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
    Object.assign(tenant, dto);
    try {
      return await this.tenantRepo.save(tenant);
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg.code === '23505') {
        throw new ConflictException('El correo ya está en uso por otro tenant');
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Razones sociales
  // ─────────────────────────────────────────────────────────────────────────

  findRazonesSociales(tenantId: string): Promise<RazonSocial[]> {
    return this.razonSocialRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  createRazonSocial(
    tenantId: string,
    dto: CreateRazonSocialDto,
  ): Promise<RazonSocial> {
    const rs = this.razonSocialRepo.create({ tenantId, ...dto });
    return this.razonSocialRepo.save(rs);
  }

  async updateRazonSocial(
    tenantId: string,
    id: string,
    dto: UpdateRazonSocialDto,
  ): Promise<RazonSocial> {
    const rs = await this.razonSocialRepo.findOne({
      where: { id, tenantId },
    });
    if (!rs) throw new NotFoundException(`Razón social ${id} no encontrada`);
    if (dto.habilitado === false && rs.preferida) {
      throw new BadRequestException(
        'No se puede deshabilitar la razón social preferida',
      );
    }
    Object.assign(rs, dto);
    return this.razonSocialRepo.save(rs);
  }

  async removeRazonSocial(tenantId: string, id: string): Promise<void> {
    const rs = await this.razonSocialRepo.findOne({
      where: { id, tenantId },
    });
    if (!rs) throw new NotFoundException(`Razón social ${id} no encontrada`);
    await this.razonSocialRepo.softDelete({ id, tenantId });
  }

  async setPreferida(tenantId: string, id: string): Promise<RazonSocial> {
    return this.dataSource.transaction(async (manager) => {
      const rs = await manager.findOne(RazonSocial, {
        where: { id, tenantId },
      });
      if (!rs) throw new NotFoundException(`Razón social ${id} no encontrada`);
      if (!rs.habilitado) {
        throw new BadRequestException(
          'No se puede marcar como preferida una razón social deshabilitada',
        );
      }

      await manager.query(
        `UPDATE razones_sociales SET preferida = false WHERE tenant_id = $1 AND eliminado_el IS NULL`,
        [tenantId],
      );
      await manager.query(
        `UPDATE razones_sociales SET preferida = true WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
        [id],
      );

      rs.preferida = true;
      return rs;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Preferencias financieras
  // ─────────────────────────────────────────────────────────────────────────

  async getPreferenciasFinancieras(tenantId: string): Promise<{
    calculoDescuentos: string;
    calculoRecargos: string;
    formula: string[];
    escalaCalculo: number;
    modoRedondeo: string;
    montoTolerancia: string;
  }> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant)
      throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
    const filas = await this.tenantFormulaPrecioRepo.find({
      where: { tenantId },
      order: { paso: 'ASC' },
    });
    return {
      calculoDescuentos: tenant.calculoDescuentos,
      calculoRecargos: tenant.calculoRecargos,
      formula: filas.map((f) => f.tipo),
      escalaCalculo: tenant.escalaCalculo,
      modoRedondeo: tenant.modoRedondeo,
      montoTolerancia: tenant.montoTolerancia,
    };
  }

  async updatePreferenciasFinancieras(
    tenantId: string,
    dto: UpdatePreferenciasFinancierasDto,
  ): Promise<{
    calculoDescuentos: string;
    calculoRecargos: string;
    formula: string[];
    escalaCalculo: number;
    modoRedondeo: string;
    montoTolerancia: string;
  }> {
    // Validate no duplicates (DTO only validates each element is valid, not uniqueness)
    const unique = new Set(dto.formula);
    if (unique.size !== 3) {
      throw new BadRequestException(
        'La fórmula debe contener exactamente los tres tipos sin repetir: descuentos, recargos, impuestos',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE tenants
         SET calculo_descuentos = $1, calculo_recargos = $2,
             escala_calculo = $3, modo_redondeo = $4, monto_tolerancia = $5
         WHERE tenant_id = $6`,
        [
          dto.calculoDescuentos,
          dto.calculoRecargos,
          dto.escalaCalculo,
          dto.modoRedondeo,
          dto.montoTolerancia,
          tenantId,
        ],
      );
      await manager.query(
        `DELETE FROM tenant_formula_precio WHERE tenant_id = $1`,
        [tenantId],
      );
      for (let i = 0; i < dto.formula.length; i++) {
        await manager.query(
          `INSERT INTO tenant_formula_precio (tenant_id, paso, tipo) VALUES ($1, $2, $3)`,
          [tenantId, i + 1, dto.formula[i]],
        );
      }
    });

    // Re-fetch to return current state
    const filas = await this.tenantFormulaPrecioRepo.find({
      where: { tenantId },
      order: { paso: 'ASC' },
    });
    return {
      calculoDescuentos: dto.calculoDescuentos,
      calculoRecargos: dto.calculoRecargos,
      formula: filas.map((f) => f.tipo),
      escalaCalculo: dto.escalaCalculo,
      modoRedondeo: dto.modoRedondeo,
      montoTolerancia: dto.montoTolerancia,
    };
  }
}
