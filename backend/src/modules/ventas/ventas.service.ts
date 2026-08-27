import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import type {
  ConfigCalculo,
  TrazaRegla,
} from '../calculo-precios/calculo-precios.engine';
import { cuantizar } from '../calculo-precios/calculo-precios.engine';
import { CajaService, IntentoRechazadoError } from '../caja/caja.service';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService, type ConvertirUnidad } from '../items/items.service';
import { PagosService, calcularEstadoVenta } from '../pagos/pagos.service';
import { VentaPropinaService } from '../propinas/venta-propina.service';
import { EstrategiaAsignacionPropina } from '../propinas/enums/estrategia-asignacion-propina.enum';
import { PropinaConfiguracion } from '../propinas/entities/propina-configuracion.entity';
import { CatalogService } from '../catalog/catalog.service';
import { GarzonesService } from '../garzones/garzones.service';
import {
  assertPresentacionPareada,
  resolverCantidadDesdePresentacion,
  resolverUnidadBaseDeItem,
} from '../../common/utils/cantidad-presentacion.util';
import type { CreateVentaDto } from './dto/create-venta.dto';
import type { QueryVentasDto } from './dto/query-ventas.dto';
import { Venta, EstadoVenta } from './entities/venta.entity';
import { VentaDetalle } from './entities/venta-detalle.entity';
import { VentaDescuento } from './entities/venta-descuento.entity';
import { VentaRecargo } from './entities/venta-recargo.entity';
import { VentaImpuesto } from './entities/venta-impuesto.entity';
import { VentaPromocion } from './entities/venta-promocion.entity';
import { VentaCustomer } from './entities/venta-customer.entity';
import { TIPO_DOCUMENTO_NC_ID } from './entities/tipo-documento-tributario.entity';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';

/**
 * Reintentos ante deadlock. Dos son suficientes: el deadlock exige que dos
 * ventas se crucen en el mismo instante, y Postgres mata a una de las dos —
 * la que sobrevive libera sus locks al commitear, así que el reintento entra
 * a una BD ya despejada. Un número alto solo alargaría el tiempo hasta
 * devolverle el error a un cajero que está esperando.
 */
const MAX_REINTENTOS_DEADLOCK = 2;

/**
 * `40P01` = `deadlock_detected`. TypeORM envuelve el error del driver en
 * `QueryFailedError`, que copia el `code` del driver pero también lo deja en
 * `driverError`: se miran los dos porque cuál de las dos formas llega depende
 * de dónde se lance, y confundirse acá significa no reintentar nunca.
 */
function esDeadlock(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.code === '40P01' || e?.driverError?.code === '40P01';
}

/** Ítem/cantidad a devolver a stock en un reembolso (solo modo 'cantidad'). */
export interface DevolucionReembolso {
  itemId: string;
  cantidad: string;
}

export interface VentaListItem {
  id: string;
  canal: string;
  estado: string;
  totalFinal: string;
  fecha: Date;
  creadoEl: Date;
  montoPagado: string;
  saldo: string;
  /** Σ REFUND aprobados de las órdenes de pasarela vinculadas (badge derivado). */
  totalReembolsado: string;
  esNotaCredito: boolean;
}

export interface VentasResumen {
  totalVentas: number;
  totalFacturado: string;
  saldoPendiente: string;
}

/**
 * Params de la NC. Con nombre (y no inline en la firma) desde que el cuerpo se
 * partió en dos: `crearNotaCredito` envuelve y `crearNotaCreditoEnTransaccion`
 * ejecuta, y repetir el literal en las dos firmas las deja derivar en silencio.
 */
export interface CrearNotaCreditoParams {
  tenantId: string;
  usuarioId: string;
  ventaOriginalId: string;
  monto: string;
  devoluciones?: DevolucionReembolso[];
  comentario?: string;
  /** Egreso de caja: movimiento 'salida' en la caja física abierta del usuario. */
  devolverDinero?: boolean;
  /** Solo el endpoint manual: exige venta pagada/pagada_parcial y no-NC. */
  validarVentaElegible?: boolean;
}

export interface NotaCreditoCreada {
  id: string;
  totalFinal: string;
  movimientoCajaId: string | null;
  fecha: Date;
  comentario: string | null;
  devoluciones: DevolucionReembolso[];
}

export interface TipoDocumentoResponse {
  id: string;
  nombre: string;
  codigo: string | null;
  customerRequerido: boolean;
}

@Injectable()
export class VentasService {
  constructor(
    private readonly db: Db,
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly cajaService: CajaService,
    private readonly inventarioService: InventarioService,
    private readonly itemsService: ItemsService,
    private readonly pagosService: PagosService,
    private readonly ventaPropinaService: VentaPropinaService,
    private readonly catalogService: CatalogService,
    private readonly garzonesService: GarzonesService,
  ) {}

  /**
   * Reintenta la venta completa ante un deadlock de Postgres (`40P01`).
   *
   * Los `FOR UPDATE` de inventario se toman en un orden que depende de la
   * expansión de cada línea (ingredientes de una receta, componentes de un
   * combo, opciones de grupo). Cada expansión ordena por id, pero el orden
   * GLOBAL de una venta es *(orden de línea) × (orden dentro de la línea)*, y
   * eso no es un orden ascendente global: A vendiendo `RecetaX(ing3, ing5)`
   * bloquea 3→5, mientras que B vendiendo `[RecetaY(ing5), RecetaZ(ing3)]`
   * bloquea 5→3. Ciclo, y Postgres aborta una de las dos.
   *
   * Reintentar es seguro **porque el deadlock aborta la transacción entera**:
   * Postgres revierte todo lo escrito antes de devolver el error, así que no
   * hay venta, ni movimientos, ni pagos, ni movimiento de caja a medio hacer.
   * No es idempotencia —eso es otro tema, ver `pendientes.md`—: acá no hay
   * nada que deduplicar porque no quedó nada.
   *
   * Cubre además los ciclos que no vienen de la expansión (series, lotes,
   * caja). Solo `40P01`: cualquier otro error se propaga sin reintentar, para
   * no convertir un fallo de negocio en tres intentos silenciosos.
   *
   * ⚠️ Precondición: **nunca llamar a `crear()` desde dentro de una
   * transacción ya abierta.** `Db.transaccion` reusa el manager si ya hay uno
   * en contexto (ver `db.service.ts`), así que un `crear()` anidado NO abre
   * una transacción nueva que reintentar — reintentaría sobre la MISMA
   * transacción externa, y si esa transacción abortó (deadlock), los tres
   * intentos fallarían igual con `25P02` ("current transaction is aborted")
   * en vez de un reintento útil. Verificado 2026-08-18: los únicos
   * llamadores son `VentasController` y `OnlineCallbackHandler`, ninguno con
   * transacción envolvente. Un caller que SÍ corre dentro de una transacción
   * (p.ej. `SalonesService`/`SuscripcionesService` al cerrar una cuenta) debe
   * llamar a `crearEnTransaccion(manager, …)` directamente, saltándose este
   * loop — exactamente lo que hacen hoy.
   */
  async crear(tenantId: string, usuarioId: string, dto: CreateVentaDto) {
    for (let intento = 0; ; intento++) {
      try {
        return await this.db.transaccion((manager) =>
          this.crearEnTransaccion(manager, tenantId, usuarioId, dto),
        );
      } catch (error) {
        if (intento >= MAX_REINTENTOS_DEADLOCK || !esDeadlock(error))
          throw error;
      }
    }
  }

  async crearEnTransaccion(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    dto: CreateVentaDto,
    // La cuenta cuyo instante de apertura decide la vigencia. Va como parámetro
    // y NO en `CreateVentaDto` a propósito: en el body, un cliente podría dejar
    // una cuenta abierta en diciembre y mandar su id en marzo para cobrar con
    // la promo de verano. Solo `salones.cerrarCuenta` lo pasa.
    cuentaId?: string,
  ) {
    const canal = dto.canal ?? 'fisico';

    // 1. Verificar caja abierta (física para canal presencial, virtual para online)
    const caja =
      canal === 'online'
        ? await this.cajaService.findVirtual(tenantId)
        : await this.cajaService.findActiva(tenantId, usuarioId);
    if (!caja) {
      throw new BadRequestException(
        canal === 'online'
          ? 'El tenant no tiene una caja virtual configurada'
          : 'No tienes una caja abierta',
      );
    }
    if (caja.estado !== 'abierta') {
      throw new BadRequestException(
        'La caja está en conciliación y no admite ventas',
      );
    }
    // Lock pesimista sostenido hasta el commit. `findActiva` lee por repositorio
    // —desde ADR-020 eso ES el manager de esta transacción— pero SIN lock, y
    // bajo READ COMMITTED un cierre que commitea después no se ve: el chequeo de
    // arriba no garantiza nada. Un cierre puede commitear mientras se procesan ítems,
    // precios e inventario, y el INSERT en `movimientos_caja` del final no
    // revalida el estado — el movimiento caería en una caja ya cerrada cuyo
    // arqueo ya quedó congelado. La caja virtual NO se bloquea: nunca se cierra
    // (una por tenant, siempre abierta) y el lock serializaría todas las ventas
    // online del tenant sin proteger de nada.
    if (canal !== 'online') {
      await this.cajaService.bloquearCajaAbierta(manager, caja.id, tenantId);
    }

    // 2. Cargar todos los items para obtener monedaId, tipo, nombre.
    // UNA query para todo el carrito: `findOne` por línea disparaba 4+ queries
    // por ítem construyendo impuestos, recargos, descuentos, ingredientes y
    // grupos que la venta nunca lee. Ver `cargarBasePorIds`.
    const itemsPorId = await this.itemsService.cargarBasePorIds(
      tenantId,
      dto.lineas.map((l) => l.itemId),
    );
    const items = dto.lineas.map((l) => itemsPorId.get(l.itemId)!);

    for (const item of items) {
      if (item.tipo === 'ingrediente') {
        throw new BadRequestException(
          'Los ingredientes no se pueden vender directamente',
        );
      }
      // `clasificacion_tributaria` es nullable desde ADR-018 (los ingredientes
      // van NULL: no se venden, no tienen tratamiento fiscal). Rellenar el
      // snapshot con 'afecto' haría que `venta_detalles` mienta: el motor ya
      // decidió el IVA con la condición positiva `=== 'afecto'`, así que un
      // NULL cobró IVA cero mientras la línea guardada diría "afecto" — sin
      // excepción ni log, indetectable por auditoría. Se rechaza en vez de
      // inventar el dato, y acá arriba para no escribir nada antes de fallar.
      if (item.clasificacionTributaria === null) {
        throw new BadRequestException(
          `El ítem "${item.nombre}" no tiene clasificación tributaria: no se puede vender`,
        );
      }
    }

    const unidades = await this.catalogService.findAllUnidadesMedida();
    const catalogo = unidades.map((u) => ({
      codigo: u.codigo,
      magnitud: u.magnitud,
      factorBase: u.factorBase,
    }));

    const cantidadesResueltas = dto.lineas.map((linea, i) => {
      const item = items[i];
      assertPresentacionPareada(
        linea.cantidadPresentacion,
        linea.unidadCodigoPresentacion,
      );

      // Se resuelve para TODA línea, no solo las que vienen por presentación:
      // es la unidad en la que queda `cantidad`, y se congela en el detalle.
      const { unidadBaseCodigo, forzarConteo } = resolverUnidadBaseDeItem(item);

      if (!linea.cantidadPresentacion || !linea.unidadCodigoPresentacion) {
        return {
          cantidadCanonica: linea.cantidad,
          cantidadPresentacion: null as string | null,
          unidadCodigoPresentacion: null as string | null,
          unidadBaseCodigo,
        };
      }

      const res = resolverCantidadDesdePresentacion({
        cantidadPresentacion: linea.cantidadPresentacion,
        unidadCodigoPresentacion: linea.unidadCodigoPresentacion,
        unidadBaseCodigo,
        catalogo,
        forzarConteo,
      });

      return {
        cantidadCanonica: res.cantidadCanonica,
        cantidadPresentacion: res.cantidadPresentacion,
        unidadCodigoPresentacion: res.unidadCodigoPresentacion,
        unidadBaseCodigo,
      };
    });

    // 3. Resolver la moneda oficial del tenant: la de su PAÍS (ADR-005). Se
    //    trae junto con las demás para armar el mapa de tasas de una sola
    //    consulta.
    //
    //    ⚠️ **La consulta arranca en `tenants`, no en `tenant_moneda`**, y es la
    //    misma forma que `MonedasService.findMonedas`. Con un `INNER JOIN` sobre
    //    `tenant_moneda` la venta dependía de que existiera una fila para la
    //    oficial —que hoy siembra el alta del tenant— mientras que los otros dos
    //    caminos que resuelven "oficial" (`decimalesOficiales` y el reparto de
    //    propinas) no la necesitan. Esa asimetría es una versión chica del
    //    problema que ADR-021 vino a eliminar, así que no se deja.
    const monedaRows: {
      moneda_id: string;
      valor_del_dia: string | null;
      es_oficial: boolean;
      decimales: number | string;
    }[] = await this.db.query(
      `SELECT m.moneda_id, tm.valor_del_dia, m.decimales,
              (m.moneda_id = p.moneda_oficial_id) AS es_oficial
         FROM tenants t
         JOIN provincia prov ON prov.provincia_id = t.provincia_id
              AND prov.eliminado_el IS NULL
         JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
         JOIN pais_moneda pm ON pm.pais_id = p.pais_id AND pm.eliminado_el IS NULL
         JOIN moneda m ON m.moneda_id = pm.moneda_id AND m.eliminado_el IS NULL
         LEFT JOIN tenant_moneda tm ON tm.tenant_id = t.tenant_id
              AND tm.moneda_id = m.moneda_id AND tm.eliminado_el IS NULL
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId],
    );
    const monedaOficial = monedaRows.find((r) => r.es_oficial);
    if (!monedaOficial) {
      throw new BadRequestException(
        'El tenant no tiene moneda oficial configurada',
      );
    }
    const monedaOficialId = monedaOficial.moneda_id;

    // Mapa de monedaId → valor_del_dia para conversión
    const tasaMap = new Map(
      // La tasa de la oficial se pisa con 1, igual que en `findMonedas`: es la
      // moneda a la que se convierte, así que su tasa contra sí misma no puede
      // ser otra cosa. Leerla cruda de la fila hacía que este camino y el del
      // motor pudieran armar mapas distintos para la misma venta.
      monedaRows.map((r) => [
        r.moneda_id,
        r.es_oficial ? '1' : (r.valor_del_dia ?? '1'),
      ]),
    );

    /**
     * **Secuencial a propósito.** Los dos `resolver…` consultan con el `manager`
     * de la transacción, o sea un único `pg.Client`: con dos o más líneas de
     * receta o combo, un `Promise.all` dispara consultas concurrentes sobre ese
     * cliente y node-postgres las encola igual. En `pg@9` la segunda **tira** en
     * vez de esperar.
     *
     * **Costo cero, y está medido por este mismo proyecto** al cerrar el N+1 de
     * la personalización el 2026-08-20: *"el `Promise.all` corre sobre el manager
     * de la transacción, o sea una sola conexión, y `pg` las encola. Son viajes
     * en serie."* Ya corrían en serie; lo único que cambia es la vía, de una
     * anunciada como removida a una soportada. Ninguna consulta se agrega: el
     * conteo por venta es el mismo que dejó aquella tanda.
     *
     * Gemelo del arreglo de `calculo-precios.service.ts` del 2026-08-21, en el
     * mismo `POST /ventas` — ver `docs/agent/resueltos.md`.
     */
    const personalizaciones: (
      | Awaited<ReturnType<ItemsService['resolverPersonalizacionReceta']>>
      | Awaited<ReturnType<ItemsService['resolverPersonalizacionCombo']>>
      | null
    )[] = [];
    for (const [i, linea] of dto.lineas.entries()) {
      const item = items[i];
      if (item.tipo === 'receta') {
        personalizaciones.push(
          await this.itemsService.resolverPersonalizacionReceta(
            manager,
            tenantId,
            item.id,
            linea.personalizacion,
          ),
        );
      } else if (item.tipo === 'combo') {
        personalizaciones.push(
          await this.itemsService.resolverPersonalizacionCombo(
            manager,
            tenantId,
            item.id,
            linea.personalizacion,
          ),
        );
      } else {
        personalizaciones.push(null);
      }
    }

    // 4. Construir DTO para el motor de precios con precios ya convertidos a moneda oficial
    //
    // La config del tenant se carga ACÁ y no dentro de `calcular` porque la
    // conversión de abajo también redondea, y tiene que hacerlo con el mismo
    // `modo_redondeo` que el motor. Se le pasa después por `configPrecargada`:
    // son las mismas dos consultas de siempre, movidas unas líneas más arriba, no
    // dos consultas nuevas. `decimalesMoneda` sale del `JOIN` de arriba —tampoco
    // es una consulta nueva—, así que `cargarConfig` no vuelve a resolver la
    // moneda oficial por su cuenta.
    const configCalculo = await this.calculoPreciosService.cargarConfig(
      tenantId,
      Number(monedaOficial.decimales),
    );

    const lineasConversion = dto.lineas.map((linea, i) => {
      const item = items[i];
      const pers = personalizaciones[i];
      const {
        cantidadCanonica,
        cantidadPresentacion,
        unidadCodigoPresentacion,
        unidadBaseCodigo,
      } = cantidadesResueltas[i];
      const tasa = new Decimal(tasaMap.get(item.monedaId) ?? '1');
      // Este `.toFixed(4)` NO redondea nunca, y por eso no toma `modo_redondeo`:
      // suma dos strings que ya vienen con 4 decimales exactos. `precio_base` es
      // `NUMERIC(18,4)`, y `precioExtraTotal` sale ya redondeado de
      // `items.service.ts` (`resolverPersonalizacionReceta`, `resolverGruposDeItem`
      // y `resolverPersonalizacionCombo`, los tres con su propio `toFixed(4)`).
      // Acá solo se formatea.
      //
      // Si algún día las unidades de un extra admiten fracción —hoy se rechazan—,
      // el redondeo real va a ocurrir **en esos tres `toFixed` de
      // `items.service.ts`**, no acá: esta línea va a seguir sin redondear. El
      // modo hay que dárselo allá.
      const precioOrigen =
        pers != null
          ? new Decimal(item.precioBase).plus(pers.precioExtraTotal).toFixed(4)
          : (linea.precioUnitario ?? item.precioBase);
      // La conversión sí redondea, y es la que se persiste en
      // `venta_detalles.precio_unitario`. Comparte función con la
      // previsualización: si las dos no redondean igual, el POS muestra un precio
      // y la venta guarda otro.
      const precioConvertido =
        this.calculoPreciosService.convertirAMonedaOficial(
          precioOrigen,
          item.monedaId,
          tasaMap,
          configCalculo.modoRedondeo,
        );
      return {
        linea,
        item,
        cantidadCanonica,
        cantidadPresentacion,
        unidadCodigoPresentacion,
        unidadBaseCodigo,
        precioOrigen,
        tasa: tasa.toFixed(6),
        precioConvertido,
        personalizacion: pers?.snapshot ?? null,
      };
    });

    const calcularDto = {
      lineas: lineasConversion.map(
        ({ linea, precioConvertido, cantidadCanonica }) => ({
          itemId: linea.itemId,
          cantidad: cantidadCanonica,
          precioUnitario: precioConvertido,
          descuentoIds: linea.descuentoIds,
          recargoIds: linea.recargoIds,
          impuestoIds: linea.impuestoIds,
        }),
      ),
      metodoPagoId: dto.metodoPagoId,
      descuentosVentaIds: dto.descuentosVentaIds,
      recargosVentaIds: dto.recargosVentaIds,
      cuentaId,
      // El canal REAL de la venta, no el que pudo venir en una
      // previsualización: es lo que filtra las promos que rigen en un solo
      // canal. Mismo criterio que `cuentaId` — lo pone el servidor.
      canal,
    };

    // 5. Calcular importes (sin persistencia)
    const resultado = await this.calculoPreciosService.calcular(
      tenantId,
      calcularDto,
      configCalculo,
    );

    // 6. Preparar pagos (puede ser vacío → cuenta por cobrar; online no admite cuenta por cobrar)
    const pagosDto = dto.pagos ?? [];
    if (canal === 'online') {
      const montoPagado = pagosDto.reduce(
        (acc, p) => acc.plus(new Decimal(p.monto)),
        new Decimal(0),
      );
      if (montoPagado.lt(resultado.totales.totalFinal)) {
        throw new BadRequestException(
          'Las ventas online requieren el pago completo',
        );
      }
    }

    // 7. Transacción atómica (manager recibido por parámetro)
    // 7a. Cabecera de venta (estado inicial PENDIENTE; se actualiza tras registrar pagos)
    const totalFinal = resultado.totales.totalFinal;
    const totalImpuestos = resultado.totales.totalImpuestos;
    const baseVentasSinImpuestos = new Decimal(totalFinal)
      .minus(totalImpuestos)
      .toFixed(4);

    const venta = await manager.save(
      Venta,
      manager.create(Venta, {
        tenantId,
        cajaId: caja.id,
        monedaId: monedaOficialId,
        tipoDocumentoId: dto.tipoDocumentoId ?? null,
        canal,
        estado: EstadoVenta.PENDIENTE,
        totalBruto: resultado.totales.subtotalNeto,
        totalDescuentos: resultado.totales.totalDescuentos,
        totalRecargos: resultado.totales.totalRecargos,
        totalImpuestos,
        totalFinal,
        baseVentasTotalFinal: totalFinal,
        baseVentasSinImpuestos,
        comentario: dto.comentario ?? null,
        // La config con la que se calculó, congelada: sin ella las reglas
        // congeladas más abajo no son interpretables.
        configCalculo: resultado.config,
      }),
    );

    // 7b. Líneas / detalles — un `save` con el array entero, no uno por línea.
    // TypeORM devuelve las mismas instancias en el mismo orden, que es lo que
    // permite cruzar `detalles[i]` con `resultado.lineas[i]` más abajo.
    const detalles = await manager.save(
      VentaDetalle,
      resultado.lineas.map((rLinea, i) => {
        const {
          item,
          precioOrigen,
          tasa,
          precioConvertido,
          personalizacion,
          cantidadPresentacion,
          unidadCodigoPresentacion,
          unidadBaseCodigo,
        } = lineasConversion[i];
        return manager.create(VentaDetalle, {
          ventaId: venta.id,
          itemId: rLinea.itemId,
          monedaIdOrigen: item.monedaId,
          precioUnitarioOrigen: precioOrigen,
          tasaCambio: tasa,
          precioUnitario: precioConvertido,
          descripcion: item.nombre,
          // Non-null garantizado por el guard del paso 2, que rechaza la venta
          // antes de escribir si algún ítem no tiene clasificación.
          clasificacionTributaria: item.clasificacionTributaria!,
          cantidad: rLinea.cantidad,
          cantidadPresentacion,
          unidadCodigoPresentacion,
          // La unidad en la que quedó `cantidad`: sin ella el número no tiene
          // magnitud y leerla del ítem daría la de hoy, no la de la venta.
          unidadCodigoBase: unidadBaseCodigo,
          subtotal: rLinea.subtotalNeto,
          descuentoAplicado: rLinea.descuentoAplicado,
          recargoAplicado: rLinea.recargoAplicado,
          ajusteVenta: rLinea.ajusteVenta,
          impuestoAplicado: rLinea.impuestoAplicado,
          totalLinea: rLinea.totalLinea,
          personalizacion,
        });
      }),
    );

    // 7c/7d. Reglas aplicadas. Se arman todas las filas en memoria y se
    // escriben con un `save` por familia: eran N round-trips EN SERIE, uno por
    // traza, sobre un resultado que ya estaba entero en memoria. El orden de
    // armado es el de antes (por línea, y las de venta al final) porque es el
    // orden en que quedan las filas.
    const filasDescuento: VentaDescuento[] = [];
    const filasRecargo: VentaRecargo[] = [];
    const filasImpuesto: VentaImpuesto[] = [];
    const filasPromocion: VentaPromocion[] = [];

    // Un `porcentaje_aplicado` solo tiene sentido si la regla ERA un
    // porcentaje. En una de monto fijo va `null` explícito: un `0` se leería
    // después como "valía 0%", que es una regla distinta.
    const porcentajeDe = (traza: TrazaRegla) =>
      traza.modo === 'porcentaje' ? traza.valorEfectivo : null;

    resultado.lineas.forEach((rLinea, i) => {
      // Por índice, nunca por `itemId`: el mismo ítem puede aparecer en dos
      // líneas con personalizaciones distintas, y buscarlo por ítem atribuiría
      // las dos reglas a la misma.
      const detalleId = detalles[i].id;

      for (const traza of rLinea.trazas.descuentos) {
        filasDescuento.push(
          manager.create(VentaDescuento, {
            ventaId: venta.id,
            descuentoId: traza.id,
            detalleId,
            nombreRegla: traza.nombre,
            modo: traza.modo,
            valorAplicado: traza.monto,
            valorSolicitado: traza.valorSolicitado,
            porcentajeAplicado: porcentajeDe(traza),
            aplicadoEn: 'detalle',
          }),
        );
      }
      for (const traza of rLinea.trazas.recargos) {
        filasRecargo.push(
          manager.create(VentaRecargo, {
            ventaId: venta.id,
            recargoId: traza.id,
            detalleId,
            nombreRegla: traza.nombre,
            modo: traza.modo,
            valorAplicado: traza.monto,
            porcentajeAplicado: porcentajeDe(traza),
            aplicadoEn: 'detalle',
          }),
        );
      }
      for (const traza of rLinea.trazas.impuestos) {
        filasImpuesto.push(
          manager.create(VentaImpuesto, {
            ventaId: venta.id,
            impuestoId: traza.id,
            detalleId,
            nombreRegla: traza.nombre,
            valorAplicado: traza.monto,
            porcentajeAplicado: traza.tasa,
            aplicadoEn: 'detalle',
          }),
        );
      }
      // Siempre por línea, nunca a nivel venta: el beneficio de una promo
      // aterriza en líneas (ver `TrazaPromo`), así que no hay un
      // `resultado.trazasVenta.promociones` equivalente al de descuentos/recargos.
      for (const traza of rLinea.trazas.promociones) {
        filasPromocion.push(
          manager.create(VentaPromocion, {
            ventaId: venta.id,
            detalleId,
            aplicacion: traza.aplicacion,
            promocionId: traza.id,
            nombrePromocion: traza.nombre,
            tipo: traza.tipo,
            valorEfectivo: traza.valorEfectivo,
            monto: traza.monto,
          }),
        );
      }
    });

    // Las de nivel venta no pertenecen a ninguna línea: `detalleId` queda null.
    for (const traza of resultado.trazasVenta.descuentos) {
      filasDescuento.push(
        manager.create(VentaDescuento, {
          ventaId: venta.id,
          descuentoId: traza.id,
          detalleId: null,
          nombreRegla: traza.nombre,
          modo: traza.modo,
          valorAplicado: traza.monto,
          valorSolicitado: traza.valorSolicitado,
          porcentajeAplicado: porcentajeDe(traza),
          aplicadoEn: 'venta',
        }),
      );
    }
    for (const traza of resultado.trazasVenta.recargos) {
      filasRecargo.push(
        manager.create(VentaRecargo, {
          ventaId: venta.id,
          recargoId: traza.id,
          detalleId: null,
          nombreRegla: traza.nombre,
          modo: traza.modo,
          valorAplicado: traza.monto,
          porcentajeAplicado: porcentajeDe(traza),
          aplicadoEn: 'venta',
        }),
      );
    }

    // TypeORM ya cortocircuita un array vacío, pero el guard queda explícito:
    // que una venta sin reglas no escriba nada no debería depender de un
    // detalle interno de la librería.
    if (filasDescuento.length > 0) {
      await manager.save(VentaDescuento, filasDescuento);
    }
    if (filasRecargo.length > 0) {
      await manager.save(VentaRecargo, filasRecargo);
    }
    if (filasImpuesto.length > 0) {
      await manager.save(VentaImpuesto, filasImpuesto);
    }
    if (filasPromocion.length > 0) {
      await manager.save(VentaPromocion, filasPromocion);
    }

    // 7e. Customer (opcional)
    if (dto.customer) {
      if (dto.customer.terceroId) {
        await this.validarTercero(manager, tenantId, dto.customer.terceroId);
      }
      await manager.save(
        VentaCustomer,
        manager.create(VentaCustomer, {
          ventaId: venta.id,
          terceroId: dto.customer.terceroId ?? null,
          nombre: dto.customer.nombre,
          rut: dto.customer.rut ?? null,
          direccion: dto.customer.direccion ?? null,
          telefono: dto.customer.telefono ?? null,
          email: dto.customer.email ?? null,
        }),
      );
    }

    // 7f. Movimientos de inventario (productos y recetas)
    //
    // Orden determinista por `itemId`, NO el del carrito: `registrarMovimiento`
    // toma `SELECT … FOR UPDATE` sobre `item_producto` por línea, así que el
    // orden de bloqueo lo decidía el cliente. Dos ventas simultáneas con los
    // mismos dos productos en orden inverso se bloqueaban en cruz y Postgres
    // abortaba una — venta caída con un error opaco, sin corrupción pero sin
    // explicación. Un orden global fijo hace el deadlock imposible.
    // Arranca con lo que avisó el motor de precios (descuento topeado por el piso
    // en cero, regla pausada, impuesto pausado, ítem pausado) y se le suma lo de
    // recetas/combos más abajo. Se renderizan
    // como toasts sueltos, cada mensaje se explica solo — en el POS
    // (`ventas/pos.vue`) y, desde el 2026-08-11, en el alta de suscripciones de
    // la tienda, que devuelve estas mismas advertencias al cliente.
    const advertencias: string[] = resultado.advertencias.map(
      (a) => `${a.titulo}: ${a.detalle}`,
    );
    const ordenLocks = lineasConversion
      .map((_, idx) => idx)
      .sort((a, b) => {
        const cmp = lineasConversion[a].item.id.localeCompare(
          lineasConversion[b].item.id,
        );
        return cmp !== 0 ? cmp : a - b;
      });
    // Conversor de unidades compartido por TODAS las líneas del carrito.
    // `??=`: se carga en la primera línea que expanda una receta o un combo y
    // se reusa en las siguientes; un carrito de puros productos no paga la
    // query. Sin esto, cada línea cargaba el catálogo de nuevo — adentro de la
    // línea ya se leía una sola vez, pero un pedido de dos platos distintos lo
    // leía dos veces.
    let convertir: ConvertirUnidad | undefined;
    for (const i of ordenLocks) {
      const { item, linea, personalizacion, cantidadCanonica } =
        lineasConversion[i];
      if (item.tipo === 'producto') {
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId,
          itemId: item.id,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: cantidadCanonica,
          usuarioId,
          ventaId: venta.id,
          unidadIds: linea.unidadIds,
          loteId: linea.loteId,
        });
      } else if (item.tipo === 'receta') {
        convertir ??= await this.catalogService.crearConversor();
        const advertenciasIngrediente =
          await this.itemsService.venderIngredientesReceta(manager, {
            tenantId,
            usuarioId,
            ventaId: venta.id,
            recetaItemId: item.id,
            recetaNombre: item.nombre,
            cantidadVendida: cantidadCanonica,
            snapshot: personalizacion ?? undefined,
            convertir,
          });
        advertencias.push(...advertenciasIngrediente);
      } else if (item.tipo === 'combo') {
        convertir ??= await this.catalogService.crearConversor();
        const advertenciasComponente =
          await this.itemsService.venderComponentesCombo(manager, {
            tenantId,
            usuarioId,
            ventaId: venta.id,
            comboItemId: item.id,
            comboNombre: item.nombre,
            cantidadVendida: cantidadCanonica,
            snapshot: personalizacion ?? undefined,
            convertir,
          });
        advertencias.push(...advertenciasComponente);
      }
    }

    // 7g. Propina (cierre de mesa o directa del POS) — antes de pagos, para referencia_id
    if (dto.propinaCierreMesa && dto.propinaDirecta) {
      throw new BadRequestException(
        'No se puede combinar propina de cierre de mesa con propina directa',
      );
    }
    // Flags de canal: propina de un canal deshabilitado se ignora (la venta se
    // crea sin propina). La config solo se consulta si la venta trae propina,
    // para no pegarle a la BD en cada venta sin propina (camino caliente del
    // POS). Ver docs/features/liquidacion-propinas-config.md.
    // Ambas propinas son del canal presencial —el POS y el cierre de mesa de
    // salones—, así que una venta `online` que las mande se trata igual que un
    // canal apagado: se ignora, no se rechaza.
    const traePropina =
      canal !== 'online' && !!(dto.propinaCierreMesa || dto.propinaDirecta);
    const propinaConfig = traePropina
      ? await manager.findOne(PropinaConfiguracion, {
          where: { tenantId, eliminadoEl: IsNull() },
        })
      : null;
    const habilitadoPos = traePropina && (propinaConfig?.habilitadoPos ?? true);
    const habilitadoSalones =
      traePropina && (propinaConfig?.habilitadoSalones ?? true);
    let ventaPropinaId: string | null = null;
    let propinaMonto = '0';
    let estrategiaPropina = EstrategiaAsignacionPropina.NO_VUELTO;
    if (dto.propinaCierreMesa && habilitadoSalones) {
      const tip = dto.propinaCierreMesa;
      propinaMonto = tip.montoPagado;
      estrategiaPropina =
        tip.estrategia ?? EstrategiaAsignacionPropina.NO_VUELTO;
      // `garzonId` viene del body: sin este chequeo se persiste tal cual y la
      // propina se acredita a un garzón de otro tenant, que después la cobra en
      // su liquidación. Lanza si no existe, no es del tenant o está inactivo.
      // (`propinaDirecta` no lo necesita: `asegurarMostrador` ya es tenant-scoped.)
      await this.garzonesService.obtenerActivoPorId(tenantId, tip.garzonId);
      const ventaPropina = await this.ventaPropinaService.crearEnTransaccion(
        manager,
        {
          tenantId,
          ventaId: venta.id,
          garzonId: tip.garzonId,
          porcentajeSugerido: tip.porcentajeSugerido ?? '0.10',
          montoSugerido: tip.montoSugerido ?? tip.montoPagado,
          montoPagado: tip.montoPagado,
          sesionGarzonId: tip.sesionGarzonId ?? null,
          turnoId: tip.turnoId ?? null,
          tipoGarzon: tip.tipoGarzon ?? null,
        },
      );
      ventaPropinaId = ventaPropina.id;
    } else if (dto.propinaDirecta && habilitadoPos) {
      const tip = dto.propinaDirecta;
      propinaMonto = tip.montoPagado;
      const mostrador = await this.garzonesService.asegurarMostrador(
        manager,
        tenantId,
      );
      const ventaPropina = await this.ventaPropinaService.crearEnTransaccion(
        manager,
        {
          tenantId,
          ventaId: venta.id,
          garzonId: mostrador.id,
          porcentajeSugerido: tip.porcentajeSugerido ?? '0.10',
          montoSugerido: tip.montoSugerido ?? tip.montoPagado,
          montoPagado: tip.montoPagado,
          sesionGarzonId: null,
          turnoId: null,
          tipoGarzon: null,
        },
      );
      ventaPropinaId = ventaPropina.id;
    }

    const targetCobro = new Decimal(resultado.totales.totalFinal)
      .plus(propinaMonto)
      .toFixed(4);

    // 7h. Pagos — delegado a PagosService (incluye vuelto + aplicaciones + caja)
    const saved = await this.pagosService.registrar(manager, {
      tenantId,
      ventaId: venta.id,
      pagos: pagosDto,
      cajaId: caja.id,
      monedaOficialId,
      target: targetCobro,
      propinaMonto,
      ventaPropinaId,
      estrategia: estrategiaPropina,
    });

    // 7i. Actualizar estado de la venta según montos aplicados a la venta
    //
    // Sin el `if (saved.pagos.length > 0)` que tenía antes: una venta de total
    // $0 —una promoción que descuenta el 100%— es una venta **pagada**, y no
    // lleva línea de pago porque no hay nada que cobrar. Con el guard quedaba
    // `pendiente` con saldo $0 y se arrastraba en los listados de deuda.
    // `calcularEstadoVenta('0', '0')` ya devolvía `pagada` (aplicado ≥ total);
    // lo que faltaba era llamarla.
    //
    // Para el resto no cambia nada: sin pagos y con total > 0, `aplicado ≤ 0`
    // da `pendiente`, que es el estado con el que la venta ya nacía.
    const estadoFinal = calcularEstadoVenta(
      resultado.totales.totalFinal,
      saved.montoAplicadoVenta,
    );
    await manager.query(
      `UPDATE ventas SET estado=$1, actualizado_el=NOW() WHERE venta_id=$2`,
      [estadoFinal, venta.id],
    );
    venta.estado = estadoFinal;

    return { ...venta, detalles, advertencias };
  }

  /**
   * Costo con el que cada ítem SALIÓ en una venta, leído del kardex.
   *
   * Es el dato que hace que revertir mercadería no infle el inventario: la
   * unidad vuelve al costo con el que se fue, no al promedio vigente el día de
   * la reversión (decisión del owner, 2026-08-15). Ya estaba congelado en
   * `movimientos_inventario` ligado a la venta, y hasta el 2026-08-22 no se
   * leía.
   *
   * `MIN(costo_unitario)` y no un promedio: dentro de UNA venta todas las
   * salidas de un mismo ítem congelan el mismo costo. `costo_actual` solo lo
   * mueven `compra` y `ajuste_costo`, y ninguno de los dos puede ocurrir en el
   * medio — la venta toma `FOR UPDATE` sobre el ítem en su primera salida y no
   * lo suelta hasta commitear. Por eso una devolución **parcial** puede usar el
   * mismo costo que una total sin prorratear nada.
   *
   * Una sola query por venta: el llamador resuelve por ítem contra el Map, sin
   * una consulta por línea.
   */
  private async costosDeSalidaPorItem(
    manager: EntityManager,
    ventaId: string,
  ): Promise<Map<string, string | null>> {
    const filas: { item_id: string; costo_unitario: string | null }[] =
      await manager.query(
        `SELECT m.item_id, MIN(m.costo_unitario)::text AS costo_unitario
           FROM movimientos_inventario m
          WHERE m.venta_id = $1 AND m.tipo = 'salida' AND m.motivo = 'venta'
            AND m.eliminado_el IS NULL
          GROUP BY m.item_id`,
        [ventaId],
      );
    return new Map(filas.map((f) => [f.item_id, f.costo_unitario]));
  }

  /**
   * Anula una venta — el `void` del dominio, distinto de la devolución.
   *
   * Acotada al subconjunto que es seguro **hoy y después de integrar el SII**:
   * venta `pendiente`, **sin pagos** y **sin documento tributario**. Ahí no hay
   * hecho fiscal que compensar ni dinero que devolver, así que se puede deshacer
   * de verdad. Todo lo demás se revierte con nota de crédito, como exige el SII:
   * emitida y aceptada la boleta, el documento no se anula, se compensa.
   *
   * Decidido 2026-07-27 tras investigación de mercado — ver
   * `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`.
   */
  async cancelar(params: {
    tenantId: string;
    usuarioId: string;
    ventaId: string;
    motivo: string;
    reponerStock: boolean;
  }): Promise<{
    id: string;
    estado: EstadoVenta;
    stockRepuesto: boolean;
    motivo: string;
  }> {
    // Mismo loop que `crear()`, por la misma razón y con la misma
    // precondición: reponer toma un `FOR UPDATE` por ítem, así que una
    // anulación puede cruzarse con una venta concurrente sobre los mismos
    // productos. El único llamador es `VentasController.anular`, sin
    // transacción envolvente — ver la precondición documentada en `crear()`.
    for (let intento = 0; ; intento++) {
      try {
        return await this.cancelarUnaVez(params);
      } catch (error) {
        if (intento >= MAX_REINTENTOS_DEADLOCK || !esDeadlock(error))
          throw error;
      }
    }
  }

  /**
   * Un intento de anulación. Nombre aparte del sufijo `EnTransaccion`, que en
   * este código significa "recibe el `manager` de una transacción ya abierta"
   * (`crearEnTransaccion`): éste abre la suya, que es justo lo que el loop de
   * reintento necesita para que el segundo intento entre limpio.
   */
  private async cancelarUnaVez(params: {
    tenantId: string;
    usuarioId: string;
    ventaId: string;
    motivo: string;
    reponerStock: boolean;
  }): Promise<{
    id: string;
    estado: EstadoVenta;
    stockRepuesto: boolean;
    motivo: string;
  }> {
    return this.db.transaccion(async (manager) => {
      const venta = await this.lockVentaOriginal(
        manager,
        params.tenantId,
        params.ventaId,
      );

      // Literal y no `EstadoVenta.PENDIENTE`: `lockVentaOriginal` devuelve la
      // fila cruda, con `estado` como string (mismo criterio que `crearNotaCredito`).
      if (venta.estado !== 'pendiente')
        throw new BadRequestException(
          `Solo se anula una venta pendiente (esta está "${venta.estado}"). Una venta cobrada se revierte con nota de crédito.`,
        );
      if (venta.tipo_documento_id)
        throw new BadRequestException(
          'La venta ya tiene documento tributario: se revierte con nota de crédito, no se anula.',
        );
      const conPagos: unknown[] = await manager.query(
        `SELECT 1 FROM pagos
          WHERE venta_id = $1 AND eliminado_el IS NULL
          LIMIT 1`,
        [params.ventaId],
      );
      if (conPagos.length)
        throw new BadRequestException(
          'La venta tiene pagos registrados: se revierte con nota de crédito, no se anula.',
        );

      let repuesto = false;
      if (params.reponerStock) {
        // Lo que hay que devolver es lo que el kardex dice que SALIÓ, no lo
        // que dicen las líneas de la venta. Reconstruirlo desde
        // `venta_detalles JOIN item_producto` perdía en silencio toda línea
        // de receta o de combo —esas no tienen fila en `item_producto`, la
        // tienen sus ingredientes/componentes— y la anulación igual respondía
        // que había repuesto. El kardex, además, es exacto donde la receta no
        // lo es: un ingrediente no bloqueante que se vendió sin stock nunca
        // salió, así que tampoco vuelve; y una receta editada después de la
        // venta no cambia lo que hay que devolver.
        //
        // Sin filtrar `eliminado_el` de `items` ni de `item_producto`, y por
        // la misma regla explícita que `InventarioService.registrarMovimiento`:
        // filtrarlo haría que anular una venta de un producto discontinuado
        // después dejara de reponer. El motivo `anulacion` está en la
        // allowlist de movimientos sobre un ítem eliminado.
        const salidas: {
          item_id: string;
          cantidad: string;
          descripcion: string | null;
          modo_inventario: string | null;
        }[] = await manager.query(
          `SELECT m.item_id,
                  SUM(m.cantidad)::text AS cantidad,
                  i.nombre AS descripcion,
                  ip.modo_inventario
             FROM movimientos_inventario m
             JOIN items i ON i.item_id = m.item_id
             JOIN item_producto ip ON ip.item_id = m.item_id
            WHERE m.venta_id = $1 AND m.tipo = 'salida' AND m.motivo = 'venta'
              AND m.eliminado_el IS NULL
            GROUP BY m.item_id, i.nombre, ip.modo_inventario`,
          [params.ventaId],
        );
        // Solo `cantidad`: reponer serie o lote exige saber qué unidades/lotes
        // salieron y recrearlos. Misma frontera —y mismo mensaje— que la
        // devolución de una nota de crédito, para no inventar un segundo camino.
        for (const s of salidas) {
          if (s.modo_inventario !== 'cantidad')
            throw new BadRequestException(
              `"${s.descripcion ?? s.item_id}" usa inventario por ${s.modo_inventario}: anulá sin reponer stock y registrá el ingreso manualmente desde Inventario.`,
            );
        }
        // Orden determinista por `itemId`, y con el MISMO comparador que
        // `crear()` (`localeCompare`, no el `ORDER BY` de Postgres, cuya
        // collation puede ordenar distinto): si los dos caminos ordenaran
        // distinto, una venta y una anulación simultáneas sobre los mismos
        // ítems se seguirían bloqueando en cruz.
        salidas.sort((a, b) => a.item_id.localeCompare(b.item_id));
        // Sin salidas no hay costos que buscar: una venta de puros servicios
        // no paga la query.
        const costos = salidas.length
          ? await this.costosDeSalidaPorItem(manager, params.ventaId)
          : new Map<string, string | null>();
        for (const s of salidas) {
          await this.inventarioService.registrarMovimiento(manager, {
            tenantId: params.tenantId,
            itemId: s.item_id,
            tipo: 'entrada',
            motivo: 'anulacion',
            cantidad: s.cantidad,
            // Vuelve al costo con el que salió, y el CPP se recalcula
            // incluyéndola (decisión del owner, 2026-08-15). Sin costo
            // congelado —un producto que nunca tuvo costo— no se inventa uno:
            // `registrarMovimiento` deja el promedio como estaba.
            costoUnitario: costos.get(s.item_id) ?? null,
            usuarioId: params.usuarioId,
            ventaId: params.ventaId,
            comentario: params.motivo,
          });
        }
        repuesto = salidas.length > 0;
      }

      await manager.query(
        `UPDATE ventas
            SET estado = $1, cancelada_el = NOW(), cancelada_por_usuario_id = $2,
                motivo_cancelacion = $3, actualizado_el = NOW()
          WHERE venta_id = $4`,
        [
          EstadoVenta.CANCELADA,
          params.usuarioId,
          params.motivo,
          params.ventaId,
        ],
      );

      return {
        id: params.ventaId,
        estado: EstadoVenta.CANCELADA,
        // Lo que de verdad pasó, no lo que se pidió: una venta de puros
        // servicios no tiene nada que devolver, y decir que repuso hace que
        // la pantalla afirme sobre un inventario que nadie tocó.
        stockRepuesto: repuesto,
        motivo: params.motivo,
      };
    });
  }

  /**
   * Crea una nota de crédito interna (sin SII) por un reembolso de pasarela.
   * Los totales se COPIAN del monto reembolsado — nunca pasan por el motor de
   * precios — y la venta original no se modifica (queda `pagada`; la NC
   * documenta la devolución). Las líneas son opcionales e informativas: solo
   * los ítems elegidos para devolver a stock, sin validar cruce con el monto.
   */
  async crearNotaCredito(
    params: CrearNotaCreditoParams,
  ): Promise<NotaCreditoCreada> {
    if (new Decimal(params.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');

    // Los dos rechazos por falta de plata de acá abajo son oráculos sobre el
    // efectivo del turno (fuga 5 del modo ciego). `conRastroDeRechazo` escribe
    // el intento FUERA de esta transacción, para que el rollback del 422 no se
    // lo lleve — ver `CajaService.conRastroDeRechazo`.
    return this.cajaService.conRastroDeRechazo(params.tenantId, () =>
      this.crearNotaCreditoEnTransaccion(params),
    );
  }

  private async crearNotaCreditoEnTransaccion(
    params: CrearNotaCreditoParams,
  ): Promise<NotaCreditoCreada> {
    return this.db.transaccion(async (manager) => {
      const original = await this.lockVentaOriginal(
        manager,
        params.tenantId,
        params.ventaOriginalId,
      );

      if (params.validarVentaElegible) {
        if (original.tipo_documento_id === TIPO_DOCUMENTO_NC_ID)
          throw new BadRequestException(
            'No se puede emitir una nota de crédito sobre otra nota de crédito',
          );
        if (!['pagada', 'pagada_parcial'].includes(original.estado))
          throw new BadRequestException(
            'Solo se puede emitir nota de crédito de ventas pagadas o pagadas parcialmente',
          );
        // La NC corrige aquel documento: hereda su criterio, no el vigente
        // (decisión g). Un null acá no es un caso histórico —después del
        // reset toda venta tiene config— sino que algo se rompió aguas
        // arriba: se falla ruidoso (decisión P5). Pero SOLO en el camino
        // manual: el webhook de reembolso (P3) no puede perder un hecho ya
        // consumado por un dato de configuración faltante, así que no pasa
        // por acá —no manda `validarVentaElegible`— y cuantiza más abajo
        // con su propio fallback documentado.
        if (!original.config_calculo) {
          throw new BadRequestException(
            `La venta ${params.ventaOriginalId} no tiene config_calculo congelada: no se ` +
              `puede emitir una nota de crédito heredando su criterio de redondeo.`,
          );
        }
      }
      const cfgOriginal = original.config_calculo;

      // Σ NCs previas bajo el lock: dos NCs concurrentes sobre la misma venta
      // se serializan y no pueden exceder el total juntas.
      const previasRows: { total: string }[] = await manager.query(
        `SELECT COALESCE(SUM(total_final), 0) AS total
         FROM ventas
         WHERE venta_referencia_id = $1 AND tipo_documento_id = $2
           AND eliminado_el IS NULL`,
        [params.ventaOriginalId, TIPO_DOCUMENTO_NC_ID],
      );
      const previas = new Decimal(previasRows[0]?.total ?? '0');
      const disponible = new Decimal(original.total_final).minus(previas);
      if (new Decimal(params.monto).gt(disponible))
        throw new BadRequestException(
          `El monto excede lo disponible para nota de crédito (${disponible.toString()})`,
        );

      const lineas = await this.validarDevolucionesReembolso(
        manager,
        params.ventaOriginalId,
        params.devoluciones ?? [],
      );

      const nc = await manager.save(
        Venta,
        manager.create(Venta, {
          tenantId: params.tenantId,
          cajaId: original.caja_id,
          monedaId: original.moneda_id,
          canal: original.canal,
          tipoDocumentoId: TIPO_DOCUMENTO_NC_ID,
          ventaReferenciaId: params.ventaOriginalId,
          estado: EstadoVenta.PAGADA,
          totalBruto: params.monto,
          totalDescuentos: '0',
          totalRecargos: '0',
          totalImpuestos: '0',
          totalFinal: params.monto,
          comentario: params.comentario ?? null,
          // La NC congela lo que heredó (decisión P4): así puede leerse
          // sola, sin ir a buscar la venta que corrige.
          configCalculo: cfgOriginal,
        }),
      );

      // Una sola lectura para todas las líneas: los costos congelados son de
      // la venta ORIGINAL, no de la NC que se está creando. La NC por monto
      // libre —sin líneas, que es el caso más común— no paga la query.
      const costosOriginales = lineas.length
        ? await this.costosDeSalidaPorItem(manager, params.ventaOriginalId)
        : new Map<string, string | null>();
      for (const linea of lineas) {
        // El VALOR se cuantiza al criterio heredado, con la misma `cuantizar`
        // que usa el motor de precios (no una fórmula propia): el string
        // sigue formateándose a 4 decimales, la escala de la columna
        // (`venta_detalles.total_linea` es NUMERIC(18,4)). Sin
        // `config_calculo` congelada —solo alcanzable acá vía el webhook,
        // ver el guard arriba— no hay criterio que heredar: se persiste
        // igual que antes de este fix, sin cuantizar a la escala de la
        // moneda, para no perder el evento (decisión P3).
        const bruto = new Decimal(linea.precioUnitario).times(linea.cantidad);
        const totalLinea = (
          cfgOriginal
            ? cuantizar(bruto, cfgOriginal)
            : bruto.toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        ).toFixed(4);
        await manager.save(
          VentaDetalle,
          manager.create(VentaDetalle, {
            ventaId: nc.id,
            itemId: linea.itemId,
            monedaIdOrigen: linea.monedaIdOrigen,
            precioUnitarioOrigen: linea.precioUnitarioOrigen,
            tasaCambio: linea.tasaCambio,
            precioUnitario: linea.precioUnitario,
            descripcion: linea.descripcion,
            clasificacionTributaria: linea.clasificacionTributaria,
            unidadCodigoBase: linea.unidadCodigoBase,
            cantidad: linea.cantidad,
            subtotal: totalLinea,
            totalLinea,
          }),
        );
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId: params.tenantId,
          itemId: linea.itemId,
          tipo: 'entrada',
          motivo: 'devolucion',
          cantidad: linea.cantidad,
          // El costo sale de la venta ORIGINAL, no de esta NC: el movimiento
          // queda ligado a `nc.id`, pero la unidad que vuelve salió allá.
          costoUnitario: costosOriginales.get(linea.itemId) ?? null,
          usuarioId: params.usuarioId,
          ventaId: nc.id,
          comentario: params.comentario,
        });
      }

      let movimientoCajaId: string | null = null;
      if (params.devolverDinero) {
        const caja = await this.cajaService.findActiva(
          params.tenantId,
          params.usuarioId,
        );
        if (!caja)
          throw new UnprocessableEntityException(
            'No tienes una caja física abierta para registrar la devolución de dinero',
          );
        await this.cajaService.bloquearCajaAbierta(
          manager,
          caja.id,
          params.tenantId,
        );
        // Tope de la devolución EN EFECTIVO: lo que esa venta cobró en efectivo,
        // menos lo ya devuelto en efectivo por NCs anteriores. El saldo global de
        // la caja (abajo) no alcanza como control: viene de otras ventas, así que
        // sin este tope se puede sacar plata que esta venta nunca ingresó, y dar
        // billetes por una compra con tarjeta — el vector de fraude interno que
        // Clover, Lightspeed y Toast bloquean por diseño.
        // OJO: acota el DINERO, no el documento. La NC puede seguir emitiéndose
        // por el total (tope `total_final − Σ NCs previas`, regla dura del SII):
        // anular una venta a crédito es legítimo, devolver efectivo que nunca
        // entró no lo es. Ver docs/agent/investigaciones/2026-07-27-…
        const efectivoRows: { cobrado: string; devuelto: string }[] =
          await manager.query(
            `SELECT
               COALESCE((
                 SELECT SUM(pa.monto)
                 FROM pagos p
                 JOIN pago_aplicaciones pa ON pa.pago_id = p.pago_id
                      AND pa.eliminado_el IS NULL AND pa.tipo = 'venta'
                 JOIN metodos_pago mp ON mp.metodo_pago_id = p.metodo_pago_id
                      AND mp.es_efectivo = true AND mp.eliminado_el IS NULL
                 WHERE p.venta_id = $1 AND p.eliminado_el IS NULL
               ), 0)::text AS cobrado,
               COALESCE((
                 SELECT SUM(mc.monto)
                 FROM ventas nc
                 JOIN movimientos_caja mc ON mc.venta_id = nc.venta_id
                      AND mc.tipo = 'salida' AND mc.eliminado_el IS NULL
                 WHERE nc.venta_referencia_id = $1
                   AND nc.tipo_documento_id = $2
                   AND nc.eliminado_el IS NULL
               ), 0)::text AS devuelto`,
            [params.ventaOriginalId, TIPO_DOCUMENTO_NC_ID],
          );
        const devolvibleEfectivo = new Decimal(
          efectivoRows[0]?.cobrado ?? '0',
        ).minus(efectivoRows[0]?.devuelto ?? '0');
        // ⚠️ El mensaje NO interpola `devolvibleEfectivo`. Ese número era la
        // fuga 5 del modo ciego: un solo request rechazado con monto = techo + 1
        // entregaba el efectivo cobrado de la venta, sin emitir ninguna NC. El
        // tope sigue igual de duro; lo que se fue es el número, y en su lugar
        // queda el rastro del intento.
        if (new Decimal(params.monto).gt(devolvibleEfectivo))
          throw new IntentoRechazadoError(
            'No se puede devolver en efectivo más de lo que esta venta cobró en efectivo. Emití la nota de crédito sin devolución de dinero, o devolvé por el medio de pago original.',
            {
              cajaId: caja.id,
              usuarioId: params.usuarioId,
              tipo: 'devolucion_nc',
              motivo: 'supera_efectivo_de_la_venta',
              montoSolicitado: new Decimal(params.monto).toFixed(4),
              ventaId: params.ventaOriginalId,
            },
          );

        const saldoEfectivo = await this.cajaService.calcularEsperadoEfectivo(
          caja.id,
          manager,
        );
        if (new Decimal(saldoEfectivo).minus(params.monto).lt(0))
          throw new IntentoRechazadoError('Saldo insuficiente en caja', {
            cajaId: caja.id,
            usuarioId: params.usuarioId,
            tipo: 'devolucion_nc',
            motivo: 'saldo_insuficiente',
            montoSolicitado: new Decimal(params.monto).toFixed(4),
            ventaId: params.ventaOriginalId,
          });
        const movimiento =
          await this.cajaService.registrarMovimientoEnTransaccion(manager, {
            cajaId: caja.id,
            tipo: 'salida',
            concepto: 'Devolución · Nota de crédito',
            monto: params.monto,
            ventaId: nc.id,
          });
        movimientoCajaId = movimiento.id;
      }

      return {
        id: nc.id,
        totalFinal: nc.totalFinal,
        movimientoCajaId,
        fecha: nc.creadoEl,
        comentario: nc.comentario,
        devoluciones: params.devoluciones ?? [],
      };
    });
  }

  /**
   * NC creada manualmente desde el detalle de una venta (POS): exige venta
   * pagada/pagada_parcial que no sea otra NC, y permite el egreso de caja
   * elegible. El flujo de reembolsos de pasarela usa `crearNotaCredito`
   * directo y NO pasa por estas reglas.
   */
  async crearNotaCreditoDesdeVenta(params: {
    tenantId: string;
    usuarioId: string;
    ventaOriginalId: string;
    monto: string;
    devoluciones?: DevolucionReembolso[];
    comentario?: string;
    devolverDinero?: boolean;
  }): Promise<{
    id: string;
    totalFinal: string;
    movimientoCajaId: string | null;
    fecha: Date;
    comentario: string | null;
    devoluciones: DevolucionReembolso[];
  }> {
    return this.crearNotaCredito({ ...params, validarVentaElegible: true });
  }

  /**
   * Devoluciones de stock por reembolso SIN nota de crédito: mismos
   * candados y validaciones, pero los movimientos quedan ligados a la venta
   * original y no se crea documento.
   */
  async registrarDevolucionesPorReembolso(params: {
    tenantId: string;
    usuarioId: string;
    ventaOriginalId: string;
    devoluciones: DevolucionReembolso[];
    comentario?: string;
  }): Promise<void> {
    if (!params.devoluciones.length) return;

    await this.db.transaccion(async (manager) => {
      await this.lockVentaOriginal(
        manager,
        params.tenantId,
        params.ventaOriginalId,
      );
      const lineas = await this.validarDevolucionesReembolso(
        manager,
        params.ventaOriginalId,
        params.devoluciones,
      );
      const costosOriginales = await this.costosDeSalidaPorItem(
        manager,
        params.ventaOriginalId,
      );
      for (const linea of lineas) {
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId: params.tenantId,
          itemId: linea.itemId,
          tipo: 'entrada',
          motivo: 'devolucion',
          cantidad: linea.cantidad,
          costoUnitario: costosOriginales.get(linea.itemId) ?? null,
          usuarioId: params.usuarioId,
          ventaId: params.ventaOriginalId,
          comentario: params.comentario,
        });
      }
    });
  }

  /**
   * El `terceroId` del customer de una venta no se validaba en absoluto: el DTO
   * solo exige formato UUID (`@IsUUID()`) y el service lo persistía tal cual. La
   * FK de `venta_customer.tercero_id` (`startup-pos.sql`) referencia `terceros`
   * sin tenant, así que garantizaba existencia y nada más.
   *
   * Dos cosas se cierran acá, y la primera vino con la segunda:
   * - **El tercero tiene que ser de este tenant.** Sin esto, un POST con el id
   *   de un tercero ajeno quedaba guardado en la venta. Hoy no filtra datos
   *   —`venta_customer` denormaliza nombre/RUT y ninguna lectura hace JOIN a
   *   `terceros`— pero es una FK cruzada entre tenants, que no es un estado que
   *   convenga tener escrito esperando al primer JOIN que alguien agregue.
   * - **Un tercero pausado no admite asignaciones nuevas** (decisión del owner,
   *   2026-08-11). Igual que en `validarCategoria`: hasta ahora lo sostenía solo
   *   `ClienteForm.vue`, que filtra por `activo`; el backend aceptaba el POST
   *   directo. Los vínculos ya existentes no se tocan.
   */
  private async validarTercero(
    manager: EntityManager,
    tenantId: string,
    terceroId: string,
  ): Promise<void> {
    const rows: { nombre: string; activo: boolean }[] = await manager.query(
      `SELECT nombre, activo FROM terceros
        WHERE tercero_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [terceroId, tenantId],
    );
    if (!rows.length) {
      throw new BadRequestException('El tercero no pertenece a este tenant');
    }
    if (!rows[0].activo) {
      throw new BadRequestException(
        `El tercero "${rows[0].nombre}" está pausado y no admite asignaciones nuevas`,
      );
    }
  }

  /** Lock pesimista de la venta original: serializa NCs/devoluciones concurrentes. */
  private async lockVentaOriginal(
    manager: EntityManager,
    tenantId: string,
    ventaOriginalId: string,
  ): Promise<{
    venta_id: string;
    caja_id: string | null;
    moneda_id: string;
    canal: string;
    total_final: string;
    estado: string;
    tipo_documento_id: string | null;
    config_calculo: ConfigCalculo | null;
  }> {
    const rows: {
      venta_id: string;
      caja_id: string | null;
      moneda_id: string;
      canal: string;
      total_final: string;
      estado: string;
      tipo_documento_id: string | null;
      config_calculo: ConfigCalculo | null;
    }[] = await manager.query(
      `SELECT venta_id, caja_id, moneda_id, canal, total_final, estado, tipo_documento_id,
              config_calculo
       FROM ventas
       WHERE venta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       FOR UPDATE`,
      [ventaOriginalId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Venta no encontrada');
    return rows[0];
  }

  /**
   * Valida las devoluciones contra el detalle de la venta original y devuelve
   * las líneas listas para persistir/mover stock. Solo ítems con
   * `modo_inventario = 'cantidad'`: serie/lote requieren elegir unidades/lote
   * (fase posterior) y los servicios no tienen stock. Se valida TODO antes de
   * tocar inventario para fallar con un mensaje de negocio claro.
   */
  private async validarDevolucionesReembolso(
    manager: EntityManager,
    ventaOriginalId: string,
    devoluciones: DevolucionReembolso[],
  ): Promise<
    {
      itemId: string;
      cantidad: string;
      precioUnitario: string;
      precioUnitarioOrigen: string | null;
      tasaCambio: string | null;
      monedaIdOrigen: string;
      descripcion: string | null;
      clasificacionTributaria: string;
      unidadCodigoBase: string;
    }[]
  > {
    if (!devoluciones.length) return [];

    const detalles: {
      item_id: string;
      cantidad: string;
      precio_unitario: string;
      precio_unitario_origen: string | null;
      tasa_cambio: string | null;
      moneda_id_origen: string;
      descripcion: string | null;
      clasificacion_tributaria: string;
      unidad_codigo_base: string;
      modo_inventario: string | null;
    }[] = await manager.query(
      `SELECT d.item_id, d.cantidad, d.precio_unitario, d.precio_unitario_origen,
              d.tasa_cambio, d.moneda_id_origen, d.descripcion, d.clasificacion_tributaria,
              d.unidad_codigo_base,
              ip.modo_inventario
       FROM venta_detalles d
       LEFT JOIN item_producto ip ON ip.item_id = d.item_id
       WHERE d.venta_id = $1 AND d.eliminado_el IS NULL`,
      [ventaOriginalId],
    );
    // Ya devuelto por ítem: movimientos 'devolucion' ligados a la venta
    // original (devoluciones sin NC) o a sus NCs hijas (devoluciones con NC).
    const devueltos: { item_id: string; devuelto: string }[] =
      await manager.query(
        `SELECT m.item_id, COALESCE(SUM(m.cantidad), 0) AS devuelto
         FROM movimientos_inventario m
         WHERE m.motivo = 'devolucion' AND m.eliminado_el IS NULL
           AND (m.venta_id = $1 OR m.venta_id IN (
             SELECT venta_id FROM ventas
             WHERE venta_referencia_id = $1 AND eliminado_el IS NULL))
         GROUP BY m.item_id`,
        [ventaOriginalId],
      );
    const devueltoPorItem = new Map(
      devueltos.map((d) => [d.item_id, new Decimal(d.devuelto)]),
    );

    return devoluciones.map((dev) => {
      const filas = detalles.filter((d) => d.item_id === dev.itemId);
      if (!filas.length)
        throw new BadRequestException(
          'El ítem no pertenece a la venta original',
        );
      const detalle = filas[0];
      if (new Decimal(dev.cantidad).lte(0))
        throw new BadRequestException(
          'La cantidad a devolver debe ser mayor a cero',
        );
      if (detalle.modo_inventario === null)
        throw new BadRequestException(
          `"${detalle.descripcion ?? dev.itemId}" no maneja stock (servicio): no admite devolución a inventario`,
        );
      if (detalle.modo_inventario !== 'cantidad')
        throw new BadRequestException(
          `"${detalle.descripcion ?? dev.itemId}" usa inventario por ${detalle.modo_inventario}: la devolución debe registrarse manualmente desde Inventario`,
        );
      const vendida = filas.reduce(
        (acc, f) => acc.plus(f.cantidad),
        new Decimal(0),
      );
      const disponible = vendida.minus(
        devueltoPorItem.get(dev.itemId) ?? new Decimal(0),
      );
      if (new Decimal(dev.cantidad).gt(disponible))
        throw new BadRequestException(
          `La cantidad a devolver de "${detalle.descripcion ?? dev.itemId}" excede lo disponible (${disponible.toString()})`,
        );
      return {
        itemId: dev.itemId,
        cantidad: dev.cantidad,
        precioUnitario: detalle.precio_unitario,
        precioUnitarioOrigen: detalle.precio_unitario_origen,
        tasaCambio: detalle.tasa_cambio,
        monedaIdOrigen: detalle.moneda_id_origen,
        descripcion: detalle.descripcion,
        clasificacionTributaria: detalle.clasificacion_tributaria,
        // Se copia de la línea original: la NC devuelve lo mismo que se vendió,
        // en la misma unidad, aunque el ítem haya cambiado de unidad después.
        unidadCodigoBase: detalle.unidad_codigo_base,
      };
    });
  }

  async findTiposDocumento(tenantId: string): Promise<TipoDocumentoResponse[]> {
    const rows: {
      tipo_documento_id: string;
      nombre: string;
      codigo: string | null;
      customer_requerido: boolean;
    }[] = await this.db.query(
      `SELECT td.tipo_documento_id,
              td.nombre,
              td.codigo,
              td.customer_requerido
       FROM tenants t
       JOIN provincia prov ON prov.provincia_id = t.provincia_id
            AND prov.eliminado_el IS NULL
       JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
       JOIN tipos_documento_tributario td ON td.pais_id = p.pais_id
            AND td.eliminado_el IS NULL AND td.activo = true
       WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
       ORDER BY td.nombre ASC`,
      [tenantId],
    );

    return rows.map((r) => ({
      id: r.tipo_documento_id,
      nombre: r.nombre,
      codigo: r.codigo,
      customerRequerido: r.customer_requerido === true,
    }));
  }

  /**
   * El filtro de "lo mío" para ventas. Se deriva por la caja porque **`ventas` no
   * guarda quién la hizo**: tiene `caja_id`, `canal` y `cancelada_por_usuario_id`,
   * pero ningún `creado_por`. Para una venta física la derivación es exacta —una
   * caja abierta pertenece a un solo usuario, así que la caja *es* el registro de
   * autoría—.
   *
   * **La venta online entra siempre**, sea de quien sea: `crear` la resuelve
   * contra la caja VIRTUAL del tenant (`findVirtual`), nunca contra una física,
   * así que no puede revelar el esperado de ningún cajón que alguien vaya a
   * arquear —que es lo único que este eje protege— y ocultársela al cajero
   * rompería una pantalla legítima a cambio de nada.
   *
   * ⚠️ **Eso vale MIENTRAS online exija pago completo.** Que sus pagos no puedan
   * caer en una caja física no es una propiedad del canal: descansa en dos
   * guardas que viven lejos de acá —`crear` rechaza una venta online sin pago
   * total, y `registrarAbono` opera **siempre** sobre la caja física del que
   * cobra—. El día que se habilite pago contra entrega o abono parcial online,
   * los pagos de una venta online caen en el cajón de un cajero y **esta
   * excepción los expone a cualquier otro cajero** vía el detalle de la venta.
   * Si eso se habilita, hay que filtrar por alcance **dos** lugares, no uno: la
   * lista de pagos de `findOne` (acá) y el listado de `GET /pagos`, que devuelve
   * `p.caja_id` sin redactar para los pagos que entran por su misma rama
   * `online` — hoy inocuo porque viven en la caja virtual, cuyo `usuario_id` es
   * NULL.
   *
   * ⚠️ Una venta **sin caja** no es de nadie y no entra: `caja_id` es nullable y
   * hoy ningún camino lo deja vacío, pero si mañana aparece uno, el `EXISTS` con
   * NULL da falso, que es lo que corresponde.
   */
  private filtroDeMisCajas(idxUsuario: number): string {
    return ` AND (
             v.canal = 'online'
             OR EXISTS (
               SELECT 1 FROM cajas c
                WHERE c.caja_id = v.caja_id
                  AND c.tenant_id = v.tenant_id
                  AND c.usuario_id = $${idxUsuario}
                  AND c.eliminado_el IS NULL
             )
           )`;
  }

  async resumen(
    tenantId: string,
    usuarioId: string,
    verTodas: boolean,
  ): Promise<VentasResumen> {
    const params: unknown[] = [tenantId, TIPO_DOCUMENTO_NC_ID];
    let filtroPropio = '';
    if (!verTodas) {
      params.push(usuarioId);
      filtroPropio = this.filtroDeMisCajas(params.length);
    }

    const rows: {
      total_ventas: number;
      total_facturado: string;
      saldo_pendiente: string;
    }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total_ventas,
              COALESCE(SUM(v.total_final), 0)::text AS total_facturado,
              COALESCE(SUM(
                v.total_final - COALESCE((
                  SELECT SUM(pa.monto)
                  FROM pagos p
                  JOIN pago_aplicaciones pa ON pa.pago_id = p.pago_id
                       AND pa.eliminado_el IS NULL AND pa.tipo = 'venta'
                  WHERE p.venta_id = v.venta_id AND p.eliminado_el IS NULL
                ), 0)
              ), 0)::text AS saldo_pendiente
       FROM ventas v
       WHERE v.tenant_id = $1 AND v.eliminado_el IS NULL
         AND v.tipo_documento_id IS DISTINCT FROM $2
         ${filtroPropio}`,
      params,
    );

    const row = rows[0];
    return {
      totalVentas: row?.total_ventas ?? 0,
      totalFacturado: row?.total_facturado ?? '0',
      saldoPendiente: row?.saldo_pendiente ?? '0',
    };
  }

  async listar(
    tenantId: string,
    query: QueryVentasDto,
    usuarioId: string,
    verTodas: boolean,
  ): Promise<PaginatedResponse<VentaListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    const { filters, params } = this.buildListarFilters(
      tenantId,
      query,
      usuarioId,
      verTodas,
    );

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM ventas v
       WHERE v.tenant_id = $1 AND v.eliminado_el IS NULL
       ${filters}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;

    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: {
      venta_id: string;
      canal: string;
      estado: string;
      total_final: string;
      fecha: Date;
      creado_el: Date;
      monto_pagado: string;
      total_reembolsado: string;
      tipo_documento_id: string | null;
    }[] = await this.db.query(
      `SELECT v.venta_id, v.canal, v.estado, v.total_final, v.fecha, v.creado_el,
              v.tipo_documento_id,
              COALESCE((
                SELECT SUM(pa.monto)
                FROM pagos p
                JOIN pago_aplicaciones pa ON pa.pago_id = p.pago_id
                     AND pa.eliminado_el IS NULL AND pa.tipo = 'venta'
                WHERE p.venta_id = v.venta_id AND p.eliminado_el IS NULL
              ), 0) AS monto_pagado,
              COALESCE((
                SELECT SUM(t.monto)
                FROM pasarela_ordenes o
                JOIN pasarela_transacciones t ON t.orden_id = o.orden_id
                     AND t.tipo = 'REFUND' AND t.estado = 'aprobada'
                     AND t.eliminado_el IS NULL
                WHERE o.venta_id = v.venta_id AND o.eliminado_el IS NULL
              ), 0) AS total_reembolsado
       FROM ventas v
       WHERE v.tenant_id = $1 AND v.eliminado_el IS NULL
       ${filters}
       ORDER BY v.creado_el DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => this.mapVentaListRow(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private buildListarFilters(
    tenantId: string,
    query: QueryVentasDto,
    usuarioId: string,
    verTodas: boolean,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let paramIdx = 2;
    let filters = '';

    // El eje va primero y fuera de todo `if` de query: es el alcance, no un
    // filtro que el cliente elige.
    if (!verTodas) {
      params.push(usuarioId);
      filters += this.filtroDeMisCajas(paramIdx++);
    }

    if (query.estado) {
      filters += ` AND v.estado = $${paramIdx++}`;
      params.push(query.estado);
    }
    if (query.canal) {
      filters += ` AND v.canal = $${paramIdx++}`;
      params.push(query.canal);
    }

    return { filters, params };
  }

  private mapVentaListRow(r: {
    venta_id: string;
    canal: string;
    estado: string;
    total_final: string;
    fecha: Date;
    creado_el: Date;
    monto_pagado: string;
    total_reembolsado: string;
    tipo_documento_id: string | null;
  }): VentaListItem {
    return {
      id: r.venta_id,
      canal: r.canal,
      estado: r.estado,
      totalFinal: r.total_final,
      fecha: r.fecha,
      creadoEl: r.creado_el,
      montoPagado: new Decimal(r.monto_pagado).toFixed(4),
      saldo: new Decimal(r.total_final)
        .minus(new Decimal(r.monto_pagado))
        .toFixed(4),
      totalReembolsado: new Decimal(r.total_reembolsado).toFixed(4),
      esNotaCredito: r.tipo_documento_id === TIPO_DOCUMENTO_NC_ID,
    };
  }

  async findOne(
    tenantId: string,
    ventaId: string,
    usuarioId: string,
    verTodas: boolean,
  ) {
    const paramsDetalle: unknown[] = [ventaId, tenantId];
    let filtroPropio = '';
    if (!verTodas) {
      paramsDetalle.push(usuarioId);
      filtroPropio = this.filtroDeMisCajas(paramsDetalle.length);
    }

    const rows: {
      venta_id: string;
      caja_id: string | null;
      moneda_id: string;
      tipo_documento_id: string | null;
      canal: string;
      estado: string;
      total_bruto: string;
      total_descuentos: string;
      total_recargos: string;
      total_impuestos: string;
      total_final: string;
      base_ventas_total_final: string;
      base_ventas_sin_impuestos: string;
      config_calculo: ConfigCalculo | null;
      comentario: string | null;
      fecha: Date;
      creado_el: Date;
      venta_referencia_id: string | null;
      tipo_documento_codigo: string | null;
      tipo_documento_nombre: string | null;
      tiene_lineas_despachadas: boolean;
    }[] = await this.db.query(
      `SELECT v.venta_id, v.caja_id, v.moneda_id, v.tipo_documento_id, v.canal, v.estado,
              v.total_bruto, v.total_descuentos, v.total_recargos, v.total_impuestos, v.total_final,
              v.base_ventas_total_final, v.base_ventas_sin_impuestos,
              v.config_calculo,
              v.comentario, v.fecha, v.creado_el, v.venta_referencia_id,
              td.codigo AS tipo_documento_codigo, td.nombre AS tipo_documento_nombre,
              EXISTS (
                SELECT 1 FROM cuentas cta
                  JOIN cuenta_lineas cl ON cl.cuenta_id = cta.cuenta_id
                       AND cl.tenant_id = cta.tenant_id
                       AND cl.eliminado_el IS NULL
                       AND cl.cantidad_enviada > 0
                 WHERE cta.venta_id = v.venta_id
                   AND cta.tenant_id = v.tenant_id
                   AND cta.eliminado_el IS NULL
              ) AS tiene_lineas_despachadas
       FROM ventas v
       LEFT JOIN tipos_documento_tributario td
            ON td.tipo_documento_id = v.tipo_documento_id AND td.eliminado_el IS NULL
       WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL
         ${filtroPropio}`,
      paramsDetalle,
    );

    // 404 y no 403 cuando la venta existe pero no es suya: un 403 confirmaría
    // que existe. El detalle trae `caja_id`, `monto` y `vuelto` por pago, que es
    // por donde se reconstruía el esperado de una caja ajena.
    if (!rows.length) throw new NotFoundException('Venta no encontrada');
    const v = rows[0];

    type Row = Record<string, unknown>;
    const detalles: Row[] = await this.db.query(
      `SELECT d.detalle_id, d.item_id, d.descripcion, d.cantidad, d.precio_unitario,
              d.precio_unitario_origen, d.tasa_cambio, d.moneda_id_origen,
              d.subtotal, d.descuento_aplicado, d.recargo_aplicado, d.ajuste_venta,
              d.impuesto_aplicado, d.total_linea, d.cantidad_presentacion, d.unidad_codigo_presentacion,
              d.unidad_codigo_base,
              ip.modo_inventario
       FROM venta_detalles d
       LEFT JOIN item_producto ip ON ip.item_id = d.item_id
       WHERE d.venta_id = $1 AND d.eliminado_el IS NULL ORDER BY d.creado_el ASC`,
      [ventaId],
    );
    // Ya devuelto por ítem (movimientos 'devolucion' de esta venta o de sus NCs
    // hijas): el modal de reembolso lo usa para capear las cantidades.
    const devueltos: { item_id: string; devuelto: string }[] =
      await this.db.query(
        `SELECT m.item_id, COALESCE(SUM(m.cantidad), 0) AS devuelto
         FROM movimientos_inventario m
         WHERE m.motivo = 'devolucion' AND m.eliminado_el IS NULL
           AND (m.venta_id = $1 OR m.venta_id IN (
             SELECT venta_id FROM ventas
             WHERE venta_referencia_id = $1 AND eliminado_el IS NULL))
         GROUP BY m.item_id`,
        [ventaId],
      );
    const devueltoPorItem = new Map(
      devueltos.map((d) => [d.item_id, d.devuelto]),
    );
    // Reembolsos de la(s) orden(es) de pasarela vinculadas a esta venta.
    const reembolsos: Row[] = await this.db.query(
      `SELECT t.transaccion_id, t.monto, t.estado, t.fecha_transaccion,
              o.orden_id, o.codigo_orden
       FROM pasarela_ordenes o
       JOIN pasarela_transacciones t ON t.orden_id = o.orden_id
            AND t.tipo = 'REFUND' AND t.eliminado_el IS NULL
       WHERE o.venta_id = $1 AND o.tenant_id = $2 AND o.eliminado_el IS NULL
       ORDER BY t.fecha_transaccion ASC`,
      [ventaId, tenantId],
    );
    // Notas de crédito hijas (documentos que referencian esta venta).
    const notasCredito: Row[] = await this.db.query(
      `SELECT venta_id, total_final, fecha, comentario
       FROM ventas
       WHERE venta_referencia_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       ORDER BY creado_el ASC`,
      [ventaId, tenantId],
    );
    // Las tres traen lo congelado (`nombre_regla`, `modo`, `valor_solicitado`)
    // además del monto: el catálogo vivo pudo cambiar o desaparecer desde que
    // se cobró, así que la fila tiene que bastarse sola.
    const descuentos: Row[] = await this.db.query(
      `SELECT venta_descuento_id, descuento_id, detalle_id, nombre_regla, modo,
              valor_aplicado, valor_solicitado, porcentaje_aplicado, aplicado_en
       FROM ventas_descuentos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const recargos: Row[] = await this.db.query(
      `SELECT venta_recargo_id, recargo_id, detalle_id, nombre_regla, modo,
              valor_aplicado, porcentaje_aplicado, aplicado_en
       FROM ventas_recargos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const impuestos: Row[] = await this.db.query(
      `SELECT venta_impuesto_id, impuesto_id, detalle_id, nombre_regla,
              valor_aplicado, porcentaje_aplicado, aplicado_en
       FROM ventas_impuestos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    // Congelado igual que las tres de arriba: nombre, tipo y valorEfectivo
    // sobreviven aunque la promo del catálogo cambie o se borre.
    const promociones: Row[] = await this.db.query(
      `SELECT venta_promocion_id, detalle_id, aplicacion, promocion_id,
              nombre_promocion, tipo, valor_efectivo, monto
       FROM ventas_promociones WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const customerRows: Row[] = await this.db.query(
      `SELECT customer_id, tercero_id, nombre, rut, direccion, telefono, email
       FROM venta_customer WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    // `caja_id` se REDACTA cuando el pago no cayó en una caja del que consulta.
    // Alcanzable hoy, sin ningún cambio de producto: el cajero A deja una venta
    // como cuenta por cobrar, el cajero B la abona con SU caja abierta
    // (`registrarAbono` resuelve la venta solo por tenant), y A abre el detalle
    // de su PROPIA venta —así que el filtro de alcance de la cabecera no corta— y
    // se lleva el triplete `caja_id` + `monto` + `vuelto` de la caja de B. Es
    // exactamente el dato que este eje existe para proteger.
    //
    // Se redacta el `caja_id` en vez de esconder la fila: el monto y el medio son
    // de SU venta y los necesita para entender que está pagada; lo que no es suyo
    // es a qué cajón fue a parar. Sin `caja_id` el pago no se puede atribuir a la
    // caja de nadie.
    const pagos: Row[] = await this.db.query(
      `SELECT pago_id, metodo_pago_id, moneda_oficial_id, monto, vuelto, fecha, referencia,
              CASE WHEN $2::boolean OR EXISTS (
                     SELECT 1 FROM cajas c
                      WHERE c.caja_id = pagos.caja_id
                        AND c.tenant_id = pagos.tenant_id
                        AND c.usuario_id = $3
                        AND c.eliminado_el IS NULL
                   )
                   THEN caja_id
              END AS caja_id
       FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL ORDER BY creado_el ASC`,
      [ventaId, verTodas, usuarioId],
    );

    const pagoIds = pagos.map((p) => p['pago_id'] as string);
    const aplicacionesRows: {
      pago_aplicacion_id: string;
      pago_id: string;
      tipo: string;
      referencia_id: string | null;
      monto: string;
    }[] =
      pagoIds.length > 0
        ? await this.db.query(
            `SELECT pago_aplicacion_id, pago_id, tipo, referencia_id, monto
             FROM pago_aplicaciones
             WHERE pago_id = ANY($1::uuid[]) AND eliminado_el IS NULL
             ORDER BY creado_el ASC`,
            [pagoIds],
          )
        : [];
    const aplicacionesPorPago = new Map<string, typeof aplicacionesRows>();
    for (const a of aplicacionesRows) {
      const list = aplicacionesPorPago.get(a.pago_id) ?? [];
      list.push(a);
      aplicacionesPorPago.set(a.pago_id, list);
    }

    const propinaRows: {
      venta_propina_id: string;
      porcentaje_sugerido: string;
      monto_sugerido: string;
      monto_pagado: string;
      tipo: string;
      estado: string;
      garzon_id: string;
      garzon_nombre: string | null;
      sesion_garzon_id: string | null;
      turno_id: string | null;
      tipo_garzon: string | null;
      liquidacion_id: string | null;
    }[] = await this.db.query(
      `SELECT vp.venta_propina_id, vp.porcentaje_sugerido, vp.monto_sugerido, vp.monto_pagado,
              vp.tipo, vp.estado, vp.garzon_id, g.nombre AS garzon_nombre,
              vp.sesion_garzon_id, vp.turno_id, vp.tipo_garzon, vp.liquidacion_id
       FROM venta_propina vp
       LEFT JOIN garzones g ON g.garzon_id = vp.garzon_id
                            AND g.tenant_id = vp.tenant_id
                            AND g.eliminado_el IS NULL
       WHERE vp.venta_id = $1 AND vp.tenant_id = $2 AND vp.eliminado_el IS NULL`,
      [ventaId, tenantId],
    );
    const propinaRow = propinaRows[0] ?? null;

    const customerRow = customerRows[0];

    return {
      id: v.venta_id,
      cajaId: v.caja_id,
      monedaId: v.moneda_id,
      tipoDocumentoId: v.tipo_documento_id,
      tipoDocumento: v.tipo_documento_id
        ? {
            id: v.tipo_documento_id,
            codigo: v.tipo_documento_codigo,
            nombre: v.tipo_documento_nombre,
          }
        : null,
      // Mismo criterio que `listar()`: el id del tipo de documento, no su
      // `codigo`. El frontend lo reconstruía comparando `codigo === '61'`, que
      // es nullable y varía por país — con otro código, el drawer ofrecía
      // "Nota de crédito" sobre una NC mientras el listado sí la marcaba.
      esNotaCredito: v.tipo_documento_id === TIPO_DOCUMENTO_NC_ID,
      ventaReferenciaId: v.venta_referencia_id,
      // La venta vino de una cuenta de salón con al menos una línea YA ENVIADA a
      // cocina. Lo consume el modal de anulación: reponer comida que ya se cocinó
      // mete al stock ingredientes que físicamente no existen, así que ahí el
      // checkbox "Reponer el stock" nace DESTILDADO (owner, 2026-08-15). Es uno
      // solo para toda la venta y basta con que ALGUNA línea se haya despachado
      // (owner, 2026-08-23): el cajero lo tilda si igual quiere reponer.
      // `false` en la venta de POS, que no viene de ninguna cuenta.
      tieneLineasDespachadas: v.tiene_lineas_despachadas === true,
      canal: v.canal,
      estado: v.estado,
      totalBruto: v.total_bruto,
      totalDescuentos: v.total_descuentos,
      totalRecargos: v.total_recargos,
      totalImpuestos: v.total_impuestos,
      totalFinal: v.total_final,
      baseVentasTotalFinal: v.base_ventas_total_final,
      baseVentasSinImpuestos: v.base_ventas_sin_impuestos,
      // Sin esto el desglose congelado no se puede ORDENAR como se aplicó: el
      // orden de los pasos es del tenant y editable. `null` en las ventas
      // anteriores al congelado; las notas de crédito congelan la suya
      // propia —heredada de la venta que corrigen— desde esta tarea.
      configCalculo: v.config_calculo,
      comentario: v.comentario,
      fecha: v.fecha,
      creadoEl: v.creado_el,
      propina: propinaRow
        ? {
            id: propinaRow.venta_propina_id,
            porcentajeSugerido: propinaRow.porcentaje_sugerido,
            montoSugerido: propinaRow.monto_sugerido,
            montoPagado: propinaRow.monto_pagado,
            tipo: propinaRow.tipo,
            estado: propinaRow.estado,
            garzonId: propinaRow.garzon_id,
            garzonNombre: propinaRow.garzon_nombre,
            sesionGarzonId: propinaRow.sesion_garzon_id,
            turnoId: propinaRow.turno_id,
            tipoGarzon: propinaRow.tipo_garzon,
            liquidacionId: propinaRow.liquidacion_id,
          }
        : null,
      detalles: detalles.map((d) => ({
        id: d['detalle_id'],
        itemId: d['item_id'],
        descripcion: d['descripcion'],
        cantidad: d['cantidad'],
        cantidadPresentacion: d['cantidad_presentacion'] ?? null,
        unidadCodigoPresentacion: d['unidad_codigo_presentacion'] ?? null,
        unidadCodigoBase: d['unidad_codigo_base'],
        precioUnitario: d['precio_unitario'],
        precioUnitarioOrigen: d['precio_unitario_origen'],
        tasaCambio: d['tasa_cambio'],
        monedaIdOrigen: d['moneda_id_origen'],
        subtotal: d['subtotal'],
        descuentoAplicado: d['descuento_aplicado'],
        recargoAplicado: d['recargo_aplicado'],
        // Va sí o sí: sin él las partes que la pantalla muestra no suman el
        // total que muestra. La fila cierra en la base, pero el drawer y el
        // modal de reembolso leen de acá, no de la tabla.
        ajusteVenta: d['ajuste_venta'],
        impuestoAplicado: d['impuesto_aplicado'],
        totalLinea: d['total_linea'],
        // null = servicio (sin fila en item_producto); el modal de reembolso
        // solo habilita devolución para modo 'cantidad'.
        modoInventario: d['modo_inventario'] ?? null,
        cantidadDevuelta: devueltoPorItem.get(d['item_id'] as string) ?? '0',
      })),
      reembolsos: reembolsos.map((r) => ({
        id: r['transaccion_id'],
        monto: r['monto'],
        estado: r['estado'],
        fecha: r['fecha_transaccion'],
        ordenId: r['orden_id'],
        codigoOrden: r['codigo_orden'],
      })),
      notasCredito: notasCredito.map((n) => ({
        id: n['venta_id'],
        totalFinal: n['total_final'],
        fecha: n['fecha'],
        comentario: n['comentario'],
      })),
      descuentos: descuentos.map((d) => ({
        id: d['venta_descuento_id'],
        descuentoId: d['descuento_id'],
        detalleId: d['detalle_id'],
        nombreRegla: d['nombre_regla'],
        modo: d['modo'],
        valorAplicado: d['valor_aplicado'],
        valorSolicitado: d['valor_solicitado'],
        porcentajeAplicado: d['porcentaje_aplicado'],
        aplicadoEn: d['aplicado_en'],
      })),
      recargos: recargos.map((r) => ({
        id: r['venta_recargo_id'],
        recargoId: r['recargo_id'],
        detalleId: r['detalle_id'],
        nombreRegla: r['nombre_regla'],
        modo: r['modo'],
        valorAplicado: r['valor_aplicado'],
        porcentajeAplicado: r['porcentaje_aplicado'],
        aplicadoEn: r['aplicado_en'],
      })),
      impuestos: impuestos.map((imp) => ({
        id: imp['venta_impuesto_id'],
        impuestoId: imp['impuesto_id'],
        detalleId: imp['detalle_id'],
        nombreRegla: imp['nombre_regla'],
        valorAplicado: imp['valor_aplicado'],
        porcentajeAplicado: imp['porcentaje_aplicado'],
        aplicadoEn: imp['aplicado_en'],
      })),
      promociones: promociones.map((p) => ({
        id: p['venta_promocion_id'],
        detalleId: p['detalle_id'],
        aplicacion: p['aplicacion'],
        promocionId: p['promocion_id'],
        nombre: p['nombre_promocion'],
        tipo: p['tipo'],
        valorEfectivo: p['valor_efectivo'],
        monto: p['monto'],
      })),
      customer: customerRow
        ? {
            id: customerRow['customer_id'],
            terceroId: customerRow['tercero_id'],
            nombre: customerRow['nombre'],
            rut: customerRow['rut'],
            direccion: customerRow['direccion'],
            telefono: customerRow['telefono'],
            email: customerRow['email'],
          }
        : null,
      pagos: pagos.map((p) => {
        const apps = aplicacionesPorPago.get(p['pago_id'] as string) ?? [];
        const montoAplicadoVenta = apps
          .filter((a) => a.tipo === 'venta')
          .reduce((acc, a) => acc.plus(a.monto), new Decimal(0))
          .toFixed(4);
        const montoAplicadoPropina = apps
          .filter((a) => a.tipo === 'propina')
          .reduce((acc, a) => acc.plus(a.monto), new Decimal(0))
          .toFixed(4);
        return {
          id: p['pago_id'],
          metodoPagoId: p['metodo_pago_id'],
          monedaOficialId: p['moneda_oficial_id'],
          cajaId: p['caja_id'],
          monto: p['monto'],
          vuelto: p['vuelto'],
          fecha: p['fecha'],
          referencia: p['referencia'],
          aplicaciones: apps.map((a) => ({
            tipo: a.tipo,
            monto: a.monto,
            referenciaId: a.referencia_id,
          })),
          montoAplicadoVenta,
          montoAplicadoPropina,
        };
      }),
    };
  }
}
