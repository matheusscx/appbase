import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository, type EntityManager } from 'typeorm';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Garzon } from './entities/garzon.entity';
import {
  GarzonPinEvento,
  TipoEventoPin,
} from './entities/garzon-pin-evento.entity';
import { CreateGarzonDto } from './dto/create-garzon.dto';
import { UpdateGarzonDto } from './dto/update-garzon.dto';
import { FijarPinDto } from './dto/fijar-pin.dto';
import { TipoGarzon } from './enums/tipo-garzon.enum';
import {
  EstadoSesionGarzon,
  SesionGarzon,
} from '../turnos/entities/sesion-garzon.entity';

const BCRYPT_COST = 10;
// El PIN se genera automáticamente; estos acotan la generación única.
const MAX_INTENTOS_PIN = 50;
const PIN_MAX_EXCLUSIVO = 1_000_000; // 000000..999999

/**
 * PIN inutilizable. No es un bcrypt válido, así que `bcrypt.compare` contra él
 * devuelve `false` **sin tirar** (medido con bcryptjs 3.0.3): un garzón sin PIN
 * usable cae por el camino normal de "PIN inválido", sin rama especial.
 * Ya lo usaba el placeholder `Mostrador`; ahora también el garzón con cuenta
 * que todavía no fijó el suyo.
 */
export const PIN_INUTILIZABLE = '!';

/**
 * Los PIN que no protegen nada: 6 dígitos repetidos y las escaleras de 6 en el
 * orden natural, para arriba y para abajo. Son 20 en total y son los primeros
 * que prueba cualquiera que quiera hacerse pasar por otro.
 *
 * Se derivan por regla y no por diccionario para que la lista no se desactualice
 * sola. Antes esto no hacía falta: el PIN lo sorteaba el sistema, así que nunca
 * salía `123456`.
 */
function esPinObvio(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  return '0123456789'.includes(pin) || '9876543210'.includes(pin);
}

/** Vista pública de un garzón — nunca incluye el hash del PIN. */
export interface GarzonPublico {
  id: string;
  nombre: string;
  activo: boolean;
  tipo: TipoGarzon;
  /** Cuenta vinculada (modo personal), o `null` si se identifica por PIN. */
  usuarioId: string | null;
  /**
   * Si existe un PIN usable hoy — el mismo booleano que ya expone `GET
   * /mi-pin` (`miPin()`, más abajo), acá para quien administra en vez de
   * para el dueño de la cuenta. No filtra el PIN, solo si hay uno: sin este
   * dato, la ficha del encargado no puede saber si "invalidar" va a destruir
   * algo o no va a tener ningún efecto.
   */
  pinFijado: boolean;
  creadoEl: Date;
  actualizadoEl: Date;
  eliminadoEl?: Date | null;
  // Opcional: el listado sin `incluirEliminados` no hace el JOIN a `usuarios`
  // (N+1 si lo forzáramos ahí).
  eliminadoPorNombre?: string | null;
}

/**
 * Respuesta de una mutación que puede tener un efecto que el admin no
 * anticipa. `advertencias` viene siempre —vacío si no hay nada que decir—,
 * igual que en ventas e items: el que consume no tiene que distinguir entre
 * "sin advertencias" y "el endpoint no las manda".
 *
 * Decisión del owner (2026-08-07, y extendida el 2026-08-14 a vincular una
 * cuenta): estos tres casos **advierten, no bloquean**. Ninguno rompe la
 * operación en el momento —a diferencia de desactivar o eliminar, que sí
 * bloquean— pero los tres tienen una consecuencia que aparece más tarde y en
 * otra pantalla.
 */
export interface GarzonConAdvertencias extends GarzonPublico {
  advertencias: string[];
}

/**
 * Respuesta de creación / regeneración. `pin` viene en claro **una sola vez**
 * cuando el sistema lo emitió, y es `null` cuando no hay PIN que mostrar: el
 * garzón tiene cuenta y lo fija él. No se persiste en claro ni se puede volver
 * a leer.
 */
export interface GarzonConPin extends GarzonConAdvertencias {
  pin: string | null;
}

/**
 * Respuesta específica de `regenerarPin`: suma si HABÍA un PIN usable antes
 * de este PATCH. El resultado de "invalidar" no puede depender de lo que el
 * front creía saber al abrir el modal —un dato que pudo quedar viejo mientras
 * la pantalla estaba abierta sin recargar—, así que lo manda el backend, que
 * lo sabe con certeza en el momento exacto en que pisa el hash.
 */
export interface GarzonPinRegenerado extends GarzonConPin {
  habiaPin: boolean;
}

/** Una línea de historia, lista para mostrar. Nunca incluye el PIN. */
export interface EventoPinPublico {
  id: string;
  tipo: TipoEventoPin;
  /** Quién lo hizo. `null` si la cuenta ya no existe — el hecho igual vale. */
  usuarioNombre: string | null;
  creadoEl: Date;
}

/**
 * Última página del historial de PIN, con **el total** al lado.
 *
 * El total no es decorativo: sin él, topear la lista recorta la historia en
 * silencio, que es justo lo que la decisión del owner (2026-08-15) descartó.
 * La UI muestra *"los últimos N de M"*.
 */
export interface EventosPinPagina {
  eventos: EventoPinPublico[];
  total: number;
}

/**
 * Cuántos eventos de PIN se traen por consulta. 50 es holgado para lo que estas
 * dos pantallas hacen —mirar los últimos cambios— y acota una tabla que solo
 * crece. No se paginó de verdad porque nadie pidió navegar el historial.
 */
const TOPE_EVENTOS_PIN = 50;

@Injectable()
export class GarzonesService {
  constructor(
    @InjectRepository(Garzon)
    private readonly garzonRepo: Repository<Garzon>,
    @InjectRepository(SesionGarzon)
    private readonly sesionRepo: Repository<SesionGarzon>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private toPublico(
    g: Garzon,
    eliminadoPorNombre?: string | null,
  ): GarzonPublico {
    return {
      id: g.id,
      nombre: g.nombre,
      activo: g.activo,
      tipo: g.tipo ?? TipoGarzon.GARZON,
      usuarioId: g.usuarioId ?? null,
      pinFijado: g.pinHash !== PIN_INUTILIZABLE,
      creadoEl: g.creadoEl,
      actualizadoEl: g.actualizadoEl,
      eliminadoEl: g.eliminadoEl,
      ...(eliminadoPorNombre !== undefined ? { eliminadoPorNombre } : {}),
    };
  }

  async listar(
    tenantId: string,
    incluirEliminados = false,
  ): Promise<GarzonPublico[]> {
    if (!incluirEliminados) {
      const garzones = await this.garzonRepo.find({
        where: { tenantId, esPlaceholder: false },
        order: { nombre: 'ASC' },
      });
      return garzones.map((g) => this.toPublico(g));
    }
    // Mismo patrón que categorias.service.ts → findAll: `getMany()` descarta
    // los `addSelect` que no mapean a una columna de la entity, así que hay
    // que usar `getRawAndEntities()` y fusionar a mano. El JOIN a `usuarios`
    // no filtra `eliminado_el` (docs/patterns/backend.md, excepción
    // documentada: el autor de un borrado es un hecho histórico).
    const { entities, raw } = await this.garzonRepo
      .createQueryBuilder('g')
      .leftJoin('usuarios', 'u', 'u.usuario_id = g.eliminado_por')
      .addSelect('u.nombre_usuario', 'g_eliminado_por_nombre')
      .where('g.tenant_id = :tenantId AND g.es_placeholder = false', {
        tenantId,
      })
      // Solo lo que borró una persona: `eliminado_por IS NULL` es un
      // borrado del sistema, no restaurable ni visible — decisión del
      // owner, docs/features/papelera.md.
      .andWhere('(g.eliminado_el IS NULL OR g.eliminado_por IS NOT NULL)')
      .withDeleted()
      .orderBy('g.nombre', 'ASC')
      .getRawAndEntities<{ g_eliminado_por_nombre: string | null }>();

    return entities.map((g, i) =>
      this.toPublico(g, raw[i].g_eliminado_por_nombre),
    );
  }

  async crear(
    tenantId: string,
    usuarioActorId: string,
    dto: CreateGarzonDto,
  ): Promise<GarzonConPin> {
    // Con cuenta el garzón nace SIN PIN usable: lo fija él desde su perfil y el
    // encargado nunca ve uno. No queda bloqueado —en modo personal
    // `resolverGarzonActuante` lo resuelve por JWT—, solo pierde el tótem hasta
    // que fije el suyo.
    //
    // La advertencia de "esa cuenta no puede operar el salón" (misma que
    // `actualizar()`, mismo texto — decisión del owner, 2026-08-14: "toda
    // vinculación", el alta también es una) aplica acá igual: el alta con
    // cuenta produce el mismo estado final que vincular a un garzón vacío
    // recién creado, así que el mismo hueco de permiso existe desde el día
    // uno. Nunca hay sesión abierta en el alta (no puede haberla), así que
    // solo esta advertencia — nunca la de sesión abierta de `actualizar()`.
    let puedeOperarSalon = true;
    if (dto.usuarioId) {
      ({ puedeOperarSalon } = await this.assertVinculable(
        tenantId,
        dto.usuarioId,
      ));
    }
    const pin = dto.usuarioId ? null : await this.generarPinUnico(tenantId);
    const garzon = this.garzonRepo.create({
      tenantId,
      nombre: dto.nombre,
      pinHash: pin ? await bcrypt.hash(pin, BCRYPT_COST) : PIN_INUTILIZABLE,
      activo: dto.activo ?? true,
      tipo: dto.tipo ?? TipoGarzon.GARZON,
      usuarioId: dto.usuarioId ?? null,
    });
    // Sin PIN emitido no hay nada que registrar: la historia de ese garzón
    // empieza el día que él fija el suyo.
    const guardado = await this.guardarConEvento(
      garzon,
      pin ? { tipo: 'emitido_en_alta', usuarioId: usuarioActorId } : null,
    );
    const advertencias: string[] = [];
    if (dto.usuarioId && !puedeOperarSalon) {
      advertencias.push(
        `Esa cuenta todavía no tiene permiso para operar el salón, así que ` +
          `${garzon.nombre} no va a poder entrar en modo personal (sin PIN, desde su ` +
          `propia cuenta) hasta que se lo des. Mientras tanto puede seguir operando desde ` +
          `el tótem, fijando un PIN propio.`,
      );
    }
    return { ...this.toPublico(guardado), pin, advertencias };
  }

  async actualizar(
    tenantId: string,
    usuarioActorId: string,
    id: string,
    dto: UpdateGarzonDto,
  ): Promise<GarzonConAdvertencias> {
    const garzon = await this.getOrThrow(tenantId, id);
    const tipoAnterior = garzon.tipo ?? TipoGarzon.GARZON;
    // Desactivar corta; cambiar el tipo y vincular una cuenta advierten. Las
    // tres preguntan lo mismo, así que la consulta se hace UNA vez: un PATCH
    // del formulario manda el objeto entero, con lo cual las tres
    // condiciones pueden darse en el mismo request.
    const desactiva = dto.activo === false && garzon.activo;
    const cambiaTipo = dto.tipo !== undefined && dto.tipo !== tipoAnterior;
    // La MISMA transición que más abajo invalida el PIN (null → cuenta): se
    // calcula acá, antes de mutar `garzon.usuarioId`, para poder sumarla a
    // esta única consulta en vez de abrir una segunda. Desvincular
    // (`dto.usuarioId === null`) no la dispara — no toca el PIN — ni
    // tampoco un `dto.usuarioId` que no cambia nada real.
    const vinculaCuenta =
      dto.usuarioId !== undefined &&
      dto.usuarioId !== null &&
      garzon.usuarioId === null;
    const sesionesAbiertas =
      desactiva || cambiaTipo || vinculaCuenta
        ? await this.contarSesionesAbiertas(tenantId, id)
        : 0;

    // Mismo chequeo que `eliminar()`, que ya lo tenía: desactivar a alguien con
    // sesión abierta lo deja sin poder cerrarla ni operar —`verificarPin`
    // filtra `activo: true`— y su sesión queda abierta con `fin_el = null` hasta
    // que un admin la fuerce. Mientras tanto el turno tampoco se puede desactivar.
    if (desactiva) {
      this.assertSinSesionAbierta(sesionesAbiertas, 'desactivar');
    }

    // `assertVinculable` corre ACÁ —antes de armar `advertencias`, no donde
    // antes (más abajo, junto con la mutación de `usuarioId`)— porque la
    // advertencia de "no puede operar el salón" necesita `puedeOperarSalon`,
    // que esta consulta ya trae. Pedirla dos veces sería la consulta extra
    // que esto existe para evitar. Corre para toda vinculación (nueva o
    // repetida) tal como corría antes: valida membresía/tótem/no-tomada
    // igual en los dos casos, aunque `puedeOperarSalon` solo se lea cuando
    // `vinculaCuenta` es cierto.
    let puedeOperarSalon = false;
    if (dto.usuarioId !== undefined && dto.usuarioId !== null) {
      ({ puedeOperarSalon } = await this.assertVinculable(
        tenantId,
        dto.usuarioId,
        id,
      ));
    }

    // El cambio de `tipo` advierte en vez de bloquear (decisión del owner,
    // 2026-08-07). No es simétrico con desactivar: desactivar rompe la operación
    // del garzón AHORA, mientras que el tipo no rompe nada en el turno en curso
    // —`sesiones-garzon.service.ts` copia `garzon.tipo` a `sesion_garzon` al
    // abrir, así que el reparto usa el congelado— pero deja al admin sin saber
    // que su cambio no rige hasta el turno siguiente. Bloquear obligaría a
    // cerrar el turno para corregir un tipo mal cargado.
    const advertencias: string[] = [];
    if (cambiaTipo && sesionesAbiertas > 0) {
      // La segunda frase NO es adorno: si la persona genera propinas con los dos
      // tipos dentro de un mismo período, `assertGarzonEnUnSoloGrupo` corta la
      // liquidación entera con un 400 hasta que alguien parta el período. Sin
      // decirlo, el aviso suena inocuo y el admin no se entera de que acaba de
      // programar ese bloqueo.
      advertencias.push(
        `${garzon.nombre} tiene una sesión abierta: el reparto de propinas de ese turno ` +
          `sigue usando el tipo con el que la abrió (${tipoAnterior}), y el cambio a ` +
          `${dto.tipo} rige desde la próxima sesión. Si genera propinas con los dos tipos ` +
          `en un mismo período, la liquidación de ese período no va a poder cerrarse hasta ` +
          `partirlo en dos.`,
      );
    }

    // `assertVinculable` valida membresía viva, no-tótem y no-tomada, pero
    // NO valida `Salones:Operar` (decisión del owner, 2026-08-14): vincular
    // hoy y dar el permiso mañana es un flujo legítimo —alguien contrata a
    // una persona y arma sus permisos después—, así que esto tampoco
    // bloquea.
    //
    // ⚠️ Lo que de verdad pierde es MÁS ANGOSTO que "no puede trabajar"
    // (revisión independiente — medido, no asumido): `PATCH
    // /garzones/mi-pin` (`fijarMiPin`) NO lleva `@RequiresPermiso` —
    // cualquier miembro del tenant fija su propio PIN, con o sin `Salones`—
    // y `resolverGarzonActuante` resuelve por PIN vía `verificarPin`, que
    // nunca mira el `usuario_id` del garzón ni sus permisos: ese chequeo lo
    // hace el `PermisosGuard` sobre la cuenta que LLAMA, y por PIN quien
    // llama es la cuenta del tótem (que sí tiene `Salones:Operar`), no la
    // del garzón. Entonces sin el permiso el garzón SIGUE pudiendo operar
    // por el tótem —fijando su PIN propio, como cualquier garzón con
    // cuenta— y lo único que pierde es el modo personal (sin PIN, desde su
    // propia cuenta): eso sí lo bloquea el `PermisosGuard` en los 6 puntos,
    // porque ahí quien llama es la cuenta del garzón. Aplica a TODA
    // vinculación nueva —no solo con sesión abierta, a diferencia de la
    // advertencia de acá abajo—: es sobre lo que la cuenta puede hacer de
    // acá en más, no sobre un turno en curso.
    if (vinculaCuenta && !puedeOperarSalon) {
      advertencias.push(
        `Esa cuenta todavía no tiene permiso para operar el salón, así que ` +
          `${garzon.nombre} no va a poder entrar en modo personal (sin PIN, desde su ` +
          `propia cuenta) hasta que se lo des. Mientras tanto puede seguir operando desde ` +
          `el tótem, fijando un PIN propio.`,
      );
    }

    // Vincular una cuenta destruye el PIN de alguien que puede estar en
    // turno ahora mismo (decisión del owner, 2026-08-14) — mismo criterio
    // que el cambio de tipo arriba: **advierte, no bloquea**. Es la misma
    // destrucción de PIN que `regenerarPin` ya advierte para su rama "con
    // cuenta", pero el texto NO puede ser el mismo string, y por dos motivos
    // distintos. El primero es la precondición: `regenerarPin` dispara con
    // `garzon.usuarioId !== null` —la cuenta ya está—, y acá
    // `vinculaCuenta` EXIGE `garzon.usuarioId === null` (más arriba). El
    // segundo es el DATO disponible: solo este camino tiene
    // `puedeOperarSalon` (lo dejó `assertVinculable`, que no corre en
    // `regenerarPin`), y por eso solo este puede partirse en dos ramas y
    // prometer el modo personal en la que corresponde. Ver el docblock de
    // `regenerarPin`: allá el aviso se queda con lo cierto siempre (el
    // tótem) justamente porque no tiene este dato. En el
    // caso normal, la sesión abierta que dispara este aviso solo pudo
    // abrirse tecleando el PIN —sin cuenta, `resolverGarzonActuante` exige
    // `garzonId` + PIN—, y ese PIN muere unas líneas más abajo. (Borde
    // angosto donde no es así: vinculado (abre sesión por cuenta, sin PIN)
    // → desvinculado (la sesión sigue abierta; el PIN sigue muerto —
    // desvincular no lo restaura) → RE-vinculado; `vinculaCuenta` vuelve a
    // ser cierto porque `garzon.usuarioId` volvió a `null` al desvincular,
    // aunque la sesión abierta que cuenta `sesionesAbiertas` sea la vieja,
    // abierta por JWT y no por PIN. ⚠️ Y el PIN en ese instante NO tiene por
    // qué seguir muerto: si entre el desvincular y el re-vincular alguien
    // llamó `regenerarPin` —que sobre un garzón desvinculado SÍ emite uno
    // nuevo, `tieneCuenta` da `false`—, hay un PIN VIVO en danza. El texto
    // no depende de esa historia: la línea de más abajo
    // (`garzon.pinHash = PIN_INUTILIZABLE`) corre sin condicionar en si ya
    // estaba muerto, así que "deja de servir ahora mismo" describe lo que
    // este PATCH hace —mate un PIN vivo o pise uno que ya estaba muerto—,
    // no una historia sobre el pasado.) En el caso normal, en el instante
    // del aviso la persona TODAVÍA NO opera desde su cuenta: recién la
    // consigue con este mismo PATCH. El texto habla de la capacidad que se
    // abre a partir de ahora —mismo marco que `crear()` con cuenta
    // (arriba)—, nunca de una continuidad que no existió. (El plan de la
    // feature proponía acá "puede seguir trabajando desde su dispositivo",
    // sin condicionar en el permiso; esa redacción quedó descartada en la
    // revisión final del 2026-08-15 y no hay que volver a ella: el plan es
    // un documento histórico, no la fuente de verdad de este texto.)
    //
    // Si la cuenta no tiene `Salones:Operar` (arriba), no puede prometer
    // "puede seguir trabajando desde la cuenta": el modo personal queda
    // cerrado hasta que le den el permiso. Pero SÍ puede seguir por el
    // tótem, fijando un PIN propio (mismo alcance que la advertencia de
    // arriba, medido igual: `fijarMiPin` no exige permiso y `verificarPin`
    // no mira `usuario_id`) — las dos advertencias conviven sin
    // contradecirse porque ninguna promete de más.
    if (vinculaCuenta && sesionesAbiertas > 0) {
      advertencias.push(
        puedeOperarSalon
          ? `${garzon.nombre} tiene una sesión abierta: el PIN con el que la abrió deja de ` +
              `servir ahora mismo, pero no queda bloqueado — puede seguir trabajando desde la ` +
              `cuenta recién vinculada. Lo único que pierde hasta que fije un PIN nuevo desde ` +
              `su perfil es el tótem compartido.`
          : `${garzon.nombre} tiene una sesión abierta: el PIN con el que la abrió deja de ` +
              `servir ahora mismo, y la cuenta recién vinculada todavía no tiene permiso para ` +
              `operar el salón — no va a poder entrar en modo personal hasta que se lo des, ` +
              `pero puede seguir operando desde el tótem si fija un PIN propio nuevo.`,
      );
    }

    if (dto.nombre !== undefined) garzon.nombre = dto.nombre;
    if (dto.activo !== undefined) garzon.activo = dto.activo;
    if (dto.tipo !== undefined) garzon.tipo = dto.tipo;
    // El PIN emitido por el encargado muere en el instante en que el garzón
    // recibe una cuenta: desde acá la identidad la prueba el JWT, y el PIN que
    // el encargado conoce no puede seguir valiendo. Solo la transición
    // null → cuenta (`vinculaCuenta`, calculada arriba antes de que nada
    // mutara `garzon.usuarioId`); desvincular NO toca el PIN (el garzón
    // sigue operando con el que eligió, que el encargado no conoce).
    // `assertVinculable` ya corrió arriba —antes de armar `advertencias`—,
    // así que acá solo queda aplicar sus efectos.
    let eventoPin: { tipo: TipoEventoPin; usuarioId: string } | null = null;
    if (dto.usuarioId !== undefined) {
      if (vinculaCuenta) {
        garzon.pinHash = PIN_INUTILIZABLE;
        eventoPin = {
          tipo: 'invalidado_por_vinculo',
          usuarioId: usuarioActorId,
        };
      }
      garzon.usuarioId = dto.usuarioId;
    }
    return {
      ...this.toPublico(await this.guardarConEvento(garzon, eventoPin)),
      advertencias,
    };
  }

  /**
   * Las **tres** condiciones para vincular una cuenta a un garzón, en una
   * consulta — y de paso, el dato que decide la advertencia de "esa cuenta
   * no puede operar el salón" (`actualizar()`, más abajo): agregarlo ACÁ,
   * a esta misma consulta, evita una segunda ida a la base solo para leer
   * un permiso — este método ya trae la fila de `usuarios_tenants` que ese
   * chequeo necesita.
   *
   * **Miembro vivo del tenant**: vincular una cuenta ajena no daría acceso
   * —igual necesita token de este tenant para operar— pero dejaría el vínculo
   * como basura silenciosa que nadie puede ejercer.
   *
   * **No marcada como tótem**: es la contradicción directa. El tótem existe
   * porque en un dispositivo compartido la identidad no se puede presumir; si
   * además tuviera un garzón vinculado, la configuración estaría diciendo dos
   * cosas opuestas. `resolverGarzonActuante` ya resuelve el empate a favor del
   * PIN, pero dejar crear la contradicción es dejar que el admin crea que
   * configuró algo que no rige.
   *
   * **No vinculada ya a otro garzón**: lo garantiza `uq_garzones_usuario_tenant`,
   * pero **la unique sola devuelve un 500**. Y es un camino que el selector
   * ofrece: filtra los tótem, no los ya vinculados. El admin elegía una cuenta
   * de la lista y comía un error genérico, mientras los otros dos casos
   * inválidos sí le decían qué hacer. Mismo bug que cerró `f3f65c1c` con el
   * 23505 de las opciones de modificadores.
   *
   * `puedeOperarSalon` (en el resultado, cuando no tira): NO es una cuarta
   * condición que bloquee — vincular hoy y dar el permiso mañana es un flujo
   * legítimo (decisión del owner, 2026-08-14) — es solo el dato para que
   * quien llama decida si advierte. La subquery replica el criterio de
   * `RbacService.userHasPermiso` (rol `es_fijo` = acceso total, si no, el
   * JOIN completo de rol → módulo del tenant → permiso) para `Salones:Operar`
   * puntual: duplicarla acá, en vez de inyectar `RbacService` y pagar su
   * propia consulta aparte, es lo que permite que siga siendo UNA sola query.
   *
   * ⚠️ **Al ser una copia, se desincroniza sola.** Ya pasó: cuando `RbacService`
   * ató el tenant en sus JOIN (`r.tenant_id = ru.tenant_id`,
   * `tm.tenant_id = ru.tenant_id`), esta copia quedó atrás y hubo que traerla a
   * mano. Si se toca el criterio allá, se toca acá.
   */
  private async assertVinculable(
    tenantId: string,
    usuarioId: string,
    garzonId?: string,
  ): Promise<{ puedeOperarSalon: boolean }> {
    const [fila] = await this.garzonRepo.manager.query<
      {
        es_totem: boolean;
        garzon_nombre: string | null;
        puede_operar_salon: boolean;
      }[]
    >(
      `SELECT ut.es_totem,
              g.nombre AS garzon_nombre,
              (
                EXISTS (
                  SELECT 1
                    FROM roles_usuarios ru
                    JOIN roles r ON r.rol_id = ru.rol_id AND r.tenant_id = ru.tenant_id
                   WHERE ru.usuario_id = ut.usuario_id
                     AND ru.tenant_id = ut.tenant_id
                     AND r.es_fijo = true
                     AND ru.eliminado_el IS NULL
                     AND r.eliminado_el IS NULL
                )
                OR EXISTS (
                  SELECT 1
                    FROM roles_usuarios ru
                    JOIN roles r ON r.rol_id = ru.rol_id AND r.tenant_id = ru.tenant_id AND r.eliminado_el IS NULL
                    JOIN modulos_roles mr ON mr.rol_id = r.rol_id AND mr.eliminado_el IS NULL
                    JOIN tenant_modulos tm ON tm.modulo_tenant_id = mr.modulo_tenant_id AND tm.tenant_id = ru.tenant_id AND tm.eliminado_el IS NULL
                    JOIN modulos_app ma ON ma.modulo_app_id = tm.modulo_app_id AND ma.eliminado_el IS NULL
                    JOIN roles_permisos_modulos rpm ON rpm.rol_id = r.rol_id AND rpm.modulo_tenant_id = tm.modulo_tenant_id
                    JOIN modulo_app_permisos map ON map.modulo_app_permiso_id = rpm.modulo_app_permiso_id AND map.eliminado_el IS NULL
                    JOIN permisos p ON p.permiso_id = map.permiso_id AND p.eliminado_el IS NULL
                   WHERE ru.usuario_id = ut.usuario_id
                     AND ru.tenant_id = ut.tenant_id
                     AND ma.nombre = 'Salones'
                     AND p.nombre = 'Operar'
                     AND ru.eliminado_el IS NULL
                )
              ) AS puede_operar_salon
         FROM usuarios_tenants ut
         LEFT JOIN garzones g
           ON g.usuario_id = ut.usuario_id
          AND g.tenant_id = ut.tenant_id
          AND ($3::uuid IS NULL OR g.garzon_id <> $3)
          AND g.eliminado_el IS NULL
        WHERE ut.usuario_id = $1 AND ut.tenant_id = $2
          AND ut.eliminado_el IS NULL`,
      [usuarioId, tenantId, garzonId ?? null],
    );
    if (!fila) {
      throw new BadRequestException(
        'Esa cuenta no es miembro de este tenant. Sumala desde Configuración → Usuarios.',
      );
    }
    if (fila.es_totem) {
      throw new BadRequestException(
        'Esa cuenta está marcada como tótem compartido: en un tótem siempre se pide PIN, ' +
          'así que vincularla no tendría efecto. Desmarcala primero.',
      );
    }
    if (fila.garzon_nombre) {
      throw new ConflictException(
        `Esa cuenta ya está vinculada al garzón ${fila.garzon_nombre}. ` +
          `Desvinculala de ${fila.garzon_nombre} antes de asignarla acá.`,
      );
    }
    return { puedeOperarSalon: fila.puede_operar_salon };
  }

  /**
   * Guarda el garzón y —si hubo cambio de PIN— su fila de historia **en la
   * misma transacción**. Un log que puede quedar desincronizado del hecho que
   * registra no sirve como registro.
   *
   * Sin evento, `save()` plano: `actualizar()` pasa por acá en **cada**
   * llamada, evento o no, y abrir un BEGIN/COMMIT para el caso normal (sin
   * cambio de PIN) es carga de conexión sobre una ruta caliente que no la
   * necesita — "conexiones/deadlock" es el primer frente 🔴 del backlog del
   * repo, no hay que sumarle peso porque sí. Sin evento no hay dos escrituras
   * que sincronizar, así que la atomicidad no pierde nada.
   */
  private async guardarConEvento(
    garzon: Garzon,
    evento: { tipo: TipoEventoPin; usuarioId: string } | null,
  ): Promise<Garzon> {
    if (!evento) {
      return this.garzonRepo.save(garzon);
    }
    return this.dataSource.transaction(async (m) => {
      const guardado = await m.save(Garzon, garzon);
      await m.save(
        GarzonPinEvento,
        m.create(GarzonPinEvento, {
          tenantId: guardado.tenantId,
          garzonId: guardado.id,
          tipo: evento.tipo,
          usuarioId: evento.usuarioId,
        }),
      );
      return guardado;
    });
  }

  /**
   * El PIN del garzón, según quién puede probarlo.
   *
   * **Con cuenta → invalida y no muestra nada.** El garzón fija el suyo desde
   * su perfil; devolverle un PIN legible al encargado sería volver al problema
   * que esta feature existe para resolver.
   * **Sin cuenta → genera y revela**, como siempre: sin cuenta no hay forma de
   * que la persona elija un secreto que el encargado no vea, y eso es una
   * elección del local, no un bug.
   *
   * Una sola ruta para los dos casos y no dos: manda el estado del garzón, así
   * que el encargado no puede elegir mal.
   *
   * Con sesión abierta **advierte, no bloquea** (decisión del owner,
   * 2026-08-07): rotar una credencial es la respuesta correcta a una
   * filtración.
   *
   * ⚠️ El aviso de la rama "con cuenta" **no promete el dispositivo propio**
   * (revisión final, 2026-08-15). Que la persona "siga trabajando normal"
   * desde su cuenta es cierto **solo si esa cuenta tiene `Salones:Operar`**:
   * sin ese permiso el `PermisosGuard` le cierra los 6 puntos del modo
   * personal, y el aviso estaría mintiéndole al encargado. Acá —a diferencia
   * de `actualizar()`, que ya tiene `puedeOperarSalon` en la mano porque
   * `assertVinculable` corrió recién— ese dato costaría una consulta más
   * sobre una ruta que ya hace dos, y no compraría nada nuevo: la
   * advertencia de "esa cuenta todavía no tiene permiso para operar el
   * salón" ya la emiten **los dos** caminos por los que un garzón llega a
   * tener cuenta (`crear()` con `usuarioId` y `actualizar()` al vincular),
   * así que el encargado ya se enteró. Lo que faltaba era que este aviso no
   * dijera lo contrario. Por eso se queda con lo que es cierto **siempre**:
   * lo que se pierde es el tótem compartido, y vuelve cuando el garzón fija
   * su PIN. Mismo criterio y misma redacción base que la ficha
   * (`configuracion/garzones.vue`, `regenerarMensaje`) y el perfil
   * (`MiPinForm.vue`), que tampoco tienen el permiso a mano.
   */
  async regenerarPin(
    tenantId: string,
    usuarioActorId: string,
    id: string,
  ): Promise<GarzonPinRegenerado> {
    const garzon = await this.getOrThrow(tenantId, id);
    const tieneCuenta = garzon.usuarioId !== null;
    // Tiene que leerse ANTES de que este método pise `garzon.pinHash` más
    // abajo — es la única oportunidad de saberlo. Mismo predicado que
    // `toPublico()` usa para `pinFijado`.
    const habiaPin = garzon.pinHash !== PIN_INUTILIZABLE;
    const advertencias: string[] = [];
    if ((await this.contarSesionesAbiertas(tenantId, id)) > 0) {
      advertencias.push(
        tieneCuenta
          ? // "le queda cerrado" y no "pierde": esta rama también dispara
            // sobre un garzón con cuenta que TODAVÍA no había fijado su PIN
            // (`habiaPin === false`) y abrió el turno por JWT, en modo
            // personal. A ese no se le quita nada — decir "pierde" daría por
            // existente un acceso que nunca tuvo.
            `${garzon.nombre} está en turno: el tótem compartido le queda cerrado hasta ` +
              `que fije un PIN desde su perfil.`
          : `${garzon.nombre} está en turno: el PIN anterior deja de funcionar ya mismo, ` +
              `así que no va a poder operar ni marcar salida hasta que reciba el nuevo.`,
      );
    }

    const pin = tieneCuenta ? null : await this.generarPinUnico(tenantId, id);
    garzon.pinHash = pin
      ? await bcrypt.hash(pin, BCRYPT_COST)
      : PIN_INUTILIZABLE;
    const guardado = await this.guardarConEvento(garzon, {
      tipo: tieneCuenta
        ? 'invalidado_por_encargado'
        : 'regenerado_por_encargado',
      usuarioId: usuarioActorId,
    });
    return { ...this.toPublico(guardado), pin, advertencias, habiaPin };
  }

  /**
   * La historia de PIN de un garzón, más nueva primero.
   *
   * Confirma que el garzón existe en el tenant antes de traer su historia —
   * necesario acá porque `garzonId` llega de la URL (`GET
   * /garzones/:id/pin-eventos`) y todavía no se validó. `miPin()` ya validó
   * lo mismo (`miGarzonOrThrow`) antes de llamar, así que ese camino usa
   * `eventosPinDe` directo y se ahorra la re-confirmación.
   *
   * Una sola consulta con `JOIN` a `usuarios`: resolver el nombre del actor
   * fila por fila sería un N+1 exacto. El `JOIN` **no** filtra `eliminado_el`
   * de `usuarios` — misma excepción documentada que el autor de un borrado en
   * `listar()`: quién hizo algo es un hecho histórico y no desaparece porque
   * la cuenta se dé de baja.
   */
  async listarEventosPin(
    tenantId: string,
    garzonId: string,
  ): Promise<EventosPinPagina> {
    await this.getOrThrow(tenantId, garzonId);
    return this.eventosPinDe(tenantId, garzonId);
  }

  /**
   * La consulta pelada de `listarEventosPin`, sin la confirmación de
   * existencia — para cuando quien llama ya tiene el garzón en memoria
   * (`miPin()`) y esa confirmación sería una cuarta consulta redundante
   * sobre la misma fila que `miGarzonOrThrow` ya resolvió.
   */
  /**
   * Últimos `TOPE_EVENTOS_PIN` eventos **y el total**, no la tabla entera.
   *
   * `garzon_pin_evento` solo crece: el diseño decidió guardar todos los cambios
   * de PIN, no solo el último. Sin tope, con años de regeneraciones para un
   * garzón activo la consulta y el payload crecían sin techo, y las dos
   * pantallas que la consumen los traían enteros en cada carga.
   *
   * **Se devuelve el total además de la página** (decisión del owner,
   * 2026-08-15). Topear sin el total era lo barato, pero **recorta la historia
   * sin decirlo**: la pantalla muestra menos eventos y nada avisa que existen
   * más.
   */
  private async eventosPinDe(
    tenantId: string,
    garzonId: string,
  ): Promise<EventosPinPagina> {
    const [eventos, filas] = await Promise.all([
      this.garzonRepo.manager.query<EventoPinPublico[]>(
        `SELECT e.garzon_pin_evento_id AS id,
                e.tipo,
                u.nombre_usuario AS "usuarioNombre",
                e.creado_el AS "creadoEl"
           FROM garzon_pin_evento e
           LEFT JOIN usuarios u ON u.usuario_id = e.usuario_id
          WHERE e.tenant_id = $1
            AND e.garzon_id = $2
            AND e.eliminado_el IS NULL
          ORDER BY e.creado_el DESC
          LIMIT $3`,
        [tenantId, garzonId, TOPE_EVENTOS_PIN],
      ),
      this.garzonRepo.manager.query<{ total: number }[]>(
        `SELECT COUNT(*)::int AS total
           FROM garzon_pin_evento e
          WHERE e.tenant_id = $1
            AND e.garzon_id = $2
            AND e.eliminado_el IS NULL`,
        [tenantId, garzonId],
      ),
    ]);
    return { eventos, total: Number(filas[0]?.total ?? 0) };
  }

  /**
   * El garzón elige su propio PIN. El encargado nunca lo ve — ese es el punto
   * entero de la feature.
   *
   * **No se valida unicidad contra otros garzones**, a diferencia del PIN que
   * genera el sistema. Siempre se elige a la persona antes de teclear
   * (`verificarPin` recibe `garzonId`), así que dos PIN iguales no crean
   * ambigüedad; y rechazar la colisión convertiría este formulario en un
   * oráculo: probando PIN, un garzón descubriría el de otro.
   *
   * Resuelve por `garzonPersonalDe`, que es la definición canónica de "esta
   * cuenta es este garzón" — incluye el override duro de `es_totem`. Una cuenta
   * de tótem no puede tener garzón, así que acá da 404, que es lo correcto.
   */
  async fijarMiPin(
    tenantId: string,
    usuarioId: string,
    dto: FijarPinDto,
  ): Promise<void> {
    if (dto.pin !== dto.confirmarPin) {
      throw new BadRequestException('Los PIN no coinciden');
    }
    if (esPinObvio(dto.pin)) {
      throw new BadRequestException(
        'Ese PIN es demasiado previsible. Elegí uno que no sea todo el mismo ' +
          'dígito ni una secuencia.',
      );
    }
    const garzon = await this.miGarzonOrThrow(tenantId, usuarioId);
    garzon.pinHash = await bcrypt.hash(dto.pin, BCRYPT_COST);
    await this.guardarConEvento(garzon, {
      tipo: 'fijado_por_garzon',
      usuarioId,
    });
  }

  /** Su propio estado e historia, para el bloque "Mi PIN" del perfil. */
  async miPin(
    tenantId: string,
    usuarioId: string,
  ): Promise<{ fijado: boolean } & EventosPinPagina> {
    const garzon = await this.miGarzonOrThrow(tenantId, usuarioId);
    return {
      fijado: garzon.pinHash !== PIN_INUTILIZABLE,
      // `eventosPinDe`, no `listarEventosPin`: `miGarzonOrThrow` ya confirmó
      // que este garzón existe en el tenant — reconfirmarlo acá sería la
      // cuarta consulta redundante que este método existe para evitar.
      ...(await this.eventosPinDe(tenantId, garzon.id)),
    };
  }

  /** El garzón que es esta cuenta en este tenant, o 404. */
  private async miGarzonOrThrow(
    tenantId: string,
    usuarioId: string,
  ): Promise<Garzon> {
    const garzonId = await this.garzonPersonalDe(tenantId, usuarioId);
    if (!garzonId) {
      throw new NotFoundException('Tu cuenta no es un garzón en este local');
    }
    return this.garzonRepo.findOneOrFail({ where: { id: garzonId, tenantId } });
  }

  async eliminar(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    await this.getOrThrow(tenantId, id);
    this.assertSinSesionAbierta(
      await this.contarSesionesAbiertas(tenantId, id),
      'eliminar',
    );
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.garzonRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<GarzonPublico> {
    // Una sola regla para los tres casos —no existe, existe y está viva, o
    // la borró el sistema (`eliminadoPor` nulo)—: la papelera solo restaura
    // lo que borró una persona (decisión del owner, docs/features/papelera.md).
    const garzon = await this.garzonRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!garzon || !garzon.eliminadoEl || !garzon.eliminadoPor) {
      throw new NotFoundException(`Garzón ${id} no está en la papelera`);
    }
    try {
      // `restore()` solo limpia la `@DeleteDateColumn`; el `eliminado_por`
      // viejo sobreviviría y disfrazaría un borrado del sistema posterior
      // como borrado de persona (ver categorias.service.ts → restaurar()).
      await this.garzonRepo.update(
        { id, tenantId },
        { eliminadoEl: null, eliminadoPor: null },
      );
    } catch (e) {
      // 23505 = unique_violation. `garzones` tiene **dos** índices únicos
      // parciales sobre `eliminado_el IS NULL`, así que restaurar puede chocar
      // por dos motivos distintos y hay que mirar CUÁL:
      //
      // - `uq_garzones_mostrador_tenant`: un solo "Mostrador" vivo por tenant.
      //   Pasa si `asegurarMostrador()` creó uno nuevo (find-or-create
      //   disparado por otra venta) mientras el viejo estaba en la papelera.
      // - `uq_garzones_usuario_tenant`: una cuenta = un garzón vivo. El
      //   `usuario_id` **sobrevive al soft delete**, así que si alguien vinculó
      //   esa cuenta a otro garzón mientras este estaba borrado, revivirlo
      //   colisiona.
      //
      // ⚠️ Antes había un solo índice y el mensaje era específico al
      // placeholder por eso. Con dos, un mensaje fijo le dice al admin que el
      // problema es "Mostrador" cuando en realidad tiene que desvincular una
      // cuenta de otro garzón — una explicación falsa que apunta a otra regla
      // y a otro garzón. Mismo patrón que causas-merma.service.ts → restaurar().
      const err = e as { code?: string; constraint?: string };
      if (err.code === '23505') {
        if (err.constraint === 'uq_garzones_usuario_tenant') {
          throw new ConflictException(
            `No se puede restaurar a ${garzon.nombre}: la cuenta que tenía vinculada ya la usa otro garzón. ` +
              `Desvinculala de ese garzón y volvé a intentar.`,
          );
        }
        throw new BadRequestException(
          'Ya existe un garzón "Mostrador" activo para este tenant (se crea automáticamente, uno por tenant). No se puede restaurar el placeholder anterior mientras el nuevo siga vivo.',
        );
      }
      throw e;
    }
    const restaurado = await this.garzonRepo.findOneOrFail({
      where: { id, tenantId },
    });
    return this.toPublico(restaurado);
  }

  /**
   * Verifica el PIN del garzón que la pantalla ya eligió. **Una** fila y **un**
   * `bcrypt.compare`.
   *
   * Reemplazó a `resolverGarzonPorPin(tenantId, pin)`, que traía todos los
   * garzones activos y comparaba uno por uno porque el hash está salteado y no
   * se puede buscar por índice. Medido antes del cambio: bcryptjs a coste 10
   * tarda 62,5 ms por comparación, así que 20 garzones eran 1,3 s de CPU **por
   * intento**; con 5 intentos concurrentes, 6,3 s y hasta 309 ms de lag del
   * event loop — que en un solo proceso Node lo pagan todos los tenants, y
   * cualquiera con `Salones:Operar` podía provocarlo.
   *
   * Es un `BadRequestException` (no 401) a propósito: un PIN incorrecto es un
   * error operativo del garzón, no un fallo de autenticación de la sesión del
   * dispositivo. Un 401 haría que el interceptor de `useApiFetch` intente
   * refrescar el token y cierre la sesión del restaurante.
   *
   * El mensaje **no distingue** garzón inexistente de PIN incorrecto: son el
   * mismo 400. Nombrar al garzón no filtraría nada —su nombre ya está en la
   * pantalla, porque el usuario lo eligió de la lista— pero sí distinguiría
   * "ese garzón no existe" de "ese PIN no es", que es información que no hace
   * falta dar.
   */
  async verificarPin(
    tenantId: string,
    garzonId: string,
    pin: string,
  ): Promise<Garzon> {
    const garzon = await this.garzonRepo.findOne({
      where: { id: garzonId, tenantId, activo: true },
    });
    if (!garzon || !(await bcrypt.compare(pin, garzon.pinHash))) {
      throw new BadRequestException('PIN inválido');
    }
    return garzon;
  }

  /**
   * El garzón que esta cuenta "es" en este tenant, o `null` si opera por PIN.
   * Devuelve `null` cuando la cuenta está marcada tótem **aunque tenga vínculo**:
   * ese es el override duro.
   *
   * Una sola consulta —el `LEFT JOIN` trae el marcador y el garzón juntos—
   * porque corre en el camino caliente de abrir y cerrar cuenta, ~60 veces por
   * turno de 30 mesas. Y **una sola definición**: la usan el resolver y el
   * endpoint que le dice al front en qué modo está, que si divergieran darían
   * una pantalla que no pide PIN contra un backend que lo exige.
   */
  private async garzonPersonalDe(
    tenantId: string,
    usuarioId: string,
  ): Promise<string | null> {
    const [fila] = await this.garzonRepo.manager.query<
      { es_totem: boolean; garzon_id: string | null }[]
    >(
      `SELECT ut.es_totem,
              g.garzon_id
         FROM usuarios_tenants ut
         LEFT JOIN garzones g
           ON g.usuario_id = ut.usuario_id
          AND g.tenant_id = ut.tenant_id
          AND g.activo = true
          AND g.eliminado_el IS NULL
        WHERE ut.usuario_id = $1 AND ut.tenant_id = $2
          AND ut.eliminado_el IS NULL`,
      [usuarioId, tenantId],
    );
    if (!fila || fila.es_totem) return null;
    return fila.garzon_id;
  }

  /**
   * En qué modo está el dispositivo, para que la pantalla del salón sepa si
   * tiene que pedir PIN. Devuelve el garzón vinculado o `null`.
   *
   * ⚠️ Es una **conveniencia de UI, no un control**: quien resuelve de verdad
   * es `resolverGarzonActuante` en cada acción. Un cliente que mienta acá no
   * consigue nada.
   */
  async miVinculo(
    tenantId: string,
    usuarioId: string,
  ): Promise<{ garzonId: string; nombre: string } | null> {
    const garzonId = await this.garzonPersonalDe(tenantId, usuarioId);
    if (!garzonId) return null;
    const garzon = await this.garzonRepo.findOneOrFail({
      where: { id: garzonId, tenantId },
    });
    return { garzonId: garzon.id, nombre: garzon.nombre };
  }

  /**
   * Quién está actuando, para los **6** puntos que antes llamaban `verificarPin`
   * directo (abrir cuenta, cerrar cuenta, traspaso, e iniciar/cerrar/consultar
   * sesión). Tres ramas:
   *
   * 1. La cuenta está marcada `es_totem` → **siempre** PIN. Es un override
   *    duro: aunque alguien le vincule un garzón por error, no se vuelve
   *    personal. Un tótem es un dispositivo compartido y desatendido; presumir
   *    del JWT quién lo está usando es exactamente lo que no se puede hacer.
   * 2. Hay un garzón vivo y activo vinculado a esa cuenta → **ese es**, sin PIN
   *    y sin bcrypt. Su tablet es suya y el JWT ya probó quién es; pedirle el
   *    PIN es re-probar lo ya probado.
   * 3. Ninguna de las dos → PIN, como siempre.
   *
   * ⚠️ **La rama 3 es la que sostiene el PIN de todo el sistema.** `garzonId` y
   * `pin` son opcionales en el DTO —tienen que serlo, porque en modo personal
   * no se mandan—, así que sin este corte alguien los omite y opera como
   * cualquiera en los 6 lugares donde hoy se pide PIN. No es una validación de
   * forma: es el control de acceso.
   */
  async resolverGarzonActuante(
    tenantId: string,
    usuarioId: string,
    credencial: { garzonId?: string; pin?: string },
  ): Promise<Garzon> {
    const garzonId = await this.garzonPersonalDe(tenantId, usuarioId);

    if (garzonId) {
      // Modo personal. El PIN que venga en el body se ignora: la identidad ya
      // está probada por el JWT y no hay nada que agregar mandando un PIN
      // ajeno.
      return this.garzonRepo.findOneOrFail({
        where: { id: garzonId, tenantId },
      });
    }

    if (!credencial.garzonId || !credencial.pin) {
      throw new BadRequestException(
        'Elegí el garzón e ingresá su PIN para continuar',
      );
    }
    return this.verificarPin(tenantId, credencial.garzonId, credencial.pin);
  }

  /**
   * La lista que alimenta el selector previo al teclado de PIN. Devuelve **solo
   * id y nombre**: nada de PIN, `activo`, tipo ni fechas — es la única lectura
   * de garzones que ve alguien con `Salones:Operar` y sin `Salones:Leer`.
   *
   * Las dos variantes son **complementarias y excluyentes**, y esa partición es
   * la que hace que la lista codifique la regla en vez de dejarla para un 400:
   * - `enTurno: false` → **entrar a turno**. Un garzón con sesión abierta no
   *   puede abrir otra (`El garzón ya tiene una sesión abierta`), así que
   *   ofrecerlo sería ofrecer un error.
   * - `enTurno: true` → **todo lo demás** (salir de turno, abrir, cobrar, tomar
   *   y transferir cuenta), que exigen sesión abierta río abajo.
   *
   * El placeholder `Mostrador` queda fuera: no es una persona y no tiene PIN
   * usable (`pinHash = '!'`).
   *
   * Una sola query con `EXISTS`, no una por garzón: N es la cantidad de
   * garzones del tenant y esto se llama en cada apertura y cada cobro.
   */
  async listarParaSelector(
    tenantId: string,
    enTurno: boolean,
  ): Promise<{ garzonId: string; nombre: string }[]> {
    const rows = await this.garzonRepo
      .createQueryBuilder('g')
      .select('g.garzon_id', 'garzon_id')
      .addSelect('g.nombre', 'nombre')
      .where('g.tenant_id = :tenantId', { tenantId })
      .andWhere('g.activo = true')
      .andWhere('g.es_placeholder = false')
      .andWhere('g.eliminado_el IS NULL')
      .andWhere(
        `${enTurno ? 'EXISTS' : 'NOT EXISTS'} (
           SELECT 1 FROM sesiones_garzon s
            WHERE s.garzon_id = g.garzon_id
              AND s.tenant_id = g.tenant_id
              AND s.estado = :abierta
              AND s.eliminado_el IS NULL
         )`,
        { abierta: EstadoSesionGarzon.ABIERTA },
      )
      .orderBy('g.nombre', 'ASC')
      .getRawMany<{ garzon_id: string; nombre: string }>();

    return rows.map((r) => ({ garzonId: r.garzon_id, nombre: r.nombre }));
  }

  async obtenerActivoPorId(tenantId: string, id: string): Promise<Garzon> {
    const garzon = await this.garzonRepo.findOne({
      where: { id, tenantId, activo: true },
    });
    if (!garzon || !garzon.activo) {
      throw new BadRequestException('Garzón no encontrado o inactivo');
    }
    return garzon;
  }

  /**
   * Resuelve el garzón placeholder "Mostrador" del tenant — receptor neutro de
   * la propina del POS. Idempotente: si no existe lo crea con `activo=false`,
   * `esPlaceholder=true` y un `pin_hash` inutilizable, para que nunca opere ni
   * se identifique por PIN. Se ejecuta dentro del `manager` de la transacción
   * de la venta. Ver docs/features/pagos.md.
   */
  async asegurarMostrador(
    manager: EntityManager,
    tenantId: string,
  ): Promise<Garzon> {
    const existente = await manager.findOne(Garzon, {
      where: { tenantId, esPlaceholder: true, eliminadoEl: IsNull() },
    });
    if (existente) return existente;
    return manager.save(
      Garzon,
      manager.create(Garzon, {
        tenantId,
        nombre: 'Mostrador',
        pinHash: PIN_INUTILIZABLE,
        activo: false,
        tipo: TipoGarzon.GARZON,
        esPlaceholder: true,
      }),
    );
  }

  /**
   * Cuántas sesiones abiertas tiene el garzón. Cuatro operaciones preguntan lo
   * mismo y difieren solo en qué hacen con la respuesta: eliminar y desactivar
   * cortan, cambiar el tipo y regenerar el PIN advierten.
   */
  private async contarSesionesAbiertas(
    tenantId: string,
    id: string,
  ): Promise<number> {
    return this.sesionRepo.count({
      where: { tenantId, garzonId: id, estado: EstadoSesionGarzon.ABIERTA },
    });
  }

  /**
   * Las dos operaciones que sacan al garzón de circulación comparten la regla.
   * Recibe el conteo ya hecho en vez de hacerlo: `actualizar()` necesita el
   * mismo número para decidir si además advierte por el cambio de tipo, y
   * consultarlo dos veces en el mismo request sería una query al pedo.
   */
  private assertSinSesionAbierta(
    abiertas: number,
    accion: 'eliminar' | 'desactivar',
  ): void {
    if (abiertas > 0) {
      throw new BadRequestException(
        `No se puede ${accion} un garzón con una sesión abierta`,
      );
    }
  }

  private async getOrThrow(tenantId: string, id: string): Promise<Garzon> {
    const garzon = await this.garzonRepo.findOne({ where: { id, tenantId } });
    if (!garzon) {
      throw new NotFoundException(`Garzón ${id} no encontrado`);
    }
    return garzon;
  }

  /**
   * Genera un PIN aleatorio de 6 dígitos garantizado único entre los garzones
   * (no eliminados) del tenant, para que la identificación "solo por PIN" no sea
   * ambigua. Reintenta ante colisión (muy improbable con N pequeño sobre 10^6).
   * `exceptId` excluye al propio garzón al regenerar su PIN.
   */
  private async generarPinUnico(
    tenantId: string,
    exceptId?: string,
  ): Promise<string> {
    for (let intento = 0; intento < MAX_INTENTOS_PIN; intento++) {
      const pin = randomInt(0, PIN_MAX_EXCLUSIVO).toString().padStart(6, '0');
      if (!(await this.pinYaUsado(tenantId, pin, exceptId))) {
        return pin;
      }
    }
    throw new ConflictException(
      'No se pudo generar un PIN único; intenta de nuevo',
    );
  }

  /**
   * Indica si el PIN ya pertenece a algún garzón (no eliminado) del tenant.
   * Como está hasheado, se compara contra cada garzón existente. `exceptId`
   * excluye al propio garzón al regenerar su PIN.
   */
  private async pinYaUsado(
    tenantId: string,
    pin: string,
    exceptId?: string,
  ): Promise<boolean> {
    const garzones = await this.garzonRepo.find({ where: { tenantId } });
    for (const garzon of garzones) {
      if (garzon.id === exceptId) continue;
      if (await bcrypt.compare(pin, garzon.pinHash)) {
        return true;
      }
    }
    return false;
  }
}
