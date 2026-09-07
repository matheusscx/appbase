import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import {
  MAX_REINTENTOS_DEADLOCK,
  esDeadlock,
} from '../../common/db/reintento-deadlock';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import type { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService } from '../items/items.service';
import { MotivosTrasladoService } from '../motivos-traslado/motivos-traslado.service';
import { CreateTrasladoDto, LineaTrasladoDto } from './dto/create-traslado.dto';

export interface TrasladoLineaDetalle {
  itemId: string;
  itemNombre: string;
  cantidad: string;
  unidadMedida: string | null;
  /** Kardex del origen. */
  movimientoSalidaId: string;
  stockOrigenResultante: string;
  /** Kardex del destino. */
  movimientoEntradaId: string;
  stockDestinoResultante: string;
}

export interface TrasladoListItem {
  id: string;
  creadoEl: Date;
  origenId: string;
  origenNombre: string | null;
  destinoId: string;
  destinoNombre: string | null;
  motivoTrasladoId: string;
  motivoNombre: string | null;
  comentario: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  /**
   * Cuántos PRODUCTOS distintos movió — no cuántas líneas traía el body. Se
   * llama así y no `lineas` porque el detalle también colapsa por producto:
   * dos líneas del mismo ítem (dos lotes) son un solo renglón.
   */
  itemsMovidos: number;
}

export interface TrasladoDetalle extends TrasladoListItem {
  detalle: TrasladoLineaDetalle[];
}

/**
 * Escala del kardex: `movimientos_inventario.cantidad` y `stock_ubicacion.stock`
 * son `numeric(18,4)`, y toda CANTIDAD que sale por la API viaja en esa escala
 * —la misma que `stock` en `GET /items`— para poder compararlas sin
 * reformatear. No es la escala de la moneda: acá no hay plata.
 */
const ESCALA_KARDEX = 4;

interface UbicacionRow {
  ubicacion_id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
  activo: boolean;
}

interface TrasladoRow {
  traslado_id: string;
  creado_el: Date;
  comentario: string | null;
  ubicacion_origen_id: string;
  origen_nombre: string | null;
  ubicacion_destino_id: string;
  destino_nombre: string | null;
  motivo_traslado_id: string;
  motivo_nombre: string | null;
  usuario_id: string | null;
  usuario_nombre: string | null;
  items_movidos: number;
}

interface MovimientoDeTrasladoRow {
  item_id: string;
  item_nombre: string;
  unidad_medida: string | null;
  tipo: string;
  cantidad: string;
  movimiento_id: string;
  stock_resultante: string;
}

/**
 * `SELECT` común de la cabecera de un traslado, compartido por el listado y el
 * detalle: los dos necesitan exactamente los mismos nombres resueltos y no
 * tiene sentido que se desincronicen.
 *
 * ⚠️ Los `LEFT JOIN` de `ubicaciones` y `motivo_traslado` van **sin**
 * `eliminado_el IS NULL`, y es deliberado: un traslado ya ocurrido tiene que
 * seguir diciendo de dónde a dónde fue y por qué, aunque la bodega se haya
 * eliminado después (que es justamente lo que se hace tras vaciarla, spec § 8).
 * Filtrarlos convertiría el historial en filas sin origen. El de `usuarios` sí
 * filtra, igual que el kardex de mermas.
 */
const SELECT_CABECERA = `
  t.traslado_id, t.creado_el, t.comentario,
  t.ubicacion_origen_id, uo.nombre AS origen_nombre,
  t.ubicacion_destino_id, ud.nombre AS destino_nombre,
  t.motivo_traslado_id, mt.nombre AS motivo_nombre,
  t.usuario_id, us.nombre AS usuario_nombre`;

const JOINS_CABECERA = `
  LEFT JOIN ubicaciones uo ON uo.ubicacion_id = t.ubicacion_origen_id
  LEFT JOIN ubicaciones ud ON ud.ubicacion_id = t.ubicacion_destino_id
  LEFT JOIN motivo_traslado mt ON mt.motivo_traslado_id = t.motivo_traslado_id
  LEFT JOIN usuarios us ON us.usuario_id = t.usuario_id AND us.eliminado_el IS NULL`;

@Injectable()
export class TrasladosService {
  constructor(
    private readonly db: Db,
    private readonly inventarioService: InventarioService,
    private readonly itemsService: ItemsService,
    private readonly motivosTrasladoService: MotivosTrasladoService,
  ) {}

  /**
   * Mueve mercadería entre dos ubicaciones del tenant en **un solo acto
   * atómico**: no hay estado "en tránsito" ni recepción (decisión 2 del owner).
   *
   * El reintento es el de siempre (`MAX_REINTENTOS_DEADLOCK`), y solo vale
   * porque el único llamador es el controller: sin transacción envolvente, un
   * `40P01` reintenta limpio. ⚠️ Adentro de una transacción ajena
   * `db.transaccion` la REUSA (ADR-020), así que el reintento correría dentro
   * de una transacción ya abortada y fallaría con `25P02`. Si algún día hace
   * falta ese llamador, lo que hay que hacer es abrir `crearEnTransaccion`
   * —hoy privado— y llamarlo directo salteándose este loop, que es lo que
   * hacen los llamadores internos de `ventas`.
   */
  async crear(
    tenantId: string,
    usuarioId: string,
    dto: CreateTrasladoDto,
  ): Promise<TrasladoDetalle> {
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

  private async crearEnTransaccion(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    dto: CreateTrasladoDto,
  ): Promise<TrasladoDetalle> {
    if (dto.origenId === dto.destinoId) {
      throw new BadRequestException(
        'El origen y el destino de un traslado tienen que ser distintos',
      );
    }

    // Las dos ubicaciones en UNA consulta, no una por punta.
    //
    // `FOR SHARE`: el par del `FOR UPDATE` de `UbicacionesService.remove`.
    // Sin este lock, un `remove()` concurrente sobre el origen o el destino
    // podía contar 0 stock, borrar la ubicación, y este traslado terminaba
    // escribiendo saldo en una fila ya borrada — colgado e invisible, la
    // carrera que describe el comentario de `remove()`. Tomarlo acá retiene
    // la fila hasta el commit de esta transacción: si `remove()` llega
    // después, su `FOR UPDATE` espera a que este traslado termine y recién
    // entonces cuenta el saldo que este método dejó. Si `remove()` llega
    // antes, este `SELECT` espera a que su transacción termine y vuelve a
    // leer: la ubicación ya no tiene `eliminado_el IS NULL` y cae en el
    // `NotFoundException` de abajo. Compatible entre sí (dos traslados
    // pueden compartir la misma ubicación de origen o destino a la vez),
    // solo conflictúa con el `FOR UPDATE` exclusivo del borrado.
    const ubicaciones: UbicacionRow[] = await manager.query(
      `SELECT ubicacion_id, nombre, tipo, activo
         FROM ubicaciones
        WHERE ubicacion_id = ANY($1::uuid[]) AND tenant_id = $2
          AND eliminado_el IS NULL
        FOR SHARE`,
      [[dto.origenId, dto.destinoId], tenantId],
    );
    const origen = ubicaciones.find((u) => u.ubicacion_id === dto.origenId);
    const destino = ubicaciones.find((u) => u.ubicacion_id === dto.destinoId);
    if (!origen || !destino) {
      throw new NotFoundException('Ubicación no encontrada');
    }
    // Asimetría deliberada: el DESTINO tiene que estar activo, el ORIGEN no.
    // Si una bodega desactivada no pudiera ser origen, su mercadería quedaría
    // encerrada — y desactivarla es justamente el paso previo a vaciarla.
    if (!destino.activo) {
      throw new BadRequestException(
        `"${destino.nombre}" está desactivada: no puede recibir un traslado`,
      );
    }

    // No se guarda lo que devuelve: la respuesta se relee entera al final con
    // `findOne`, que resuelve el nombre del motivo por JOIN. Acá lo que
    // importa es el `FOR SHARE` que toma —el par del `FOR UPDATE` de
    // `MotivosTrasladoService.remove`— y que rechace un motivo inválido.
    await this.motivosTrasladoService.assertMotivoActivo(
      manager,
      tenantId,
      dto.motivoTrasladoId,
    );

    // Cantidades a Decimal una sola vez. El signo ya lo rechaza el DTO en el
    // borde (`@IsDecimalPositivo`), así que este guard cubre solo a un llamador
    // interno que no pase por el pipe —hoy no hay ninguno— y se queda porque
    // sin él una cantidad negativa pasaría el tope (cualquier saldo es mayor
    // que un negativo) y recién moriría adentro del movimiento, con el
    // documento ya insertado.
    const pedidoPorItem = new Map<string, Decimal>();
    for (const linea of dto.lineas) {
      const cantidad = new Decimal(linea.cantidad);
      if (cantidad.isNaN() || cantidad.lessThanOrEqualTo(0)) {
        throw new BadRequestException('La cantidad debe ser mayor a cero');
      }
      // Dos líneas del mismo producto (dos lotes distintos, por ejemplo) se
      // SUMAN antes de topear: si cada una topeara por su cuenta contra el
      // saldo entero, juntas se llevarían más de lo que hay.
      pedidoPorItem.set(
        linea.itemId,
        (pedidoPorItem.get(linea.itemId) ?? new Decimal(0)).plus(cantidad),
      );
    }

    /**
     * ⚠️ **El orden de bloqueo, que es lo delicado de este método.**
     *
     * El ancla del `FOR UPDATE` es `item_producto` —una fila por ítem, que
     * siempre existe—, nunca `stock_ubicacion`, cuya fila puede no existir
     * todavía y sobre la que `FOR UPDATE` no lockearía nada
     * (`docs/patterns/backend.md` §15). La consecuencia buena: un traslado
     * lockea **una sola fila por ítem** sin importar cuántas ubicaciones
     * toque, así que dos traslados opuestos del MISMO producto (bodega→local
     * y local→bodega a la vez) piden la misma fila y no pueden abrazarse.
     *
     * Lo que sí sigue en pie es el orden **entre ítems**: dos traslados con
     * los mismos dos productos en orden inverso cierran el ciclo clásico. Por
     * eso las líneas se ordenan por `item_id` —el contrato de siempre, el
     * mismo `localeCompare` que usa `ventas.crear()`— y se lockea, y después
     * se mueve, en ese orden. Red: `test/traslados.e2e-spec.ts`, caso "dos
     * traslados cruzados".
     */
    const lineasOrdenadas = dto.lineas
      .map((linea, idx) => ({ linea, idx }))
      .sort(
        (a, b) => a.linea.itemId.localeCompare(b.linea.itemId) || a.idx - b.idx,
      )
      .map((x) => x.linea);
    const itemIdsOrdenados = [...new Set(lineasOrdenadas.map((l) => l.itemId))];

    /**
     * **Los locks, en UN statement y ordenados por `item_id`.** Es la misma
     * forma que `ItemsService.validarStockAlPedir`, que lockea la misma tabla
     * con el mismo propósito: el nodo `LockRows` va por encima del `Sort`, así
     * que las filas se lockean en el orden del `ORDER BY`.
     *
     * ⚠️ **Este `ORDER BY` tiene que ordenar igual que el `localeCompare` con
     * el que ordena `ventas.crear()`/`anular()`**, o una venta y un traslado
     * simultáneos sobre los mismos dos ítems se bloquean en cruz. Ordena
     * igual, y no por casualidad: `item_id` es `uuid`, que **no es un tipo
     * collatable** (`pg_type.typcollation = 0`, medido en el Postgres del
     * stack), así que Postgres no aplica collation ninguna — compara los 16
     * bytes— y sobre la forma canónica en minúsculas eso coincide con el orden
     * lexicográfico de los strings. Medido: 20.000 uuid ordenados por Postgres
     * y por `localeCompare`, cero posiciones distintas. La advertencia de
     * `ventas.service.ts` sobre "la collation puede ordenar distinto" vale
     * para columnas de texto, no para ésta.
     *
     * Se hizo un statement por ítem y la revisión lo levantó como N+1 con
     * razón: el `nombre` es dato derivado por fila y el motivo que se había
     * escrito para el loop era falso.
     *
     * No filtra `i.eliminado_el IS NULL`: un producto discontinuado se puede
     * trasladar (es lo que permite vaciar la bodega para poder eliminarla), y
     * el chokepoint ya tiene la allowlist de motivos que lo decide. El
     * `nombre` viaja gratis en la misma query y es el que arma el 400 del tope.
     */
    const lockRows: { item_id: string; nombre: string }[] = await manager.query(
      `SELECT ip.item_id, i.nombre
         FROM item_producto ip
         JOIN items i ON i.item_id = ip.item_id
        WHERE ip.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
        ORDER BY ip.item_id
        FOR UPDATE OF ip`,
      [itemIdsOrdenados, tenantId],
    );
    if (lockRows.length !== itemIdsOrdenados.length) {
      // Mismo mensaje opaco que el chokepoint: un id de otro tenant tiene que
      // ser indistinguible de uno inexistente.
      throw new BadRequestException('El item no tiene control de stock');
    }
    const nombrePorItem = new Map(lockRows.map((r) => [r.item_id, r.nombre]));

    // ⛔ El saldo se lee DESPUÉS del lock y en un statement APARTE. Bajo READ
    // COMMITTED el snapshot se toma antes de encolarse en el lock, así que
    // leerlo en el mismo `SELECT … FOR UPDATE` lo devuelve viejo y sobrevende
    // (`docs/patterns/backend.md` §15). Una sola query para todos los ítems.
    const saldoRows: { item_id: string; stock: string }[] = await manager.query(
      `SELECT item_id, stock FROM stock_ubicacion
        WHERE ubicacion_id = $1 AND item_id = ANY($2::uuid[])`,
      [dto.origenId, itemIdsOrdenados],
    );
    const saldoPorItem = new Map(
      saldoRows.map((r) => [r.item_id, new Decimal(r.stock)]),
    );

    /**
     * **El tope es asimétrico** (spec § 5.3):
     * - Sacar del **local** topea contra lo apartado: no te podés llevar lo
     *   que la mesa 4 ya pidió.
     * - Sacar de una **bodega** topea contra su stock físico y nada más,
     *   porque de ahí no se vende y no hay nada apartado.
     *
     * Por eso lo comprometido ni siquiera se consulta cuando el origen es una
     * bodega: sería una consulta cara (recorre las líneas de todas las cuentas
     * abiertas y explota recetas y combos) para restar cero.
     *
     * ⛔ **Va DESPUÉS del statement de locks, y el orden es load-bearing** — es el
     * mismo contrato que ya fija `ItemsService.validarStockAlPedir` (paso 3 de
     * su docblock, con su propio test: "toma el lock de stock ANTES de leer el
     * comprometido"). `SalonesService.agregarLinea` inserta la línea de cuenta
     * dentro de una transacción que toma `FOR UPDATE OF ip` sobre estos mismos
     * ítems, así que el lock de arriba SÍ serializa contra ella aunque no
     * proteja `cuenta_lineas`: leyendo después, o la línea ya commiteó y se ve,
     * o la otra transacción está encolada detrás. Leyendo antes, el traslado
     * ve `apartado` viejo y saca del local lo que la mesa acaba de pedir.
     * Se intentó moverla arriba del lock para acortar su retención y lo
     * levantó la revisión: la retención se paga, como se paga en
     * `validarStockAlPedir` (medido ahí: 0,36 ms).
     *
     * ⚠️ **Lo que este número NO garantiza.** `comprometidoPorItem` degrada a
     * `0` el consumo de un ítem cuya conversión de unidad esté rota, en vez de
     * lanzar: la razón escrita en `items.service.ts` es que ahí alimenta una
     * LECTURA (`GET /items`) y tumbar el menú del tenant es peor que
     * sobrevender ese ítem. Acá alimenta un guard de ESCRITURA, así que la
     * misma degradación significa que un traslado podría vaciar del local algo
     * que una mesa ya pidió. Es una exposición nueva y acotada a ese caso; se
     * deja anotada en vez de endurecer el método compartido, que rompería el
     * menú.
     */
    const origenEsLocal = origen.tipo === 'local';
    const comprometido = origenEsLocal
      ? await this.itemsService.comprometidoPorItem(tenantId)
      : new Map<string, Decimal>();

    for (const [itemId, pedido] of pedidoPorItem) {
      const fisico = saldoPorItem.get(itemId) ?? new Decimal(0);
      const apartado = comprometido.get(itemId) ?? new Decimal(0);
      const disponible = origenEsLocal ? fisico.minus(apartado) : fisico;
      if (pedido.greaterThan(disponible)) {
        const nombre = nombrePorItem.get(itemId) ?? itemId;
        const faltan = pedido.minus(disponible);
        const porApartado = origenEsLocal && apartado.greaterThan(0);
        throw new BadRequestException(
          `Stock insuficiente de "${nombre}": faltan ${faltan.toString()} ` +
            `en ${origen.nombre} ` +
            (porApartado
              ? `(hay ${fisico.toString()}, pero ${apartado.toString()} ya están ` +
                'apartados por cuentas abiertas)'
              : `(disponible ${disponible.toString()}, solicitado ${pedido.toString()})`),
        );
      }
    }

    const insertRows: { traslado_id: string }[] = await manager.query(
      `INSERT INTO traslados
         (tenant_id, ubicacion_origen_id, ubicacion_destino_id,
          motivo_traslado_id, comentario, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING traslado_id`,
      [
        tenantId,
        dto.origenId,
        dto.destinoId,
        dto.motivoTrasladoId,
        dto.comentario ?? null,
        usuarioId,
      ],
    );
    const trasladoId = insertRows[0].traslado_id;

    for (const linea of lineasOrdenadas) {
      await this.moverLinea(
        manager,
        tenantId,
        usuarioId,
        dto,
        linea,
        trasladoId,
      );
    }

    // La respuesta del POST se RELEE con `findOne`, no se arma a mano: dos
    // constructores de la misma forma se desincronizan, y ya lo habían hecho
    // —el POST devolvía un renglón por línea del body y el GET uno por
    // producto, con el mismo nombre de campo—. Además así `creadoEl` es el
    // `NOW()` de la fila y no un `new Date()` parecido, y `usuarioNombre` sale
    // resuelto en las dos. Cuesta dos consultas al final de la transacción;
    // `this.db.query` resuelve el manager activo (ADR-020), así que lee lo que
    // esta misma transacción acaba de escribir.
    return this.findOne(tenantId, trasladoId);
  }

  /**
   * Las **dos** filas de kardex de una línea: salida en el origen, entrada en
   * el destino, colgadas del mismo `trasladoId`.
   *
   * ⛔ **La entrada no lleva `costoUnitario`.** El costo es uno solo por
   * producto para todo el tenant (spec § 3.2): un traslado mueve kilos, no
   * plata. Pasarle el costo volvería a promediarlo contra sí mismo e inflaría
   * la valorización en cada traslado. `registrarMovimiento` congela solo el
   * `costo_actual` vigente cuando no se le pasa costo, que es exactamente lo
   * que queremos acá.
   */
  private async moverLinea(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    dto: CreateTrasladoDto,
    linea: LineaTrasladoDto,
    trasladoId: string,
  ): Promise<void> {
    const salida = await this.inventarioService.registrarMovimiento(manager, {
      tenantId,
      itemId: linea.itemId,
      ubicacionId: dto.origenId,
      // Solo la usa el modo `serie`: la ubicación de una unidad serializada es
      // un campo único, así que la salida es la que la mueve.
      ubicacionDestinoId: dto.destinoId,
      usuarioId,
      tipo: 'salida',
      motivo: 'traslado',
      cantidad: linea.cantidad,
      comentario: dto.comentario ?? null,
      trasladoId,
      unidadIds: linea.unidadIds,
      loteId: linea.loteId,
    });

    await this.inventarioService.registrarMovimiento(manager, {
      tenantId,
      itemId: linea.itemId,
      ubicacionId: dto.destinoId,
      usuarioId,
      tipo: 'entrada',
      motivo: 'traslado',
      cantidad: linea.cantidad,
      comentario: dto.comentario ?? null,
      trasladoId,
      // Lo que la salida movió de verdad, no lo que el cliente pidió: en modo
      // serie o lote la salida pudo auto-seleccionar por FIFO, y la entrada
      // tiene que registrar esas mismas unidades/lotes.
      unidadIds: salida.unidadIds,
      // La salida FIFO devuelve `loteConsumos`; la salida con lote elegido
      // devuelve `loteId` y la cantidad es la de la línea. Se normaliza acá y
      // no en el chokepoint para no cambiarle el camino de detalle a los otros
      // llamadores de salida con lote (venta, merma, ajuste), que no son de
      // esta tarea.
      loteConsumos:
        salida.loteConsumos ??
        (salida.loteId
          ? [{ loteId: salida.loteId, cantidad: linea.cantidad }]
          : undefined),
    });

    // Sin `return`: la respuesta la relee `findOne` del kardex recién escrito.
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<TrasladoListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);

    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM traslados t
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId],
    );
    const total = countRows[0]?.total ?? 0;

    // El conteo sale por agregación en la MISMA query, no con una consulta por
    // traslado. Cuenta solo las salidas para no duplicar: cada línea deja dos
    // filas de kardex.
    const rows: TrasladoRow[] = await this.db.query(
      `SELECT ${SELECT_CABECERA},
              COUNT(DISTINCT mv.item_id)::int AS items_movidos
         FROM traslados t
         ${JOINS_CABECERA}
         LEFT JOIN movimientos_inventario mv
                ON mv.traslado_id = t.traslado_id
               AND mv.tipo = 'salida' AND mv.eliminado_el IS NULL
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
        GROUP BY t.traslado_id, uo.nombre, ud.nombre, mt.nombre, us.nombre
        ORDER BY t.creado_el DESC
        LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset],
    );

    return {
      data: rows.map((r) => this.mapCabecera(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async findOne(tenantId: string, id: string): Promise<TrasladoDetalle> {
    const rows: TrasladoRow[] = await this.db.query(
      `SELECT ${SELECT_CABECERA}, 0 AS items_movidos
         FROM traslados t
         ${JOINS_CABECERA}
        WHERE t.traslado_id = $1 AND t.tenant_id = $2
          AND t.eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Traslado ${id} no encontrado`);
    }

    // Las líneas se reconstruyen del kardex, que es la fuente de verdad: el
    // documento no repite cantidades. `LEFT JOIN items` sin filtrar el borrado
    // a propósito —el mismo criterio que el kardex y las mermas—: un producto
    // discontinuado después no puede borrar el traslado que lo movió.
    const movs: MovimientoDeTrasladoRow[] = await this.db.query(
      `SELECT mv.item_id, i.nombre AS item_nombre, p.unidad_medida,
              mv.tipo, mv.cantidad, mv.movimiento_id, mv.stock_resultante
         FROM movimientos_inventario mv
         LEFT JOIN items i ON i.item_id = mv.item_id
         LEFT JOIN item_producto p ON p.item_id = mv.item_id
        WHERE mv.traslado_id = $1 AND mv.tenant_id = $2
          AND mv.eliminado_el IS NULL
        ORDER BY i.nombre ASC`,
      [id, tenantId],
    );

    /**
     * Un renglón por PRODUCTO, no por movimiento: dos líneas del mismo ítem
     * (dos lotes, por ejemplo) son dos pares de filas y un solo renglón, con
     * la cantidad sumada.
     *
     * ⚠️ **Los saldos NO se toman "de la última fila", y el orden acá no
     * decide nada.** `creado_el` es `transaction_timestamp()`: las 2N filas de
     * un traslado comparten el valor exacto, así que "la última" no existe. Se
     * toman por extremo, que es exacto: dentro de un traslado las salidas del
     * origen solo BAJAN ese saldo (el mínimo es el final) y las entradas del
     * destino solo lo SUBEN (el máximo es el final), y nadie más puede tocar
     * esas filas mientras la transacción sostiene el lock ancla del ítem. El
     * `movimiento_id` que se expone es el de ese movimiento extremo, o sea el
     * que dejó el saldo final.
     *
     * ⛔ Eso se apoya en DOS guards de `crearEnTransaccion`, y si alguno cae,
     * esto reporta saldos falsos **en silencio**: (1) `cantidad > 0`, sin lo
     * cual una salida podría subir el saldo del origen; (2)
     * `origenId !== destinoId`, sin lo cual las 2N filas caen sobre la misma
     * ubicación y "mínimo" y "máximo" dejan de significar origen y destino.
     */
    const porItem = new Map<string, TrasladoLineaDetalle>();
    for (const mv of movs) {
      const acc = porItem.get(mv.item_id) ?? {
        itemId: mv.item_id,
        itemNombre: mv.item_nombre,
        cantidad: '0',
        unidadMedida: mv.unidad_medida,
        movimientoSalidaId: '',
        stockOrigenResultante: '',
        movimientoEntradaId: '',
        stockDestinoResultante: '',
      };
      const resultante = new Decimal(mv.stock_resultante);
      if (mv.tipo === 'salida') {
        if (
          acc.movimientoSalidaId === '' ||
          resultante.lessThan(acc.stockOrigenResultante)
        ) {
          acc.movimientoSalidaId = mv.movimiento_id;
          acc.stockOrigenResultante = mv.stock_resultante;
        }
        // La cantidad sale de las salidas y no de las entradas para no contarla
        // dos veces: las dos puntas mueven lo mismo.
        acc.cantidad = new Decimal(acc.cantidad)
          .plus(mv.cantidad)
          .toFixed(ESCALA_KARDEX);
      } else if (
        acc.movimientoEntradaId === '' ||
        resultante.greaterThan(acc.stockDestinoResultante)
      ) {
        acc.movimientoEntradaId = mv.movimiento_id;
        acc.stockDestinoResultante = mv.stock_resultante;
      }
      porItem.set(mv.item_id, acc);
    }
    const detalle = [...porItem.values()];

    return {
      ...this.mapCabecera(rows[0]),
      itemsMovidos: detalle.length,
      detalle,
    };
  }

  private mapCabecera(r: TrasladoRow): TrasladoListItem {
    return {
      id: r.traslado_id,
      creadoEl: r.creado_el,
      origenId: r.ubicacion_origen_id,
      origenNombre: r.origen_nombre,
      destinoId: r.ubicacion_destino_id,
      destinoNombre: r.destino_nombre,
      motivoTrasladoId: r.motivo_traslado_id,
      motivoNombre: r.motivo_nombre,
      comentario: r.comentario,
      usuarioId: r.usuario_id,
      usuarioNombre: r.usuario_nombre,
      itemsMovidos: r.items_movidos,
    };
  }
}
