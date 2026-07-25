import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import Decimal from 'decimal.js';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import { CajaArqueoMedio } from './entities/caja-arqueo-medio.entity';
import { MotivosDiferenciaService } from '../motivos-diferencia/motivos-diferencia.service';
import type { AbrirCajaDto } from './dto/abrir-caja.dto';
import type { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import type { CerrarCajaDto } from './dto/cerrar-caja.dto';
import type { FinalizarCierreDto } from './dto/finalizar-cierre.dto';
import type { QueryMovimientosCajaDto } from './dto/query-movimientos-caja.dto';
import type { QueryHistorialCajaDto } from './dto/query-historial-caja.dto';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';

export interface CajonEstado {
  cajonId: string;
  nombre: string;
  sesion: {
    cajaId: string;
    usuarioId: string | null;
    usuarioNombre: string;
    saldoInicial: string;
    saldoEsperado: string;
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

export interface CajaHistorialItem {
  id: string;
  tenantId: string;
  usuarioId: string | null;
  tipo: string;
  estado: string;
  saldoInicial: string;
  saldoFinal: string | null;
  montoContado: string | null;
  diferencia: string | null;
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
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly motivosService: MotivosDiferenciaService,
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
    const rows: { cajon_id: string; nombre: string }[] =
      await this.dataSource.query(
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
      return await this.dataSource.transaction(async (manager) => {
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
      // Backstop de concurrencia: dos aperturas simultáneas sobre el mismo cajón
      // → una viola el índice único parcial (23505).
      if (
        e instanceof QueryFailedError &&
        (e as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('El cajón ya tiene una caja abierta');
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
    const rows: { arqueo_ciego: boolean }[] = await this.dataSource.query(
      `SELECT arqueo_ciego FROM tenants
        WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [tenantId],
    );
    return rows[0]?.arqueo_ciego ?? false;
  }

  async setArqueoCiego(tenantId: string, valor: boolean): Promise<void> {
    await this.dataSource.query(
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
      const lineas = await this.dataSource.transaction((manager) =>
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
    }[] = await this.dataSource.query(
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
    const difPorClave = new Map(
      filas.map((f) => [claveDe(f.metodo_pago_id), f.diferencia]),
    );
    const hayMotivos = await this.motivosService.hayMotivosActivos(
      manager,
      tenantId,
    );
    for (const l of lineas) {
      const clave = claveDe(l.metodoPagoId);
      const dif = difPorClave.get(clave);
      if (dif == null || new Decimal(dif).isZero()) continue;
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
      await manager.query(
        `UPDATE caja_arqueo_medio SET motivo_diferencia_id = $1, comentario_diferencia = $2
         WHERE caja_id = $3 AND tenant_id = $4
           AND ${l.metodoPagoId === null ? 'metodo_pago_id IS NULL' : 'metodo_pago_id = $5'}
           AND eliminado_el IS NULL`,
        l.metodoPagoId === null
          ? [motivoId, comentarioFinal, cajaId, tenantId]
          : [motivoId, comentarioFinal, cajaId, tenantId, l.metodoPagoId],
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
    await this.dataSource.transaction(async (manager) => {
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
   * server-side + contado declarado + diferencia) exactamente igual que el
   * cierre anterior, y bifurca según cuadre:
   *   - Sin descuadre en ninguna línea → auto-cierre (`estado: 'cerrada'`,
   *     `fechaCierre` fijada). No requiere fase 2.
   *   - Con descuadre en alguna línea → `estado: 'en_conciliacion'`, sin
   *     `fechaCierre`. La fase 2 (Task 3, `cerrar`) resuelve la conciliación.
   */
  async enviarConteo(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    dto: CerrarCajaDto,
  ): Promise<{ estado: 'cerrada' | 'en_conciliacion'; arqueo: LineaArqueo[] }> {
    return this.dataSource.transaction(async (manager) => {
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
      caja.comentario = dto.comentario ?? null;

      // Bifurcación fase 1: cualquier línea descuadrada → conciliación
      // pendiente (fase 2 la resuelve); todo cuadrado → auto-cierre.
      const hayDescuadre = lineasResueltas.some(
        (l) => l.diferencia !== null && !new Decimal(l.diferencia).isZero(),
      );
      if (hayDescuadre) {
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
   * Owner-o-admin (el controller resuelve `esAdmin`). Aplica los motivos a las
   * líneas descuadradas (mismo enforcement que el override, vía
   * `aplicarMotivosADescuadres`) y solo entonces pasa a `cerrada` +
   * `fechaCierre`. NO recalcula ni toca esperado/contado/diferencia: esas
   * quedaron congeladas por `enviarConteo` (fase 1). Si falta un motivo, el
   * helper lanza 400 y la transacción no finaliza — la caja sigue
   * `en_conciliacion`.
   */
  async cerrar(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    esAdmin: boolean,
    dto: FinalizarCierreDto,
  ): Promise<{ caja: Caja; arqueo: LineaArqueo[] }> {
    const caja = await this.dataSource.transaction(async (manager) => {
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
      if (caja.usuarioId !== usuarioId && !esAdmin) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }
      await this.aplicarMotivosADescuadres(
        manager,
        tenantId,
        cajaId,
        dto.lineas,
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
    return this.dataSource.transaction(async (manager) => {
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

    const countRows: { total: number }[] = await this.dataSource.query(
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
      fecha_apertura: Date;
      fecha_cierre: Date | null;
      comentario: string | null;
      cajon_nombre: string | null;
    }[] = await this.dataSource.query(
      `SELECT c.caja_id,
              c.tenant_id,
              c.usuario_id,
              c.tipo,
              c.estado,
              c.saldo_inicial,
              c.saldo_final,
              c.monto_contado,
              c.diferencia,
              c.fecha_apertura,
              c.fecha_cierre,
              c.comentario,
              cj.nombre AS cajon_nombre
       FROM cajas c
       LEFT JOIN cajones cj ON cj.cajon_id = c.cajon_id AND cj.eliminado_el IS NULL
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
      fechaApertura: r.fecha_apertura,
      fechaCierre: r.fecha_cierre,
      comentario: r.comentario,
      cajonNombre: r.cajon_nombre,
    };
  }

  async cajonesEstado(
    tenantId: string,
    usuarioId: string,
  ): Promise<CajonEstado[]> {
    const rows: {
      cajon_id: string;
      nombre: string;
      caja_id: string | null;
      usuario_id: string | null;
      usuario_nombre: string | null;
      usuario_apellido: string | null;
      saldo_inicial: string | null;
      fecha_apertura: Date | null;
      total_entradas: string | null;
      total_salidas: string | null;
    }[] = await this.dataSource.query(
      `SELECT cj.cajon_id,
              cj.nombre,
              c.caja_id,
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
       GROUP BY cj.cajon_id, cj.nombre, c.caja_id, c.usuario_id, u.nombre, u.apellido,
                c.saldo_inicial, c.fecha_apertura
       ORDER BY cj.nombre ASC`,
      [tenantId],
    );

    return rows.map((r) => {
      if (!r.caja_id) {
        return { cajonId: r.cajon_id, nombre: r.nombre, sesion: null };
      }
      const saldoEsperado = new Decimal(r.saldo_inicial ?? '0')
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
  ): Promise<Caja & { cajonNombre: string | null }> {
    const caja = await this.cajaRepo.findOne({
      where: { id: cajaId, tenantId, eliminadoEl: IsNull() },
    });
    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }
    if (caja.usuarioId !== usuarioId && !tieneVerTodas) {
      throw new ForbiddenException('No tienes acceso a esta caja');
    }
    // El detalle expone el nombre del cajón (el header lo muestra). La entidad solo
    // guarda `cajonId`; se resuelve el nombre con una query liviana (una sola por
    // request, solo para cajas físicas). La virtual tiene cajonId null.
    let cajonNombre: string | null = null;
    if (caja.cajonId) {
      const rows: { nombre: string }[] = await this.dataSource.query(
        `SELECT nombre FROM cajones
          WHERE cajon_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [caja.cajonId, tenantId],
      );
      cajonNombre = rows[0]?.nombre ?? null;
    }
    return { ...caja, cajonNombre };
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
    }[] = await this.dataSource.query(
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

    const countRows: { total: number }[] = await this.dataSource.query(
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
    }[] = await this.dataSource.query(
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
