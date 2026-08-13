import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import Decimal from 'decimal.js';
import { CajaTestigo, ViaFirma } from './entities/caja-testigo.entity';
import { Caja } from './entities/caja.entity';
import { GarzonesService } from '../garzones/garzones.service';
import type { Garzon } from '../garzones/entities/garzon.entity';
import { SesionesGarzonService } from '../turnos/sesiones-garzon.service';
import type { ResolverTestigoDto } from './dto/resolver-testigo.dto';
import type { CredencialGarzonOpcionalDto } from '../../common/dto/credencial-garzon.dto';

/** Una línea del arqueo, tal como la ve el garzón: nunca `esperado`. */
export interface LineaTestigo {
  metodoPagoId: string | null;
  nombre: string;
  esEfectivo: boolean;
  contado: string | null;
}

/** Lo que el garzón ve al entrar a su pantalla, por cada solicitud pendiente. */
export interface SolicitudPublica {
  id: string;
  cajaId: string;
  solicitadaEl: Date;
  /** `garzones.usuario_id` seteado → esta solicitud se resuelve vía cuenta, sin PIN. */
  garzonVinculado: boolean;
  lineas: LineaTestigo[];
}

/**
 * El garzón da fe del conteo de un cierre forzado, o lo rechaza, desde su
 * propia sesión, por cuenta vinculada o por PIN. Es el corazón de la
 * feature: el encargado (`Cajas:Actualizar`) puede PEDIR la firma, nunca
 * completarla — `resolver` y `pendientesDeGarzon` no exigen ningún permiso
 * de CAJA, solo `Salones:Operar` (el mismo piso que el resto de la pantalla
 * del garzón, `salones.controller.ts`) + la prueba de identidad (cuenta
 * vinculada o PIN) que decide si ESTA fila en particular se puede tocar. El
 * permiso de módulo y la prueba de identidad son ortogonales: uno decide
 * quién puede pisar la pantalla, la otra decide de qué garzón puede hablar.
 * Ver `docs/superpowers/specs/2026-08-11-testigo-cierre-forzado-design.md`.
 */
@Injectable()
export class CajaTestigoService {
  constructor(
    @InjectRepository(CajaTestigo)
    private readonly testigoRepo: Repository<CajaTestigo>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly sesionesGarzonService: SesionesGarzonService,
    private readonly garzonesService: GarzonesService,
  ) {}

  /**
   * El encargado pide fe a uno o varios garzones. Solo sobre una caja
   * `en_conciliacion` —el conteo ya congelado por la fase 1 del cierre—: es
   * lo único que hace que la firma valga, contra números que no van a
   * cambiar. **Mutante que tiene que morir** (spec, §Testing): pedir la
   * firma ANTES de congelar el conteo anula la feature entera.
   *
   * La elegibilidad se resuelve por estar en `listarAbiertas(tenantId)`
   * —sesión abierta AHORA—, nunca por una lista de exclusiones: de ahí sale
   * además `sesionGarzonId`, nunca del cliente, porque es la prueba de que
   * el garzón estaba en turno, no solo de quién es. El placeholder
   * "Mostrador" queda afuera solo: no tiene ningún camino para abrir sesión
   * (`garzones.service.ts` → `asegurarMostrador`, `pinHash: '!'`).
   *
   * Resuelve TODAS las sesiones antes de escribir ninguna fila (revisión
   * independiente, ronda 3): validar y guardar en el mismo paso dejaba
   * comprometidas las filas de los garzones anteriores de la lista cuando
   * uno posterior no tenía sesión —`[A, B]` con B sin sesión commiteaba A
   * igual, devolvía 400, y un reintento de la MISMA lista fallaba en A por
   * el 23505 de abajo, ocultando el error real—. Con la validación completa
   * primero, un pedido inválido no escribe nada.
   *
   * La escritura sigue siendo una fila por `save`, no un lote: eso es
   * distinto —un 23505 legítimo (el garzón YA tiene una fila viva) es un
   * conflicto real por fila, no un error de la lista entera, y no hay por
   * qué tirar abajo las que ya se guardaron antes en el loop.
   */
  async solicitar(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    garzonIds: string[],
  ): Promise<CajaTestigo[]> {
    const caja = await this.cajaRepo.findOne({
      where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
    });
    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }
    if (caja.estado !== 'en_conciliacion') {
      throw new BadRequestException(
        'Solo se puede pedir testigo con el conteo ya congelado (caja en conciliación)',
      );
    }

    const abiertas = await this.sesionesGarzonService.listarAbiertas(tenantId);
    const sesionPorGarzon = new Map(abiertas.map((s) => [s.garzonId, s.id]));

    const solicitudes = garzonIds.map((garzonId) => {
      const sesionGarzonId = sesionPorGarzon.get(garzonId);
      if (!sesionGarzonId) {
        throw new BadRequestException(
          'Solo se puede pedir fe a un garzón con sesión abierta ahora',
        );
      }
      return { garzonId, sesionGarzonId };
    });

    const testigos: CajaTestigo[] = [];
    for (const { garzonId, sesionGarzonId } of solicitudes) {
      const fila = this.testigoRepo.create({
        tenantId,
        cajaId,
        garzonId,
        sesionGarzonId,
        solicitadaPor: usuarioId,
        estado: 'pendiente',
      });
      try {
        testigos.push(await this.testigoRepo.save(fila));
      } catch (e) {
        if (
          e instanceof QueryFailedError &&
          (e as unknown as { code?: string }).code === '23505'
        ) {
          throw new BadRequestException(
            'Ese garzón ya tiene una solicitud viva (pendiente o firmada) para esta caja',
          );
        }
        throw e;
      }
    }
    return testigos;
  }

  /**
   * Lo que el garzón ve al entrar a su pantalla (`/salones`). Devuelve **lo
   * contado, nunca lo esperado** — revelar el esperado acá sería la puerta
   * de atrás del cierre ciego (`arqueo-ciego`): el garzón vería el número
   * antes que el propio cajero, si el tenant tiene el modo ciego activo.
   *
   * `credencial` en vez de un `garzonId` de ruta (revisión independiente,
   * ronda 4 — C2 seguía abierto: `miVinculo` devuelve `null` tanto para "sin
   * vínculo" como para "tótem", así que la cuenta del tótem —la que de
   * hecho usa esta pantalla— podía pedir las pendientes de CUALQUIER
   * `garzonId` enumerado del selector del salón, y `miVinculo` es
   * "conveniencia de UI, no un control" por su propio docblock). Mismo
   * patrón que `SesionesGarzonService.activaPropia` para la lectura
   * equivalente: `GarzonesService.resolverGarzonActuante(tenantId,
   * usuarioId, credencial)` — con vínculo personal, la identidad ES esa
   * cuenta y la `credencial` se ignora; sin vínculo (tótem), EXIGE
   * `garzonId` + PIN verificado por `bcrypt.compare`. El `garzonId` que se
   * usa para buscar pendientes sale del garzón YA PROBADO, nunca de un
   * param sin contrastar.
   *
   * Tres queries fijas, nunca una por solicitud: resolver el garzón que
   * llama, la lista de sus pendientes y, si hay alguna, las líneas de
   * arqueo de TODAS sus cajas en un solo `WHERE caja_id = ANY($1)`.
   */
  async pendientesDeGarzon(
    tenantId: string,
    usuarioId: string,
    credencial: CredencialGarzonOpcionalDto,
  ): Promise<SolicitudPublica[]> {
    const garzon = await this.garzonesService.resolverGarzonActuante(
      tenantId,
      usuarioId,
      credencial,
    );
    const garzonVinculado = await this.esVinculacionValida(tenantId, garzon);

    const testigos = await this.testigoRepo.find({
      where: {
        tenantId,
        garzonId: garzon.id,
        estado: 'pendiente',
        eliminadoEl: IsNull(),
      },
      order: { solicitadaEl: 'ASC' },
    });
    if (testigos.length === 0) return [];

    const cajaIds = [...new Set(testigos.map((t) => t.cajaId))];
    const lineasPorCaja = await this.lineasContadasPorCaja(tenantId, cajaIds);

    return testigos.map((t) => ({
      id: t.id,
      cajaId: t.cajaId,
      solicitadaEl: t.solicitadaEl,
      garzonVinculado,
      lineas: lineasPorCaja.get(t.cajaId) ?? [],
    }));
  }

  /**
   * El garzón resuelve la SUYA: firma o rechaza. `testigoId` ya fija de qué
   * garzón se trata —no se vuelve a pedir `garzonId`—, así que lo único que
   * falta probar es la identidad. Dos vías, decisión del owner 2026-08-12
   * (ronda 2 de esta task — la primera versión solo tenía PIN, y el owner
   * midió que no alcanza: `garzones.service.ts` devuelve el PIN en claro al
   * crear y al regenerar, así que **no es un secreto del garzón, es uno que
   * el encargado emite y conoce**; y la pantalla del garzón es un tótem
   * compartido, así que ni siquiera "quién llamó" identifica a nadie):
   *
   * - **Vía cuenta** (prueba fuerte): si `garzones.usuario_id` está seteado
   *   Y esa cuenta NO es un tótem (`esVinculacionValida` — revisión
   *   independiente, ronda 4: mirar solo `usuario_id` aceptaba una firma
   *   SIN PIN desde un dispositivo compartido si alguien vinculaba un
   *   garzón a la cuenta del tótem por error, y la congelaba como
   *   `via_firma:'cuenta'` — prueba fuerte siendo la más débil posible;
   *   `garzones.service.ts` ya trata `es_totem` como override duro en todo
   *   el resto del sistema, esto se alinea), la resolución EXIGE que
   *   `usuarioId` (el JWT que llama) sea esa cuenta. La vía PIN queda
   *   rechazada para él a propósito — ni se mira `dto.pin`—: si un garzón
   *   vinculado pudiera igual resolver por PIN desde el tótem, la vía
   *   fuerte se esquivaría y vincular la cuenta no probaría nada.
   * - **Vía PIN** (identifica, no prueba cuenta): si no está vinculado (o el
   *   vínculo no cuenta por ser un tótem), sigue como antes — reusa
   *   `GarzonesService.verificarPin` (mismo `bcrypt.compare` contra
   *   `garzones.pin_hash` que el resto del sistema de PIN) en vez de
   *   duplicarlo; traduce su `BadRequestException` (semántica "PIN de forma
   *   inválida") a `ForbiddenException` (semántica "no sos quien decís
   *   ser").
   *
   * `resueltaPorUsuarioId` (la cuenta que efectivamente mandó el request) y
   * `viaFirma` (cuál de las dos se usó) quedan congelados en la fila — ver
   * el docblock de esos campos en la entidad para el motivo de guardar
   * `viaFirma` en vez de derivarlo.
   *
   * Solo resuelve una fila `pendiente`; cualquier otro estado → 400 — una
   * firma u rechazo son hechos con hora, no se editan.
   */
  async resolver(
    tenantId: string,
    testigoId: string,
    usuarioId: string,
    dto: ResolverTestigoDto,
  ): Promise<CajaTestigo> {
    const testigo = await this.testigoRepo.findOne({
      where: { id: testigoId, tenantId, eliminadoEl: IsNull() },
    });
    if (!testigo) {
      throw new NotFoundException(`Solicitud ${testigoId} no encontrada`);
    }
    if (testigo.estado !== 'pendiente') {
      throw new BadRequestException('Esta solicitud ya fue resuelta');
    }

    const garzon = await this.garzonesService.obtenerActivoPorId(
      tenantId,
      testigo.garzonId,
    );

    let viaFirma: ViaFirma;
    if (await this.esVinculacionValida(tenantId, garzon)) {
      // Vía cuenta: el PIN no se evalúa ni aunque venga y sea correcto — es
      // justo lo que impide esquivar la vía fuerte yendo al tótem.
      if (usuarioId !== garzon.usuarioId) {
        throw new ForbiddenException(
          'Este garzón está vinculado a una cuenta: la firma tiene que hacerse desde esa cuenta, no por PIN',
        );
      }
      viaFirma = 'cuenta';
    } else {
      if (!dto.pin) {
        throw new BadRequestException('Falta el PIN');
      }
      try {
        await this.garzonesService.verificarPin(
          tenantId,
          testigo.garzonId,
          dto.pin,
        );
      } catch (e) {
        if (e instanceof BadRequestException) {
          throw new ForbiddenException('PIN inválido');
        }
        throw e;
      }
      viaFirma = 'pin';
    }

    testigo.estado = dto.firma ? 'firmada' : 'rechazada';
    testigo.comentarioGarzon = dto.comentario ?? null;
    testigo.resueltaEl = new Date();
    testigo.resueltaPorUsuarioId = usuarioId;
    testigo.viaFirma = viaFirma;
    return this.testigoRepo.save(testigo);
  }

  /**
   * El encargado cerró sin esperar (fase 2, `cerrar`): las pendientes de esa
   * caja no quedan colgadas para siempre. Corre con el `manager` de esa
   * transacción (Task 4).
   */
  async cancelarPendientes(
    manager: EntityManager,
    tenantId: string,
    cajaId: string,
  ): Promise<void> {
    await manager.update(
      CajaTestigo,
      { tenantId, cajaId, estado: 'pendiente', eliminadoEl: IsNull() },
      { estado: 'cancelada' },
    );
  }

  /**
   * El garzón cerró su turno con una solicitud abierta: una solicitud viva
   * contra una sesión cerrada sería un estado imposible de honrar, porque la
   * firma se valida contra esa sesión. Corre con el `manager` de la
   * transacción de cierre de sesión (`sesiones-garzon`, Task 4/5).
   */
  async caducarPorSesion(
    manager: EntityManager,
    tenantId: string,
    sesionGarzonId: string,
  ): Promise<void> {
    await manager.update(
      CajaTestigo,
      { tenantId, sesionGarzonId, estado: 'pendiente', eliminadoEl: IsNull() },
      { estado: 'caducada' },
    );
  }

  /**
   * ¿Alguien dio fe de esta caja? Lo usa `CajaService.cerrar` (Task 4) para
   * exigir comentario obligatorio cuando nadie firmó. Recibe el `manager` de
   * esa transacción y no `this.testigoRepo` a propósito (revisión
   * independiente, ronda 3): `cerrar` retiene un `FOR UPDATE` sobre `cajas`
   * mientras corre, y un `count()` por el repo inyectado pediría una
   * conexión NUEVA del pool en el medio — el mismo patrón que
   * `SesionesGarzonService.contarAbiertas` ya tuvo que resolver así (ver su
   * docblock). `cancelarPendientes`/`caducarPorSesion`, sus hermanas, ya
   * reciben `manager`; esta se alinea.
   */
  async hayFirmaDe(
    manager: EntityManager,
    tenantId: string,
    cajaId: string,
  ): Promise<boolean> {
    const total = await manager.count(CajaTestigo, {
      where: { tenantId, cajaId, estado: 'firmada', eliminadoEl: IsNull() },
    });
    return total > 0;
  }

  /**
   * ¿`garzon.usuarioId` prueba de verdad al garzón, o es una vinculación que
   * no cuenta? (revisión independiente, ronda 4). Dos motivos por los que
   * `usuario_id` seteado NO alcanza:
   *
   * 1. Esa cuenta está marcada `es_totem` — el override duro que el resto
   *    del sistema ya respeta (`garzonPersonalDe`, `resolverGarzonActuante`
   *    rama 1): "aunque alguien le vincule un garzón por error, no se
   *    vuelve personal". Aceptar la vía cuenta ahí sería registrar como
   *    prueba fuerte una firma que salió de un dispositivo compartido, sin
   *    PIN.
   * 2. El garzón quedó inactivo o se borró entre que se vinculó y ahora.
   *
   * `GarzonesService.miVinculo` ya resuelve las dos en una consulta —es la
   * MISMA definición canónica de "vinculado" que usa el resto del módulo
   * (`garzonPersonalDe`: `activo = true AND eliminado_el IS NULL`, más el
   * override de `es_totem`)— así que reusarla acá evita definir una segunda
   * noción de "vinculado" que pueda divergir.
   */
  private async esVinculacionValida(
    tenantId: string,
    garzon: Garzon,
  ): Promise<boolean> {
    if (!garzon.usuarioId) return false;
    const vinculo = await this.garzonesService.miVinculo(
      tenantId,
      garzon.usuarioId,
    );
    return vinculo?.garzonId === garzon.id;
  }

  /**
   * Líneas contadas de un conjunto de cajas, en una sola query — nunca una
   * por caja. Mismo patrón que `CajaService.obtenerArqueo` (rama de caja
   * cerrada), pero **sin `esperado`**: es lo que mantiene intacto el cierre
   * ciego para quien todavía no vio los números.
   */
  private async lineasContadasPorCaja(
    tenantId: string,
    cajaIds: string[],
  ): Promise<Map<string, LineaTestigo[]>> {
    const rows: {
      caja_id: string;
      metodo_pago_id: string | null;
      nombre: string | null;
      es_efectivo: boolean;
      contado: string | null;
    }[] = await this.dataSource.query(
      `SELECT am.caja_id,
              am.metodo_pago_id,
              COALESCE(mp.nombre, 'Efectivo') AS nombre,
              am.es_efectivo,
              am.contado
         FROM caja_arqueo_medio am
         -- Igual que CajaService.calcularArqueo/obtenerArqueo (mismo JOIN,
         -- mismo motivo): NO se filtra mp.eliminado_el a propósito. El
         -- nombre es intrínseco al método del arqueo histórico; filtrarlo
         -- dejaría mp.nombre NULL para un método borrado y el COALESCE de
         -- abajo lo renombraría "Efectivo" — corrompería el dato de una
         -- línea de tarjeta, no solo la ocultaría. Excepción documentada,
         -- no un filtro que falte.
         LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = am.metodo_pago_id
        WHERE am.caja_id = ANY($1)
          AND am.tenant_id = $2
          AND am.eliminado_el IS NULL
        ORDER BY am.es_efectivo DESC, mp.nombre ASC`,
      [cajaIds, tenantId],
    );

    const mapa = new Map<string, LineaTestigo[]>();
    for (const r of rows) {
      const arr = mapa.get(r.caja_id) ?? [];
      arr.push({
        metodoPagoId: r.metodo_pago_id,
        nombre: r.nombre ?? 'Efectivo',
        esEfectivo: r.es_efectivo,
        contado: r.contado === null ? null : new Decimal(r.contado).toFixed(4),
      });
      mapa.set(r.caja_id, arr);
    }
    return mapa;
  }
}
