import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import { CajaArqueoMedio } from './entities/caja-arqueo-medio.entity';
import { MotivosDiferenciaService } from '../motivos-diferencia/motivos-diferencia.service';
import { SesionesGarzonService } from '../turnos/sesiones-garzon.service';
import { CajaTestigoService } from './caja-testigo.service';
import type { AbrirCajaDto } from './dto/abrir-caja.dto';
import type { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import type { CerrarCajaDto } from './dto/cerrar-caja.dto';
import type { FinalizarCierreDto } from './dto/finalizar-cierre.dto';
import type { QueryMovimientosCajaDto } from './dto/query-movimientos-caja.dto';
import type { QueryHistorialCajaDto } from './dto/query-historial-caja.dto';
import type { QueryTendenciaDescuadresDto } from './dto/query-tendencia-descuadres.dto';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import {
  bordeFechaSql,
  bordeHastaSql,
  requiereZonaTenant,
  zonaHorariaTenant,
} from '../../common/utils/rango-fecha.util';

export interface CajonEstado {
  cajonId: string;
  nombre: string;
  sesion: {
    cajaId: string;
    usuarioId: string | null;
    usuarioNombre: string;
    saldoInicial: string;
    /** `null` en modo ciego con la caja `abierta` — ver `cajonesEstado`. */
    saldoEsperado: string | null;
    fechaApertura: Date;
    esPropia: boolean;
  } | null;
}

export interface MovimientoCajaListItem {
  id: string;
  cajaId: string;
  tipo: string;
  concepto: string;
  monto: string;
  referencia: string | null;
  fecha: Date;
  ventaId: string | null;
}

export interface CajaTurnoResumen {
  ciego: boolean;
  saldoInicial: string;
  totalEntradas: string | null;
  totalSalidas: string | null;
  saldoEsperado: string | null;
  totalMovimientos: number | null;
}

export interface LineaArqueo {
  metodoPagoId: string | null;
  nombre: string;
  esEfectivo: boolean;
  esperado: string | null;
  requiereConteo: boolean;
  contado?: string | null;
  diferencia?: string | null;
  motivoDiferenciaId?: string | null;
  motivoNombre?: string | null;
  comentarioDiferencia?: string | null;
}

/**
 * Columna sobre la que se mide la ventana de la tendencia: el cierre **cuando
 * existe**, y la apertura cuando no.
 *
 * Filtrar `fecha_cierre` a secas excluiría **en silencio** a las cajas en
 * `en_conciliacion` —que la tienen NULL y son justo las que más le importan al
 * supervisor: descuadraron y siguen sin resolver—, porque toda comparación
 * contra NULL es falsa. Ninguna fila se cae de la ventana por su estado.
 */
const COLUMNA_VENTANA = 'COALESCE(c.fecha_cierre, c.fecha_apertura)';

/**
 * Una fila de la tendencia de descuadres: un cajero, su ventana. Los montos
 * viajan como string (convención de dinero del proyecto), los conteos como int.
 *
 * ⚠️ Los tres conteos son **de la línea de efectivo**, no del arqueo entero: una
 * caja con el efectivo exacto y −500 en tarjeta cuenta como `cuadrados`. Es
 * deliberado —la señal de sesgo es sobre el efectivo— pero quien renderice esto
 * tiene que rotularlo, o el número miente.
 */
export interface TendenciaDescuadresItem {
  usuarioId: string;
  usuarioNombre: string;
  cierres: number;
  /** Suma CON SIGNO de la línea de efectivo. Negativo = faltante. */
  efectivoSuma: string;
  /** Todo lo que no es efectivo, agregado aparte y nunca sumado al de arriba. */
  otrosMediosSuma: string;
  conFaltante: number;
  conSobrante: number;
  cuadrados: number;
}

interface TendenciaDescuadresRow {
  usuario_id: string;
  usuario_nombre: string | null;
  usuario_apellido: string | null;
  cierres: number;
  efectivo_suma: string;
  otros_medios_suma: string;
  con_faltante: number;
  con_sobrante: number;
  cuadrados: number;
}

export interface CajaHistorialItem {
  id: string;
  tenantId: string;
  usuarioId: string | null;
  tipo: string;
  estado: string;
  saldoInicial: string;
  saldoFinal: string | null;
  montoContado: string | null;
  /** Diferencia de la línea de EFECTIVO: el cuadre del cajón físico. */
  diferencia: string | null;
  /**
   * Diferencia de TODAS las líneas del arqueo (efectivo + cada método con
   * `requiere_conteo`). Es el número que responde "¿esta caja cuadró?"; el de
   * arriba solo mira el efectivo y deja invisible un descuadre de tarjeta.
   * `null` mientras la caja no tenga arqueo congelado (o sea, abierta).
   */
  diferenciaTotal: string | null;
  fechaApertura: Date;
  fechaCierre: Date | null;
  comentario: string | null;
  cajonNombre: string | null;
}

@Injectable()
export class CajaService {
  constructor(
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(MovimientoCaja)
    private readonly movimientoCajaRepo: Repository<MovimientoCaja>,
    @InjectRepository(CajaArqueoMedio)
    private readonly arqueoMedioRepo: Repository<CajaArqueoMedio>,
    private readonly db: Db,
    private readonly motivosService: MotivosDiferenciaService,
    private readonly sesionesGarzonService: SesionesGarzonService,
    private readonly cajaTestigoService: CajaTestigoService,
  ) {}

  async findActiva(tenantId: string, usuarioId: string): Promise<Caja | null> {
    // 'en_conciliacion' sigue "ocupando" al cajero: la conciliación (fase 2)
    // está pendiente, no puede abrir otra caja hasta resolverla.
    return this.cajaRepo.findOne({
      where: {
        tenantId,
        usuarioId,
        tipo: 'fisica',
        estado: In(['abierta', 'en_conciliacion']),
        eliminadoEl: IsNull(),
      },
    });
  }

  async findVirtual(tenantId: string): Promise<Caja | null> {
    return this.cajaRepo.findOne({
      where: {
        tenantId,
        tipo: 'virtual',
        estado: 'abierta',
        eliminadoEl: IsNull(),
      },
    });
  }

  async cajonesDisponibles(
    tenantId: string,
    usuarioId: string,
  ): Promise<{ cajonId: string; nombre: string }[]> {
    const rows: { cajon_id: string; nombre: string }[] = await this.db.query(
      `SELECT cj.cajon_id, cj.nombre
           FROM cajones cj
          WHERE cj.tenant_id = $1
            AND cj.activo = true
            AND cj.eliminado_el IS NULL
            -- autorizado: allow-list vacía (permisivo) o el usuario está en ella
            AND (
              NOT EXISTS (
                SELECT 1 FROM cajon_usuario cu
                 WHERE cu.cajon_id = cj.cajon_id AND cu.eliminado_el IS NULL
              )
              OR EXISTS (
                SELECT 1 FROM cajon_usuario cu
                 WHERE cu.cajon_id = cj.cajon_id AND cu.usuario_id = $2
                   AND cu.eliminado_el IS NULL
              )
            )
            -- libre: sin sesión abierta ni conciliación pendiente
            AND NOT EXISTS (
              SELECT 1 FROM cajas c
               WHERE c.cajon_id = cj.cajon_id
                 AND c.estado IN ('abierta', 'en_conciliacion') AND c.eliminado_el IS NULL
            )
          ORDER BY cj.nombre ASC`,
      [tenantId, usuarioId],
    );
    return rows.map((r) => ({ cajonId: r.cajon_id, nombre: r.nombre }));
  }

  async abrir(
    tenantId: string,
    usuarioId: string,
    dto: AbrirCajaDto,
  ): Promise<Caja> {
    const existente = await this.findActiva(tenantId, usuarioId);
    if (existente) {
      throw new ConflictException('Ya tienes una caja abierta');
    }

    try {
      return await this.db.transaccion(async (manager) => {
        // 2. Cajón válido + activo (del tenant, no borrado)
        const cajonRows: { cajon_id: string; activo: boolean }[] =
          await manager.query(
            `SELECT cajon_id, activo FROM cajones
              WHERE cajon_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
            [dto.cajonId, tenantId],
          );
        const cajon = cajonRows[0];
        if (!cajon) throw new NotFoundException('Cajón no encontrado');
        if (!cajon.activo)
          throw new ConflictException('El cajón está inactivo');

        // 3. Autorizado — allow-list del sub-2. Vacía = permisivo.
        const totalRows: { total: number }[] = await manager.query(
          `SELECT COUNT(*)::int AS total FROM cajon_usuario
            WHERE cajon_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
          [dto.cajonId, tenantId],
        );
        if ((totalRows[0]?.total ?? 0) > 0) {
          const miRows: { total: number }[] = await manager.query(
            `SELECT COUNT(*)::int AS total FROM cajon_usuario
              WHERE cajon_id = $1 AND tenant_id = $2 AND usuario_id = $3
                AND eliminado_el IS NULL`,
            [dto.cajonId, tenantId, usuarioId],
          );
          if ((miRows[0]?.total ?? 0) === 0) {
            throw new ForbiddenException(
              'No estás autorizado a abrir este cajón',
            );
          }
        }

        // 4. Cajón libre — lockea las sesiones abiertas o en conciliación de
        // ese cajón (una conciliación pendiente también ocupa el cajón).
        const ocupadas: { caja_id: string }[] = await manager.query(
          `SELECT caja_id FROM cajas
            WHERE cajon_id = $1 AND tenant_id = $2
              AND estado IN ('abierta', 'en_conciliacion') AND eliminado_el IS NULL
            FOR UPDATE`,
          [dto.cajonId, tenantId],
        );
        if (ocupadas.length > 0) {
          throw new ConflictException('El cajón ya tiene una caja abierta');
        }

        // 5. Crear la sesión física sobre el cajón
        const caja = manager.create(Caja, {
          tenantId,
          usuarioId,
          cajonId: dto.cajonId,
          tipo: 'fisica',
          estado: 'abierta',
          saldoInicial: dto.saldoInicial,
          comentario: dto.comentario,
        });
        return await manager.save(caja);
      });
    } catch (e) {
      // Backstop de concurrencia: dos aperturas simultáneas violan un índice
      // único parcial (23505). Cuál de los dos decide el mensaje — el chequeo
      // aplicativo de arriba corre fuera de la transacción y no alcanza.
      if (
        e instanceof QueryFailedError &&
        (e as { code?: string }).code === '23505'
      ) {
        const constraint = (e as { constraint?: string }).constraint;
        throw new ConflictException(
          constraint === 'ux_cajas_activa_por_usuario'
            ? 'Ya tienes una caja abierta'
            : 'El cajón ya tiene una caja abierta',
        );
      }
      throw e;
    }
  }

  /**
   * Lock pesimista de una caja abierta. Debe llamarse dentro de una transacción
   * abierta antes de leer saldo o egresar (evita TOCTOU entre NC / movimientos).
   */
  async bloquearCajaAbierta(
    manager: EntityManager,
    cajaId: string,
    tenantId: string,
  ): Promise<void> {
    const rows: { caja_id: string }[] = await manager.query(
      `SELECT caja_id FROM cajas
        WHERE caja_id = $1 AND tenant_id = $2
          AND estado = 'abierta' AND eliminado_el IS NULL
        FOR UPDATE`,
      [cajaId, tenantId],
    );
    if (!rows.length) {
      throw new ForbiddenException('Caja no encontrada o no está abierta');
    }
  }

  /**
   * Lock pesimista de una caja en conciliación. Debe llamarse dentro de una
   * transacción abierta antes de finalizar el cierre (fase 2) — evita TOCTOU
   * entre dos intentos concurrentes de `cerrar`.
   */
  private async bloquearCajaEnConciliacion(
    manager: EntityManager,
    cajaId: string,
    tenantId: string,
  ): Promise<void> {
    const rows: { caja_id: string }[] = await manager.query(
      `SELECT caja_id FROM cajas
        WHERE caja_id = $1 AND tenant_id = $2
          AND estado = 'en_conciliacion' AND eliminado_el IS NULL
        FOR UPDATE`,
      [cajaId, tenantId],
    );
    if (!rows.length) {
      throw new BadRequestException('La caja no está en conciliación');
    }
  }

  /**
   * Línea de efectivo del arqueo: fondo + entradas de métodos es_efectivo +
   * entradas manuales (metodo_pago_id NULL) − todas las salidas. Los vueltos ya
   * están netos en el movimiento (pagos.service inserta monto = pago − vuelto).
   * El LEFT JOIN a metodos_pago NO filtra eliminado_el a propósito: es_efectivo
   * es intrínseco al método del movimiento histórico (ver spec, invariante).
   */
  async calcularEsperadoEfectivo(
    cajaId: string,
    manager: EntityManager,
  ): Promise<string> {
    const rows: {
      saldo_inicial: string;
      entradas_efectivo: string | null;
      salidas: string | null;
    }[] = await manager.query(
      `SELECT c.saldo_inicial,
              SUM(m.monto) FILTER (
                WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL
                  AND (m.metodo_pago_id IS NULL OR COALESCE(mp.es_efectivo, false) = true)
              ) AS entradas_efectivo,
              SUM(m.monto) FILTER (
                WHERE m.tipo = 'salida' AND m.eliminado_el IS NULL
              ) AS salidas
       FROM cajas c
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = m.metodo_pago_id
       WHERE c.caja_id = $1
         AND c.eliminado_el IS NULL
       GROUP BY c.saldo_inicial`,
      [cajaId],
    );

    const row = rows[0];
    const saldoInicial = new Decimal(row?.saldo_inicial ?? '0');
    const entradas = new Decimal(row?.entradas_efectivo ?? '0');
    const salidas = new Decimal(row?.salidas ?? '0');
    return saldoInicial.plus(entradas).minus(salidas).toFixed(4);
  }

  /**
   * Arqueo completo: la línea de efectivo agregada (siempre presente, siempre
   * obligatoria) + una línea por cada método no-efectivo con movimientos. Dos
   * queries fijas, sin N+1. El `esperado` de cada línea es el valor a cuadrar.
   */
  async calcularArqueo(
    cajaId: string,
    tenantId: string,
    manager: EntityManager,
  ): Promise<LineaArqueo[]> {
    const esperadoEfectivo = await this.calcularEsperadoEfectivo(
      cajaId,
      manager,
    );

    const noEfectivo: {
      metodo_pago_id: string;
      nombre: string;
      requiere_conteo: boolean;
      entradas: string;
    }[] = await manager.query(
      `SELECT m.metodo_pago_id,
              mp.nombre,
              COALESCE(tmp.requiere_conteo, false) AS requiere_conteo,
              COALESCE(SUM(m.monto), 0) AS entradas
       FROM movimientos_caja m
       -- Igual que en calcularEsperadoEfectivo: NO se filtra mp.eliminado_el.
       -- es_efectivo/nombre son intrínsecos al método del movimiento histórico;
       -- filtrarlo (es INNER JOIN) haría desaparecer del arqueo la línea de un
       -- método borrado después de usarse en una venta.
       JOIN metodos_pago mp ON mp.metodo_pago_id = m.metodo_pago_id
       LEFT JOIN tenant_metodo_pago tmp
              ON tmp.metodo_pago_id = m.metodo_pago_id
             AND tmp.tenant_id = $2
             AND tmp.eliminado_el IS NULL
       WHERE m.caja_id = $1
         AND m.eliminado_el IS NULL
         AND m.tipo = 'entrada'
         AND m.metodo_pago_id IS NOT NULL
         AND COALESCE(mp.es_efectivo, false) = false
       GROUP BY m.metodo_pago_id, mp.nombre, tmp.requiere_conteo
       ORDER BY mp.nombre ASC`,
      [cajaId, tenantId],
    );

    return [
      {
        metodoPagoId: null,
        nombre: 'Efectivo',
        esEfectivo: true,
        esperado: esperadoEfectivo,
        requiereConteo: true,
      },
      ...noEfectivo.map((r) => ({
        metodoPagoId: r.metodo_pago_id,
        nombre: r.nombre,
        esEfectivo: false,
        esperado: new Decimal(r.entradas).toFixed(4),
        requiereConteo: r.requiere_conteo,
      })),
    ];
  }

  /**
   * Config del modo ciego por tenant (columna tenants.arqueo_ciego). Lectura y
   * escritura por query raw parametrizada; tenant del token; filtra soft-delete.
   */
  async getArqueoCiego(tenantId: string): Promise<boolean> {
    const rows: { arqueo_ciego: boolean }[] = await this.db.query(
      `SELECT arqueo_ciego FROM tenants
        WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [tenantId],
    );
    return rows[0]?.arqueo_ciego ?? false;
  }

  async setArqueoCiego(tenantId: string, valor: boolean): Promise<void> {
    await this.db.query(
      `UPDATE tenants SET arqueo_ciego = $1
        WHERE tenant_id = $2 AND eliminado_el IS NULL`,
      [valor, tenantId],
    );
  }

  /**
   * Arqueo para el drawer de cierre y el detalle read-only.
   * Caja abierta → preview recomputado (sin contado). En modo ciego (config del
   * tenant) se RETIENE el `esperado` (null) y se filtra a las líneas obligatorias.
   * Caja cerrada → líneas congeladas, SIEMPRE reveladas (ciego:false).
   */
  async obtenerArqueo(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas: boolean,
    esAdmin = false,
  ): Promise<{ ciego: boolean; lineas: LineaArqueo[] }> {
    const caja = await this.verificarAccesoCaja(
      tenantId,
      usuarioId,
      cajaId,
      tieneVerTodas,
    );

    if (caja.estado === 'abierta') {
      const lineas = await this.db.transaccion((manager) =>
        this.calcularArqueo(cajaId, tenantId, manager),
      );
      // El ciego no aplica al admin del tenant ni al superadmin (§3.4): el dueño
      // ve el esperado en vivo. Sí aplica a cajeros y supervisores no-admin.
      const ciego = !esAdmin && (await this.getArqueoCiego(tenantId));
      if (ciego) {
        return {
          ciego: true,
          lineas: lineas
            .filter((l) => l.esEfectivo || l.requiereConteo)
            .map((l) => ({ ...l, esperado: null })),
        };
      }
      return { ciego: false, lineas };
    }

    const rows: {
      metodo_pago_id: string | null;
      nombre: string | null;
      es_efectivo: boolean;
      esperado: string;
      contado: string | null;
      diferencia: string | null;
      requiere_conteo: boolean;
      motivo_nombre: string | null;
      motivo_diferencia_id: string | null;
      comentario_diferencia: string | null;
    }[] = await this.db.query(
      `SELECT am.metodo_pago_id,
              COALESCE(mp.nombre, 'Efectivo') AS nombre,
              am.es_efectivo,
              am.esperado,
              am.contado,
              am.diferencia,
              COALESCE(tmp.requiere_conteo, am.es_efectivo) AS requiere_conteo,
              md.nombre AS motivo_nombre,
              am.motivo_diferencia_id,
              am.comentario_diferencia
       FROM caja_arqueo_medio am
       LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = am.metodo_pago_id
       LEFT JOIN motivo_diferencia_caja md
              ON md.motivo_diferencia_id = am.motivo_diferencia_id
             AND md.eliminado_el IS NULL
       LEFT JOIN tenant_metodo_pago tmp
              ON tmp.metodo_pago_id = am.metodo_pago_id
             AND tmp.tenant_id = $2
             AND tmp.eliminado_el IS NULL
       WHERE am.caja_id = $1
         AND am.eliminado_el IS NULL
       ORDER BY am.es_efectivo DESC, mp.nombre ASC`,
      [cajaId, tenantId],
    );

    return {
      ciego: false,
      lineas: rows.map((r) => ({
        metodoPagoId: r.metodo_pago_id,
        nombre: r.nombre ?? 'Efectivo',
        esEfectivo: r.es_efectivo,
        esperado: new Decimal(r.esperado).toFixed(4),
        requiereConteo: r.requiere_conteo,
        contado: r.contado === null ? null : new Decimal(r.contado).toFixed(4),
        diferencia:
          r.diferencia === null ? null : new Decimal(r.diferencia).toFixed(4),
        motivoDiferenciaId: r.motivo_diferencia_id ?? null,
        motivoNombre: r.motivo_nombre ?? null,
        comentarioDiferencia: r.comentario_diferencia ?? null,
      })),
    };
  }

  /**
   * Enforcement de motivos compartido entre la fase 2 del cierre (`cerrar`,
   * desde `en_conciliacion`) y el override admin (`justificarDiferencias`,
   * sobre una caja ya `cerrada`). Solo actualiza motivo_diferencia_id/
   * comentario_diferencia de las líneas ya congeladas — nunca recalcula
   * esperado/contado/diferencia.
   */
  private async aplicarMotivosADescuadres(
    manager: EntityManager,
    tenantId: string,
    cajaId: string,
    lineas: {
      metodoPagoId: string | null;
      motivoDiferenciaId?: string;
      comentarioDiferencia?: string;
    }[],
  ): Promise<void> {
    const filas: {
      metodo_pago_id: string | null;
      diferencia: string | null;
    }[] = await manager.query(
      `SELECT metodo_pago_id, diferencia FROM caja_arqueo_medio
         WHERE caja_id = $1 AND eliminado_el IS NULL`,
      [cajaId],
    );
    const claveDe = (id: string | null) => id ?? 'EFECTIVO';
    // El recorrido va sobre las filas descuadradas de la BD, NO sobre lo que
    // manda el cliente: iterar `lineas` dejaba cerrar una caja descuadrada con
    // `lineas: []` (el `for` no ejecutaba cuerpo y nadie miraba el arqueo real).
    const lineaPorClave = new Map(
      lineas.map((l) => [claveDe(l.metodoPagoId), l]),
    );
    const hayMotivos = await this.motivosService.hayMotivosActivos(
      manager,
      tenantId,
    );
    for (const fila of filas) {
      const dif = fila.diferencia;
      if (dif == null || new Decimal(dif).isZero()) continue;
      // Una línea descuadrada ausente del payload se trata igual que una
      // presente pero vacía: cae en el mismo 400 con el mismo mensaje.
      const l: (typeof lineas)[number] = lineaPorClave.get(
        claveDe(fila.metodo_pago_id),
      ) ?? { metodoPagoId: fila.metodo_pago_id };
      const comentario = l.comentarioDiferencia?.trim() || null;
      let motivoId: string | null = null;
      let comentarioFinal: string | null = null;
      if (hayMotivos) {
        if (!l.motivoDiferenciaId)
          throw new BadRequestException('Falta el motivo de la diferencia');
        const motivo = await this.motivosService.assertMotivoValido(
          manager,
          tenantId,
          l.motivoDiferenciaId,
        );
        if (motivo.requiereComentario && !comentario) {
          throw new BadRequestException(
            `El motivo "${motivo.nombre}" exige un comentario`,
          );
        }
        motivoId = motivo.id;
        comentarioFinal = comentario;
      } else {
        if (!comentario)
          throw new BadRequestException('Falta justificar la diferencia');
        comentarioFinal = comentario;
      }
      // El `WHERE` se arma con el método de LA FILA, no con el del payload: son
      // el mismo valor (la clave del cruce sale de ahí), pero apuntar a la fila
      // que se está recorriendo hace imposible escribir el motivo en otra línea
      // si algún día cambia `claveDe` — un error que devolvería 200.
      const metodoPagoId = fila.metodo_pago_id;
      await manager.query(
        `UPDATE caja_arqueo_medio SET motivo_diferencia_id = $1, comentario_diferencia = $2
         WHERE caja_id = $3 AND tenant_id = $4
           AND ${metodoPagoId === null ? 'metodo_pago_id IS NULL' : 'metodo_pago_id = $5'}
           AND eliminado_el IS NULL`,
        metodoPagoId === null
          ? [motivoId, comentarioFinal, cajaId, tenantId]
          : [motivoId, comentarioFinal, cajaId, tenantId, metodoPagoId],
      );
    }
  }

  /**
   * Justifica (o re-justifica) las líneas que descuadran de una caja YA CERRADA.
   * Admin-only (guard en el controller). No recalcula ni toca esperado/contado/
   * diferencia: solo actualiza motivo_diferencia_id/comentario_diferencia de las
   * filas congeladas por `cerrar`. Mismo enforcement que la fase 2 del cierre
   * (`aplicarMotivosADescuadres`).
   */
  async justificarDiferencias(
    tenantId: string,
    cajaId: string,
    lineas: {
      metodoPagoId: string | null;
      motivoDiferenciaId?: string;
      comentarioDiferencia?: string;
    }[],
  ): Promise<{ ciego: boolean; lineas: LineaArqueo[] }> {
    await this.db.transaccion(async (manager) => {
      const caja = await manager.findOne(Caja, {
        where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
      });
      if (!caja) throw new NotFoundException('Caja no encontrada');
      if (caja.estado !== 'cerrada') {
        throw new BadRequestException('La caja no está cerrada');
      }

      await this.aplicarMotivosADescuadres(manager, tenantId, cajaId, lineas);
    });
    // Relectura con el arqueo revelado (ciego:false, caja cerrada). `tieneVerTodas`
    // en true porque el llamador ya pasó TenantAdminGuard; verificarAccesoCaja no
    // exige owner en ese caso, así que usuarioId no se usa en esta rama.
    return this.obtenerArqueo(tenantId, '', cajaId, true);
  }

  /**
   * Fase 1 del cierre en dos fases: congela el arqueo (esperado recomputado
   * server-side + contado declarado + diferencia). Owner-o-encargado (el
   * controller resuelve `puedeForzar` vía `resolverEscrituraCompartida`,
   * mismo criterio que `cerrar`): el dueño siempre puede; quien tiene
   * `Cajas:Actualizar` puede además forzar el cierre de la caja de OTRO
   * cajero (`esForzado = caja.usuarioId !== usuarioId`) — decisión del owner
   * 2026-08-11, para no dejar la caja de un cajero ausente abierta para
   * siempre, ampliada el 2026-08-13: forzar dejó de exigir ser admin del
   * tenant (era una incoherencia con pedir la firma, ya operativo desde la
   * Task 6) y pasó a ser `Cajas:Actualizar` — el admin lo conserva por el
   * short-circuit de rol fijo. Congela también quién contó
   * (`cerradaPor = usuarioId`) y cuántos garzones había en turno en ese
   * momento (`testigosDisponibles`).
   *
   * Bifurca según cuadre y forzado:
   *   - Sin descuadre y SIN forzar → auto-cierre (`estado: 'cerrada'`,
   *     `fechaCierre` fijada). No requiere fase 2.
   *   - Con descuadre, O forzado aunque cuadre → `estado: 'en_conciliacion'`,
   *     sin `fechaCierre`. Un forzado pasa por acá SIEMPRE, cuadre o no: es
   *     donde vive la solicitud de testigo. La fase 2 (`cerrar`) resuelve la
   *     conciliación.
   */
  async enviarConteo(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    dto: CerrarCajaDto,
    puedeForzar = false,
  ): Promise<{ estado: 'cerrada' | 'en_conciliacion'; arqueo: LineaArqueo[] }> {
    return this.db.transaccion(async (manager) => {
      await this.bloquearCajaAbierta(manager, cajaId, tenantId);

      const caja = await manager.findOne(Caja, {
        where: {
          id: cajaId,
          tenantId,
          estado: 'abierta',
          eliminadoEl: IsNull(),
        },
      });
      if (!caja) {
        throw new ForbiddenException('Caja no encontrada o no está abierta');
      }
      // Cierre forzado (decisión del owner 2026-08-11, ampliada 2026-08-13): quien
      // tiene `Cajas:Actualizar` puede cerrar la caja de otro. Sin esto, un cajero
      // que se va deja su caja abierta para siempre y —por
      // `ux_cajas_activa_por_usuario`— no puede volver a abrir ninguna. El dueño
      // sigue siendo el único sin `Cajas:Actualizar` que puede.
      const esForzado = caja.usuarioId !== usuarioId;
      if (esForzado && !puedeForzar) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }

      // Esperado recomputado y CONGELADO server-side (nunca viene del cliente).
      const arqueo = await this.calcularArqueo(cajaId, tenantId, manager);

      // Contado declarado, por clave de línea.
      const claveDe = (id: string | null) => id ?? 'EFECTIVO';
      const contadoPorClave = new Map<string, string>();
      for (const linea of dto.lineas) {
        contadoPorClave.set(claveDe(linea.metodoPagoId), linea.montoContado);
      }

      // Ninguna línea del DTO puede ser ajena al arqueo recomputado.
      const clavesArqueo = new Set(arqueo.map((l) => claveDe(l.metodoPagoId)));
      for (const clave of contadoPorClave.keys()) {
        if (!clavesArqueo.has(clave)) {
          throw new BadRequestException(
            'Método de pago no pertenece al arqueo',
          );
        }
      }

      // Resolver contado/diferencia + validar obligatorias.
      const lineasResueltas = arqueo.map((l) => {
        const clave = claveDe(l.metodoPagoId);
        const contadoRaw = contadoPorClave.get(clave);
        const obligatoria = l.esEfectivo || l.requiereConteo;
        if (obligatoria && contadoRaw === undefined) {
          throw new BadRequestException(`Falta el conteo de ${l.nombre}`);
        }
        const contado =
          contadoRaw === undefined ? null : new Decimal(contadoRaw).toFixed(4);
        const diferencia =
          contado === null
            ? null
            : new Decimal(contado).minus(l.esperado!).toFixed(4);
        return { ...l, contado, diferencia };
      });

      // Congelar todas las líneas.
      await manager.save(
        CajaArqueoMedio,
        lineasResueltas.map((l) =>
          manager.create(CajaArqueoMedio, {
            cajaId,
            tenantId,
            metodoPagoId: l.metodoPagoId,
            esEfectivo: l.esEfectivo,
            esperado: l.esperado!,
            contado: l.contado,
            diferencia: l.diferencia,
          }),
        ),
      );

      // Agregados de cajas = línea de efectivo (cuadre del cajón físico).
      const efectivo = lineasResueltas.find((l) => l.metodoPagoId === null)!;
      caja.saldoFinal = efectivo.esperado;
      caja.montoContado = contadoPorClave.get('EFECTIVO')!; // obligatoria → presente
      caja.diferencia = efectivo.diferencia;
      // Columna separada de `caja.comentario` (el de la APERTURA, `abrir`):
      // esta fase nunca la toca. Ver el docblock de `comentarioCierre` en la
      // entidad para el porqué de la separación.
      caja.comentarioCierre = dto.comentario ?? null;

      // Se guarda SIEMPRE, no solo en el forzado: "forzado" se deriva de
      // `cerrada_por <> usuario_id`. Un flag podría contradecir a los datos.
      caja.cerradaPor = usuarioId;
      // Congelado acá y no consultado después: más tarde daría otro número.
      // Cuenta sesiones abiertas, que es lo único que el sistema sabe de "quién
      // está en turno" (los usuarios no tienen sesión de turno). Corre con
      // `manager` (la transacción en curso, con el `FOR UPDATE` de
      // `bloquearCajaAbierta` todavía vivo) explícito, documentando a simple
      // vista el alcance del lock sin depender de que el lector sepa que hay
      // un ALS activo — NO con `listarAbiertas`, que hoy resuelve el manager
      // del contexto vía `this.db.query` pero está pensado para leer fuera de
      // cualquier transacción (ver docblock de `contarAbiertas`).
      caja.testigosDisponibles =
        await this.sesionesGarzonService.contarAbiertas(manager, tenantId);

      // Bifurcación fase 1: cualquier línea descuadrada, o un cierre forzado
      // (aunque cuadre) → conciliación pendiente (fase 2 la resuelve); todo
      // cuadrado en un cierre normal → auto-cierre.
      const hayDescuadre = lineasResueltas.some(
        (l) => l.diferencia !== null && !new Decimal(l.diferencia).isZero(),
      );
      // Un cierre forzado pasa por la ventana de conciliación AUNQUE CUADRE: es
      // donde viven las solicitudes de testigo. Sin esto, una caja forzada que
      // cuadra se auto-cerraría y no habría dónde poner la firma.
      if (hayDescuadre || esForzado) {
        caja.estado = 'en_conciliacion';
        caja.fechaCierre = null;
      } else {
        caja.estado = 'cerrada';
        caja.fechaCierre = new Date();
      }
      await manager.save(Caja, caja);

      return {
        estado: caja.estado as 'cerrada' | 'en_conciliacion',
        arqueo: lineasResueltas,
      };
    });
  }

  /**
   * Fase 2 del cierre en dos fases: finaliza una caja `en_conciliacion`.
   * Owner-o-encargado (el controller resuelve `puedeForzar` vía
   * `resolverEscrituraCompartida`, mismo criterio que `enviarConteo`). Aplica
   * los motivos a las líneas descuadradas (mismo enforcement que el
   * override, vía `aplicarMotivosADescuadres`) y solo entonces pasa a
   * `cerrada` + `fechaCierre`. NO recalcula ni toca esperado/contado/
   * diferencia: esas quedaron congeladas por `enviarConteo` (fase 1). Si
   * falta un motivo, el helper lanza 400 y la transacción no finaliza — la
   * caja sigue `en_conciliacion`.
   */
  async cerrar(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    puedeForzar: boolean,
    dto: FinalizarCierreDto,
  ): Promise<{ caja: Caja; arqueo: LineaArqueo[] }> {
    const caja = await this.db.transaccion(async (manager) => {
      await this.bloquearCajaEnConciliacion(manager, cajaId, tenantId);
      const caja = await manager.findOne(Caja, {
        where: {
          id: cajaId,
          tenantId,
          estado: 'en_conciliacion',
          eliminadoEl: IsNull(),
        },
      });
      if (!caja)
        throw new BadRequestException('La caja no está en conciliación');
      if (caja.usuarioId !== usuarioId && !puedeForzar) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }
      await this.aplicarMotivosADescuadres(
        manager,
        tenantId,
        cajaId,
        dto.lineas,
      );

      // El comentario se exige ACÁ y no en el conteo (fase 1) porque al
      // congelar el conteo todavía no había firmas —se piden después—:
      // "nadie firmó" solo se sabe al cerrar. `cerradaPor` se llena SIEMPRE
      // en `enviarConteo` para cualquier caja que llegó a `en_conciliacion`,
      // así que "forzado" se deriva comparándolo contra el dueño de la caja,
      // en vez de un flag aparte que podría contradecir a los datos.
      //
      // La comparación es fail-closed a propósito: si `cerradaPor` viniera
      // ausente (`null`/`undefined` — hoy inalcanzable, pero un `select`
      // parcial que se agregue a futuro en este `findOne` podría producirlo
      // sin que ningún test lo note), se trata como forzado. El objetivo del
      // control es "exigí una explicación"; ante un dato que falta, el
      // default seguro es exigirla, no perdonarla.
      const esForzado =
        caja.cerradaPor == null || caja.cerradaPor !== caja.usuarioId;
      if (
        esForzado &&
        !(await this.cajaTestigoService.hayFirmaDe(manager, tenantId, cajaId))
      ) {
        // El comentario de la fase 1 (`enviarConteo`, ya persistido en
        // `caja.comentarioCierre` — columna separada de `caja.comentario`,
        // que es el de la APERTURA y esta fase nunca toca, ver el docblock
        // de la entidad) alcanza como explicación: decisión del owner
        // 2026-08-12, es el mismo hecho, contado en el momento en que
        // ocurrió. Sin este fallback, un cierre forzado sin testigo no se
        // podría completar desde la pantalla hasta que la fase 2 del
        // frontend agregue el campo (Task 6) — y como el push a `main`
        // despliega, quedaría roto en producción mientras tanto.
        const explicacion =
          dto.comentario?.trim() || caja.comentarioCierre?.trim();
        if (!explicacion) {
          throw new BadRequestException(
            'Un cierre sin testigo requiere un comentario que explique qué pasó',
          );
        }
      }
      // Si esta fase trae comentario, actualiza `comentarioCierre` — las dos
      // fases son el mismo proceso de cierre, así que fase 2 SÍ puede
      // refinar/reemplazar lo que dejó fase 1 acá. Lo que nunca toca es
      // `caja.comentario` (la apertura): antes de esto compartían columna y
      // `enviarConteo` pisaba el de apertura sin dejar rastro
      // (`docs/agent/resueltos.md`).
      if (dto.comentario?.trim()) {
        caja.comentarioCierre = dto.comentario.trim();
      }

      // Las solicitudes que quedaron con el conteo congelado se resuelven
      // acá, no cuelgan para siempre: firmar o rechazar contra una caja ya
      // cerrada no tiene sentido — la firma se pide sobre números que dejan
      // de existir en cuanto la caja pasa a `cerrada`.
      await this.cajaTestigoService.cancelarPendientes(
        manager,
        tenantId,
        cajaId,
      );

      caja.estado = 'cerrada';
      caja.fechaCierre = new Date();
      await manager.save(Caja, caja);
      return caja;
    });
    const { lineas } = await this.obtenerArqueo(
      tenantId,
      usuarioId,
      cajaId,
      true,
    );
    return { caja, arqueo: lineas };
  }

  async registrarMovimientoEnTransaccion(
    manager: EntityManager,
    params: {
      cajaId: string;
      tipo: string;
      concepto: string;
      monto: string;
      referencia?: string | null;
      ventaId?: string | null;
      pagoId?: string | null;
      metodoPagoId?: string | null;
    },
  ): Promise<MovimientoCaja> {
    // El signo lo codifica `tipo`, nunca `monto`: una "entrada" negativa RESTA
    // del esperado (`SUM(monto) FILTER (WHERE tipo='entrada')`). El endpoint HTTP
    // ya lo validaba por DTO, pero este método —el que usan ventas y pagos— es
    // por donde entró el bug del vuelto, y no tenía guard propio.
    //
    // Rechaza NEGATIVOS, no el cero: un pago devuelto íntegro como vuelto deja
    // un neto de 0 y es una venta legítima (`pagos.service.ts`, monto − vuelto).
    // El movimiento en cero no altera el esperado y conserva la traza del pago.
    // Exigir `> 0` acá tumbaba esa venta entera con 422.
    if (new Decimal(params.monto).lt(0)) {
      throw new UnprocessableEntityException(
        'El monto de un movimiento de caja no puede ser negativo',
      );
    }
    const movimiento = manager.create(MovimientoCaja, {
      cajaId: params.cajaId,
      tipo: params.tipo,
      concepto: params.concepto,
      monto: params.monto,
      referencia: params.referencia ?? null,
      ventaId: params.ventaId ?? null,
      pagoId: params.pagoId ?? null,
      metodoPagoId: params.metodoPagoId ?? null,
    });
    return manager.save(MovimientoCaja, movimiento);
  }

  async registrarMovimiento(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    dto: CrearMovimientoDto,
  ): Promise<MovimientoCaja> {
    return this.db.transaccion(async (manager) => {
      await this.bloquearCajaAbierta(manager, cajaId, tenantId);

      const caja = await manager.findOne(Caja, {
        where: {
          id: cajaId,
          tenantId,
          estado: 'abierta',
          eliminadoEl: IsNull(),
        },
      });

      if (!caja) {
        throw new ForbiddenException('Caja no encontrada o no está abierta');
      }

      if (caja.usuarioId !== usuarioId) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }

      const esperadoEfectivo = await this.calcularEsperadoEfectivo(
        cajaId,
        manager,
      );

      if (
        dto.tipo === 'salida' &&
        new Decimal(esperadoEfectivo).minus(dto.monto).lt(0)
      ) {
        throw new UnprocessableEntityException('Saldo insuficiente en caja');
      }

      return this.registrarMovimientoEnTransaccion(manager, {
        cajaId,
        tipo: dto.tipo,
        concepto: dto.concepto,
        monto: dto.monto,
        referencia: dto.referencia,
      });
    });
  }

  async historial(
    tenantId: string,
    usuarioId: string,
    query: QueryHistorialCajaDto,
    tieneVerTodas: boolean,
  ): Promise<PaginatedResponse<CajaHistorialItem>> {
    if (query.usuarioId && query.usuarioId !== usuarioId && !tieneVerTodas) {
      throw new ForbiddenException(
        'No tienes acceso al historial de este usuario',
      );
    }

    const { page, pageSize, offset } = resolvePagination(query);
    const { filters, params } = this.buildHistorialFilters(
      tenantId,
      usuarioId,
      query,
      tieneVerTodas,
    );

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM cajas c
       WHERE c.tenant_id = $1
         ${filters}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: {
      caja_id: string;
      tenant_id: string;
      usuario_id: string | null;
      tipo: string;
      estado: string;
      saldo_inicial: string;
      saldo_final: string | null;
      monto_contado: string | null;
      diferencia: string | null;
      diferencia_total: string | null;
      fecha_apertura: Date;
      fecha_cierre: Date | null;
      comentario: string | null;
      cajon_nombre: string | null;
    }[] = await this.db.query(
      `SELECT c.caja_id,
              c.tenant_id,
              c.usuario_id,
              c.tipo,
              c.estado,
              c.saldo_inicial,
              c.saldo_final,
              c.monto_contado,
              c.diferencia,
              arq.diferencia_total,
              c.fecha_apertura,
              c.fecha_cierre,
              c.comentario,
              cj.nombre AS cajon_nombre
       FROM cajas c
       LEFT JOIN cajones cj ON cj.cajon_id = c.cajon_id AND cj.eliminado_el IS NULL
       -- Lateral y no un JOIN + GROUP BY: una sola query para todas las filas
       -- (sin N+1) y sin agrupar por las 13 columnas de arriba. Una caja abierta
       -- todavía no tiene arqueo congelado → NULL, que el front muestra como "—".
       LEFT JOIN LATERAL (
         SELECT SUM(am.diferencia) AS diferencia_total
           FROM caja_arqueo_medio am
          WHERE am.caja_id = c.caja_id AND am.eliminado_el IS NULL
       ) arq ON TRUE
       WHERE c.tenant_id = $1
         ${filters}
       ORDER BY c.fecha_apertura DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => this.mapCajaHistorialRow(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private buildHistorialFilters(
    tenantId: string,
    currentUserId: string,
    query: QueryHistorialCajaDto,
    tieneVerTodas: boolean,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let paramIdx = 2;
    let filters = ` AND c.tipo = 'fisica' AND c.eliminado_el IS NULL`;

    if (query.usuarioId) {
      filters += ` AND c.usuario_id = $${paramIdx++}`;
      params.push(query.usuarioId);
    } else if (query.cajonId && tieneVerTodas) {
      // Historial del cajón (supervisión): sin restricción por usuario.
    } else if (!query.todas || !tieneVerTodas) {
      filters += ` AND c.usuario_id = $${paramIdx++}`;
      params.push(currentUserId);
    }

    if (query.cajonId) {
      filters += ` AND c.cajon_id = $${paramIdx++}`;
      params.push(query.cajonId);
    }

    return { filters, params };
  }

  private mapCajaHistorialRow(r: {
    caja_id: string;
    tenant_id: string;
    usuario_id: string | null;
    tipo: string;
    estado: string;
    saldo_inicial: string;
    saldo_final: string | null;
    monto_contado: string | null;
    diferencia: string | null;
    diferencia_total?: string | null;
    fecha_apertura: Date;
    fecha_cierre: Date | null;
    comentario: string | null;
    cajon_nombre: string | null;
  }): CajaHistorialItem {
    return {
      id: r.caja_id,
      tenantId: r.tenant_id,
      usuarioId: r.usuario_id,
      tipo: r.tipo,
      estado: r.estado,
      saldoInicial: new Decimal(r.saldo_inicial).toFixed(4),
      saldoFinal: r.saldo_final ? new Decimal(r.saldo_final).toFixed(4) : null,
      montoContado: r.monto_contado
        ? new Decimal(r.monto_contado).toFixed(4)
        : null,
      diferencia: r.diferencia ? new Decimal(r.diferencia).toFixed(4) : null,
      diferenciaTotal:
        r.diferencia_total != null
          ? new Decimal(r.diferencia_total).toFixed(4)
          : null,
      fechaApertura: r.fecha_apertura,
      fechaCierre: r.fecha_cierre,
      comentario: r.comentario,
      cajonNombre: r.cajon_nombre,
    };
  }

  /**
   * Tendencia de descuadres por cajero, sobre una ventana de fechas. Lectura de
   * supervisión (`Cajas:Leer`): el cajero NO ve la propia —decisión del owner
   * 2026-08-22—, porque mostrarle su sesgo acumulado le entrega la calibración
   * ya calculada.
   *
   * **La señal es el sesgo, no la magnitud.** El cajero de la caja más cargada
   * va a tener más varianza siempre y no por eso es sospechoso; lo que delata es
   * descuadrar SIEMPRE para el mismo lado. Por eso la fila devuelve la suma con
   * signo más los conteos de faltante/sobrante/cuadrado, y NO un promedio: un
   * promedio de dinero es una división de dinero, y eso arrastraría la
   * cuantización por moneda a un reporte para decir lo que "18 de 20 para abajo"
   * ya dice.
   *
   * **Efectivo y resto van separados, nunca sumados en una cifra.** El robo vive
   * en el efectivo (una tarjeta no se guarda en el bolsillo), así que mezclar
   * medios le mete a la señal el ruido de la conciliación de tarjeta. Pero
   * mostrar SOLO el efectivo ya fue un bug acá: `CajaHistorial.vue` documenta que
   * con la columna sobre `diferencia` una caja cerrada con -500 en tarjeta se
   * veía como "+0" en la lista y como "-500" al abrir el detalle. Las dos
   * columnas, entonces.
   *
   * Una sola query agregada: `GROUP BY` por cajero, sin una consulta por fila.
   */
  async tendenciaDescuadres(
    tenantId: string,
    query: QueryTendenciaDescuadresDto,
  ): Promise<TendenciaDescuadresItem[]> {
    // Solo si hay borde de fecha que expandir: ver `rango-fecha.util.ts`.
    const zona = requiereZonaTenant(query.desde, query.hasta)
      ? await zonaHorariaTenant(this.db, tenantId)
      : null;

    const params: unknown[] = [tenantId];
    let idxZona = 0;
    if (zona != null) {
      params.push(zona);
      idxZona = params.length;
    }

    let filtros = '';
    if (query.desde) {
      params.push(query.desde);
      filtros += bordeFechaSql(
        COLUMNA_VENTANA,
        '>=',
        query.desde,
        params.length,
        idxZona,
      );
    }
    if (query.hasta) {
      params.push(query.hasta);
      filtros += bordeHastaSql(
        COLUMNA_VENTANA,
        query.hasta,
        params.length,
        idxZona,
      );
    }

    const rows: TendenciaDescuadresRow[] = await this.db.query(
      // `c.diferencia IS NOT NULL` en vez de enumerar estados: significa
      // exactamente "el conteo se congeló", que es la condición que importa, y
      // sobrevive a que mañana se agregue un estado nuevo. Incluye `cerrada` y
      // `en_conciliacion` —en las dos el descuadre ya ocurrió—, y deja afuera la
      // caja abierta, donde todavía es NULL.
      //
      // La fila se atribuye a `c.usuario_id` (el DUEÑO del turno) y no a
      // `cerrada_por`: en un cierre forzado el encargado contó, pero el
      // descuadre es del turno de quien lo trabajó.
      `SELECT c.usuario_id,
              u.nombre   AS usuario_nombre,
              u.apellido AS usuario_apellido,
              COUNT(*)::int AS cierres,
              COALESCE(SUM(c.diferencia), 0)::text AS efectivo_suma,
              COALESCE(SUM(COALESCE(arq.diferencia_total, c.diferencia) - c.diferencia), 0)::text
                AS otros_medios_suma,
              COUNT(*) FILTER (WHERE c.diferencia < 0)::int AS con_faltante,
              COUNT(*) FILTER (WHERE c.diferencia > 0)::int AS con_sobrante,
              COUNT(*) FILTER (WHERE c.diferencia = 0)::int AS cuadrados
         FROM cajas c
         -- LEFT JOIN, no INNER: un cajero dado de baja pierde el nombre pero sus
         -- cierres YA OCURRIERON y no se pueden caer del informe. Mismo criterio
         -- que el ítem borrado en el informe de mermas.
         LEFT JOIN usuarios u ON u.usuario_id = c.usuario_id
                AND u.eliminado_el IS NULL
         -- Lateral y no un JOIN + GROUP BY: idéntico al de historial, para no
         -- multiplicar la fila de la caja por sus líneas de arqueo.
         LEFT JOIN LATERAL (
           SELECT SUM(am.diferencia) AS diferencia_total
             FROM caja_arqueo_medio am
            WHERE am.caja_id = c.caja_id AND am.eliminado_el IS NULL
         ) arq ON TRUE
        WHERE c.tenant_id = $1
          AND c.tipo = 'fisica'
          AND c.eliminado_el IS NULL
          AND c.diferencia IS NOT NULL
          ${filtros}
        GROUP BY c.usuario_id, u.nombre, u.apellido
        -- Desempate por usuario: sin él, dos cajeros con la misma suma (el caso
        -- común, todos en cero) salen en orden no determinista entre requests.
        ORDER BY SUM(c.diferencia) ASC, c.usuario_id ASC`,
      params,
    );

    return rows.map((r) => ({
      usuarioId: r.usuario_id,
      usuarioNombre:
        [r.usuario_nombre, r.usuario_apellido]
          .filter((p): p is string => Boolean(p))
          .join(' ')
          .trim() || 'Sin usuario',
      cierres: r.cierres,
      // Normalizado a la escala 4 como hace `mapCajaHistorialRow`, y no
      // devuelto crudo: así la forma del string la decide el código y no lo que
      // emita el driver. (Los dos `COALESCE(...,0)` de la query son hoy
      // inalcanzables —`diferencia IS NOT NULL` garantiza que ningún `SUM` dé
      // NULL, y `GROUP BY` no produce grupos vacíos—, así que la consistencia
      // con su vecino es la única razón de esta línea, no un caso borde real.)
      efectivoSuma: new Decimal(r.efectivo_suma).toFixed(4),
      otrosMediosSuma: new Decimal(r.otros_medios_suma).toFixed(4),
      conFaltante: r.con_faltante,
      conSobrante: r.con_sobrante,
      cuadrados: r.cuadrados,
    }));
  }

  /**
   * Grilla de supervisión de cajones. En modo ciego, con la caja `abierta`,
   * RETIENE el `saldoEsperado` (null) para quien no sea admin del tenant —
   * misma regla que `obtenerArqueo`/`resumenMovimientos`/`listarMovimientos`.
   * Sin eso esta grilla era la puerta de atrás del cierre ciego: el supervisor
   * con `Cajas:Leer` leía acá el número que el arqueo le retiene.
   */
  async cajonesEstado(
    tenantId: string,
    usuarioId: string,
    esAdmin = false,
  ): Promise<CajonEstado[]> {
    const rows: {
      cajon_id: string;
      nombre: string;
      caja_id: string | null;
      estado: string | null;
      usuario_id: string | null;
      usuario_nombre: string | null;
      usuario_apellido: string | null;
      saldo_inicial: string | null;
      fecha_apertura: Date | null;
      total_entradas: string | null;
      total_salidas: string | null;
    }[] = await this.db.query(
      `SELECT cj.cajon_id,
              cj.nombre,
              c.caja_id,
              c.estado,
              c.usuario_id,
              u.nombre   AS usuario_nombre,
              u.apellido AS usuario_apellido,
              c.saldo_inicial,
              c.fecha_apertura,
              SUM(m.monto) FILTER (WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL) AS total_entradas,
              SUM(m.monto) FILTER (WHERE m.tipo = 'salida'  AND m.eliminado_el IS NULL) AS total_salidas
       FROM cajones cj
       LEFT JOIN cajas c
              ON c.cajon_id = cj.cajon_id
             AND c.tipo = 'fisica'
             AND c.estado IN ('abierta', 'en_conciliacion')
             AND c.eliminado_el IS NULL
       LEFT JOIN usuarios u ON u.usuario_id = c.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       WHERE cj.tenant_id = $1
         AND cj.activo = true
         AND cj.eliminado_el IS NULL
       GROUP BY cj.cajon_id, cj.nombre, c.caja_id, c.estado, c.usuario_id, u.nombre, u.apellido,
                c.saldo_inicial, c.fecha_apertura
       ORDER BY cj.nombre ASC`,
      [tenantId],
    );

    const ciego = !esAdmin && (await this.getArqueoCiego(tenantId));

    return rows.map((r) => {
      if (!r.caja_id) {
        return { cajonId: r.cajon_id, nombre: r.nombre, sesion: null };
      }
      // El ciego solo retiene mientras la caja está `abierta`; en
      // `en_conciliacion` el conteo ya se congeló y el esperado está revelado.
      const saldoEsperado =
        ciego && r.estado === 'abierta'
          ? null
          : new Decimal(r.saldo_inicial ?? '0')
              .plus(r.total_entradas ?? '0')
              .minus(r.total_salidas ?? '0')
              .toFixed(4);
      const usuarioNombre =
        [r.usuario_nombre, r.usuario_apellido]
          .filter((p): p is string => Boolean(p))
          .join(' ')
          .trim() || 'Sin usuario';
      return {
        cajonId: r.cajon_id,
        nombre: r.nombre,
        sesion: {
          cajaId: r.caja_id,
          usuarioId: r.usuario_id,
          usuarioNombre,
          saldoInicial: new Decimal(r.saldo_inicial ?? '0').toFixed(4),
          saldoEsperado,
          fechaApertura: r.fecha_apertura as Date,
          esPropia: r.usuario_id === usuarioId,
        },
      };
    });
  }

  async findOne(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas: boolean,
  ): Promise<
    Caja & { cajonNombre: string | null; usuarioNombre: string | null }
  > {
    const caja = await this.cajaRepo.findOne({
      where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
    });
    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }
    if (caja.usuarioId !== usuarioId && !tieneVerTodas) {
      throw new ForbiddenException('No tienes acceso a esta caja');
    }
    // El detalle expone el nombre del cajón (el header lo muestra) y el del
    // cajero dueño — lo necesita el encargado antes de forzar el cierre de la
    // caja de otro (Task 6, testigo-cierre-forzado): tiene que ver de quién es
    // la caja y desde cuándo antes de tocar el conteo. La entidad solo guarda
    // los IDs; una sola query liviana resuelve los dos (nunca un N+1: una fila
    // por request, no una consulta por caja en una lista).
    let cajonNombre: string | null = null;
    let usuarioNombre: string | null = null;
    if (caja.cajonId || caja.usuarioId) {
      const rows: {
        cajon_nombre: string | null;
        usuario_nombre: string | null;
        usuario_apellido: string | null;
      }[] = await this.db.query(
        `SELECT cj.nombre AS cajon_nombre, u.nombre AS usuario_nombre, u.apellido AS usuario_apellido
           FROM (SELECT $1::uuid AS cajon_id, $2::uuid AS usuario_id) x
           LEFT JOIN cajones cj ON cj.cajon_id = x.cajon_id
                  AND cj.tenant_id = $3 AND cj.eliminado_el IS NULL
           LEFT JOIN usuarios u ON u.usuario_id = x.usuario_id
                  AND u.eliminado_el IS NULL`,
        [caja.cajonId, caja.usuarioId, tenantId],
      );
      cajonNombre = rows[0]?.cajon_nombre ?? null;
      usuarioNombre =
        [rows[0]?.usuario_nombre, rows[0]?.usuario_apellido]
          .filter((p): p is string => Boolean(p))
          .join(' ')
          .trim() || null;
    }
    return { ...caja, cajonNombre, usuarioNombre };
  }

  async resumenMovimientos(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas = false,
    esAdmin = false,
  ): Promise<CajaTurnoResumen> {
    await this.verificarAccesoCaja(tenantId, usuarioId, cajaId, tieneVerTodas);

    const rows: {
      saldo_inicial: string;
      estado: string;
      total_entradas: string;
      total_salidas: string;
      total_movimientos: number;
    }[] = await this.db.query(
      `SELECT c.saldo_inicial,
              c.estado,
              COALESCE(SUM(m.monto) FILTER (
                WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL
              ), 0)::text AS total_entradas,
              COALESCE(SUM(m.monto) FILTER (
                WHERE m.tipo = 'salida' AND m.eliminado_el IS NULL
              ), 0)::text AS total_salidas,
              COUNT(m.movimiento_id) FILTER (
                WHERE m.eliminado_el IS NULL
              )::int AS total_movimientos
       FROM cajas c
       LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
       WHERE c.caja_id = $1
         AND c.tenant_id = $2
         AND c.eliminado_el IS NULL
       GROUP BY c.saldo_inicial, c.estado`,
      [cajaId, tenantId],
    );

    const row = rows[0];
    const saldoInicial = new Decimal(row?.saldo_inicial ?? '0');
    const estado = row?.estado ?? 'abierta';

    // Gating espejo de obtenerArqueo: ciego solo mientras la caja está abierta y
    // solo para no-admin (§3.4). Para un admin/superadmin se cortocircuita antes
    // de getArqueoCiego (una sola query por request; sin N+1).
    const ciego =
      !esAdmin && estado === 'abierta' && (await this.getArqueoCiego(tenantId));
    if (ciego) {
      return {
        ciego: true,
        saldoInicial: saldoInicial.toFixed(4),
        totalEntradas: null,
        totalSalidas: null,
        saldoEsperado: null,
        totalMovimientos: null,
      };
    }

    const totalEntradas = new Decimal(row?.total_entradas ?? '0');
    const totalSalidas = new Decimal(row?.total_salidas ?? '0');
    return {
      ciego: false,
      saldoInicial: saldoInicial.toFixed(4),
      totalEntradas: totalEntradas.toFixed(4),
      totalSalidas: totalSalidas.toFixed(4),
      saldoEsperado: saldoInicial
        .plus(totalEntradas)
        .minus(totalSalidas)
        .toFixed(4),
      totalMovimientos: row?.total_movimientos ?? 0,
    };
  }

  async listarMovimientos(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    query: QueryMovimientosCajaDto,
    tieneVerTodas = false,
    esAdmin = false,
  ): Promise<PaginatedResponse<MovimientoCajaListItem>> {
    const caja = await this.verificarAccesoCaja(
      tenantId,
      usuarioId,
      cajaId,
      tieneVerTodas,
    );

    // Ciego + abierta: el operador no-admin no recibe montos por ningún camino (ni
    // devtools). El admin/superadmin sí (§3.4). Se corta antes de la query de filas;
    // para un admin se cortocircuita antes de getArqueoCiego (sin N+1).
    if (
      !esAdmin &&
      caja.estado === 'abierta' &&
      (await this.getArqueoCiego(tenantId))
    ) {
      const { page, pageSize } = resolvePagination(query);
      return { data: [], meta: buildPaginationMeta(page, pageSize, 0) };
    }

    const { page, pageSize, offset } = resolvePagination(query);
    const { filters, params } = this.buildMovimientosFilters(cajaId, query);

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM movimientos_caja m
       WHERE m.caja_id = $1
         AND m.eliminado_el IS NULL
         ${filters}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: {
      movimiento_id: string;
      caja_id: string;
      tipo: string;
      concepto: string;
      monto: string;
      referencia: string | null;
      fecha: Date;
      venta_id: string | null;
    }[] = await this.db.query(
      `SELECT m.movimiento_id,
              m.caja_id,
              m.tipo,
              m.concepto,
              m.monto,
              m.referencia,
              m.fecha,
              m.venta_id
       FROM movimientos_caja m
       WHERE m.caja_id = $1
         AND m.eliminado_el IS NULL
         ${filters}
       ORDER BY m.fecha ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => ({
        id: r.movimiento_id,
        cajaId: r.caja_id,
        tipo: r.tipo,
        concepto: r.concepto,
        monto: new Decimal(r.monto).toFixed(4),
        referencia: r.referencia,
        fecha: r.fecha,
        ventaId: r.venta_id,
      })),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private async verificarAccesoCaja(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    tieneVerTodas: boolean,
  ): Promise<Caja> {
    const caja = await this.cajaRepo.findOne({
      where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    if (caja.usuarioId !== usuarioId && !tieneVerTodas) {
      throw new ForbiddenException('No tienes acceso a esta caja');
    }

    return caja;
  }

  private buildMovimientosFilters(
    cajaId: string,
    query: QueryMovimientosCajaDto,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [cajaId];
    let paramIdx = 2;
    let filters = '';

    if (query.tipo) {
      filters += ` AND m.tipo = $${paramIdx++}`;
      params.push(query.tipo);
    }

    return { filters, params };
  }
}
