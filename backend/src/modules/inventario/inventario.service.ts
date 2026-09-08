// backend/src/modules/inventario/inventario.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Db } from '../../common/db/db.service';
import { ESCALA_COSTO } from '../../common/constants/escalas';
import {
  assertCostoNoColapsaACero,
  convertirCostoUnitario,
} from '../../common/utils/costo-conversion-unidad.util';
import Decimal from 'decimal.js';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';
import { CatalogService } from '../catalog/catalog.service';
import { UbicacionesService } from '../ubicaciones/ubicaciones.service';
import type { FindMovimientosDto } from './dto/find-movimientos.dto';
import type { AjusteCostoDto } from './dto/ajuste-costo.dto';
import {
  bordeFechaSql,
  bordeHastaSql,
  requiereZonaTenant,
  zonaHorariaTenant,
} from '../../common/utils/rango-fecha.util';

export interface SerieInput {
  serie: string;
  condicion?: string; // 'nuevo' | 'usado' | 'reacondicionado'
  garantiaHasta?: string; // ISO date string
  loteId?: string;
}

export interface LoteInput {
  codigoLote: string;
  fechaElaboracion?: string;
  fechaVencimiento?: string;
}

export interface RegistrarMovimientoParams {
  tenantId: string;
  itemId: string;
  /**
   * Dónde ocurre el movimiento. Obligatorio y sin default: un default
   * silencioso mete stock en el local cada vez que un llamador se olvide de
   * pasarlo, y el olvido es invisible en un tenant de una sola ubicación.
   */
  ubicacionId: string;
  tipo: 'entrada' | 'salida' | 'ajuste';
  motivo: string;
  cantidad: string;
  usuarioId: string | null;
  ventaId?: string | null;
  comentario?: string | null;
  // Costo pagado en este movimiento. En una entrada por compra recalcula el
  // promedio ponderado de item_producto.costo_actual; en el resto solo se
  // congela en el kardex. Si no viene, se congela el costo_actual vigente.
  costoUnitario?: string | null;
  // Modo 'serie'
  series?: SerieInput[]; // entrada serie: N unidades a crear
  unidadIds?: string[]; // salida serie: IDs de unidades a consumir
  // Modo 'lote'
  lote?: LoteInput; // entrada lote: crea o agrega a lote existente
  loteId?: string; // salida lote: lote a descontar
  causaMermaId?: string | null;
  motivoDiferenciaId?: string | null; // solo en motivo='recuento'
  /**
   * El documento interno que ata las DOS filas de kardex de un traslado
   * (salida en el origen, entrada en el destino). Solo en motivo='traslado'.
   */
  trasladoId?: string | null;
  /**
   * A dónde se van físicamente las unidades serializadas. Solo en la SALIDA de
   * un traslado en modo `serie`, y ahí es obligatorio.
   *
   * Existe porque la ubicación de una unidad serializada es **un solo campo**
   * (`item_unidad.ubicacion_id`): moverla es UNA escritura, no una resta en el
   * origen y una suma en el destino. La hace la salida —que es la que valida
   * que la unidad esté donde dice estar— y la entrada solo recalcula el saldo
   * del destino contando lo que ya llegó. En modo `cantidad` y `lote` no hace
   * falta: ahí el saldo sí es un par de números y cada mitad la escribe su
   * propio movimiento.
   */
  ubicacionDestinoId?: string | null;
  /**
   * Lo que la SALIDA de un traslado descontó de cada lote, tal cual. Solo en
   * la ENTRADA de un traslado en modo `lote`: la entrada suma exactamente eso
   * en el destino en vez de re-elegir por su cuenta (la salida pudo haber
   * tomado FIFO de varios lotes), y así las dos filas de kardex describen el
   * mismo movimiento.
   */
  loteConsumos?: { loteId: string; cantidad: string }[];
}

interface MoverResult {
  stockResultante: Decimal;
  unidadIds?: string[];
  loteId?: string;
  loteConsumos?: { loteId: string; cantidad: string }[];
}

/**
 * Los únicos motivos que un ítem eliminado sigue aceptando: los que **deshacen**
 * algo. Anular una venta o recibir una devolución cierran una operación que
 * existió y cuya plata ya se movió, así que tienen que poder ejecutarse aunque
 * el producto se haya discontinuado después. Comprar, mermar, ajustar costo,
 * contar o vender un producto eliminado no tiene operación real detrás.
 *
 * `traslado` entró el 2026-09-07 con `POST /traslados` y no rompe ese criterio:
 * mover mercadería de lugar no crea ni valoriza nada —el costo no se toca y el
 * total del tenant no cambia—, y sin él una bodega llena de producto
 * discontinuado no se podría vaciar nunca, que es justo lo que hay que hacer
 * para poder eliminar esa bodega (`docs/features/bodegas-y-traslados.md`, «Bordes»,
 * última fila).
 *
 * Es una allowlist y no una lista de rechazos a propósito: un motivo nuevo nace
 * rechazado sobre un eliminado, que es el lado seguro del default.
 */
const MOTIVOS_SOBRE_ITEM_ELIMINADO = ['anulacion', 'devolucion', 'traslado'];

/**
 * Entradas que mueven el promedio ponderado. `compra` es la obvia: trae
 * unidades nuevas con un costo nuevo.
 *
 * `anulacion` y `devolucion` entraron el 2026-08-22 por decisión del owner
 * (2026-08-15): la mercadería que vuelve reingresa **al costo con el que
 * salió** —congelado en el kardex, ligado a la venta— y el promedio se
 * recalcula incluyéndola. Sin eso el reingreso sumaba unidades al CPP vigente
 * sin aportar valor: vender 1 a $50, comprar 5 a $70 y anular la venta dejaba
 * el inventario valorizado $7,14 de más, y ese sesgo contaminaba cada CPP
 * posterior.
 *
 * Lo que NO recalcula sigue siendo todo lo demás (`ajuste_manual`,
 * `inventario_inicial`, `recuento`): ahí el costo que llega es de captura, no
 * de una operación que aporte valor conocido al inventario.
 */
const MOTIVOS_QUE_RECALCULAN_CPP = ['compra', 'anulacion', 'devolucion'];

@Injectable()
export class InventarioService {
  constructor(
    @InjectRepository(MovimientoInventario)
    private readonly movimientoRepo: Repository<MovimientoInventario>,
    private readonly db: Db,
    private readonly catalogService: CatalogService,
    private readonly ubicacionesService: UbicacionesService,
  ) {}

  async registrarMovimiento(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
  ): Promise<{
    movimientoId: string;
    stockAnterior: string;
    stockResultante: string;
    // Costo vigente antes/después de este movimiento, leídos dentro del mismo
    // FOR UPDATE que serializa la concurrencia — a diferencia de un pre-check
    // que corre antes de tomar el lock (bajo READ COMMITTED, una compra
    // concurrente que commitea en el medio ya es visible), estos valores son
    // los que de verdad quedaron escritos en el kardex.
    costoActualPrevio: string | null;
    costoActual: string | null;
    /**
     * Qué se movió realmente, para que el llamador no tenga que adivinarlo.
     * Solo lo usa el traslado: su SALIDA puede auto-seleccionar unidades o
     * lotes por FIFO, y la ENTRADA tiene que registrar **esos mismos** —no
     * volver a elegir— o las dos filas de kardex describirían movimientos
     * distintos.
     */
    unidadIds?: string[];
    loteConsumos?: { loteId: string; cantidad: string }[];
    loteId?: string;
  }> {
    if (!params.ubicacionId) {
      throw new BadRequestException('El movimiento necesita una ubicación');
    }

    // `item_producto` no tiene `tenant_id`: es una extensión de `items` con PK
    // compartida, así que el tenant vive en el padre (ver `docs/patterns/backend.md`
    // § "Tablas sin tenant_id"). El JOIN es la única forma de acotarlo acá — y este
    // es el lugar donde hay que hacerlo, porque este método es el chokepoint por el
    // que pasa TODO movimiento de stock del sistema. Antes la defensa vivía repartida
    // en los llamadores, que hoy validan el ítem contra el tenant antes de llamar:
    // correcto, pero sin red para el llamador que se agregue mañana.
    //
    // `FOR UPDATE OF ip` y no `FOR UPDATE` a secas: sin el `OF`, Postgres lockea
    // también la fila de `items`, que es huella de locks nueva en el camino más
    // caliente del sistema — exactamente donde la auditoría del 2026-08-15 encontró
    // deadlocks por orden de bloqueo. El ancla del lock es `item_producto`, no
    // `stock_ubicacion`, y se queda ahí para siempre (docs/patterns/backend.md §15):
    // la fila de `item_producto` existe desde que el ítem es un producto, la de
    // `stock_ubicacion` puede no existir todavía (un producto que nunca se movió en
    // esa ubicación), y `FOR UPDATE` sobre una fila inexistente no lockea nada.
    // La contracara de anclar acá es que el saldo YA NO VIVE en la fila lockeada:
    // por eso se lee en un statement aparte, y no en éste (ver el bloque ⛔ de
    // más abajo).
    //
    // No filtra `i.eliminado_el IS NULL` a propósito, y ahora con una regla
    // explícita detrás en vez de una omisión: filtrarlo haría que anular una
    // venta de un ítem borrado después dejara de reponer. Lo que decide qué
    // pasa sobre un eliminado es el guard de abajo, no la ausencia del filtro.
    //
    // ⛔ El saldo NO se lee acá, y no es una omisión: es el arreglo de la
    // sobreventa que este mismo statement causaba. Bajo READ COMMITTED, el
    // snapshot del statement se toma ANTES de encolarse en el lock; al
    // despertar, Postgres re-evalúa (EvalPlanQual) **solo la fila lockeada**,
    // no las demás del join. Mientras el saldo vivía en `item_producto` se
    // refrescaba solo; leído por `LEFT JOIN` desde `stock_ubicacion` en este
    // statement llegaba VIEJO — y con el `ON CONFLICT DO UPDATE` de más abajo,
    // que escribe el saldo absoluto, eso es un lost update: stock 10, dos
    // salidas concurrentes de 6, pasaban las dos.
    // Ver `docs/patterns/backend.md` §15 y
    // `test/sobreventa-concurrente-ubicacion.e2e-spec.ts`.
    const productoRows: {
      modo_inventario: string;
      costo_actual: string | null;
      item_nombre: string;
      item_eliminado_el: Date | null;
    }[] = await manager.query(
      `SELECT ip.modo_inventario, ip.costo_actual,
              i.nombre AS item_nombre, i.eliminado_el AS item_eliminado_el
         FROM item_producto ip
         JOIN items i ON i.item_id = ip.item_id
        WHERE ip.item_id = $1 AND i.tenant_id = $2
        FOR UPDATE OF ip`,
      [params.itemId, params.tenantId],
    );
    // Mismo mensaje para "no existe", "no es producto" y "es de otro tenant": un id
    // ajeno tiene que ser indistinguible de uno inexistente, o la respuesta se vuelve
    // un oráculo que confirma qué ítems existen en otros tenants.
    if (!productoRows.length) {
      throw new BadRequestException('El item no tiene control de stock');
    }

    // El mensaje nombra el producto y dice que está eliminado, en vez de caer en
    // el genérico de arriba: ese es deliberadamente opaco porque protege el
    // acote por tenant, y significa otra cosa. Acá no hay nada que ocultar —
    // quien llama ya sabe que el ítem existe— y confundirlos manda a buscar un
    // problema de permisos donde hay un producto discontinuado.
    if (
      productoRows[0].item_eliminado_el != null &&
      !MOTIVOS_SOBRE_ITEM_ELIMINADO.includes(params.motivo)
    ) {
      throw new BadRequestException(
        `El producto "${productoRows[0].item_nombre}" está eliminado: ` +
          'solo admite movimientos de anulación, devolución o traslado',
      );
    }

    // El saldo, en un statement APARTE y ya con el lock en la mano: éste toma
    // snapshot nuevo, así que ve lo que commiteó la transacción que acaba de
    // soltar el lock de arriba. Es la única lectura de saldo que sirve para
    // decidir una salida.
    //
    // De paso separa los dos casos que el `LEFT JOIN` + `COALESCE` mezclaba:
    // "no es producto / es de otro tenant" son cero filas del statement de
    // arriba (el guard genérico), y "nunca se movió en esta ubicación" son cero
    // filas de éste — saldo CERO, no error. El upsert de más abajo crea la fila
    // la primera vez que el ítem se mueve ahí.
    const saldoRows: { stock: string }[] = await manager.query(
      `SELECT stock FROM stock_ubicacion
        WHERE item_id = $1 AND ubicacion_id = $2`,
      [params.itemId, params.ubicacionId],
    );

    const modo = productoRows[0].modo_inventario;
    const stockAnterior = new Decimal(saldoRows[0]?.stock ?? 0);
    const cantidad = new Decimal(params.cantidad);

    // El ajuste de costo no mueve cantidad, mueve valor: es el único motivo
    // que registra cantidad 0.
    const esAjusteCosto = params.motivo === 'ajuste_costo';
    if (esAjusteCosto) {
      if (params.tipo !== 'ajuste') {
        throw new BadRequestException("El ajuste de costo usa tipo 'ajuste'");
      }
      if (!cantidad.isZero()) {
        throw new BadRequestException('El ajuste de costo no mueve cantidad');
      }
      if (params.costoUnitario == null) {
        throw new BadRequestException(
          'El ajuste de costo requiere el costo nuevo',
        );
      }
    } else if (cantidad.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    if (params.motivo === 'merma' && !params.causaMermaId) {
      throw new BadRequestException('La merma requiere una causa tipificada');
    }
    if (params.motivo !== 'merma' && params.causaMermaId) {
      throw new BadRequestException('causa_merma_id solo aplica a merma');
    }
    if (params.motivo === 'recuento' && !params.motivoDiferenciaId) {
      throw new BadRequestException(
        'El recuento requiere una causa de diferencia tipificada',
      );
    }
    if (params.motivo !== 'recuento' && params.motivoDiferenciaId) {
      throw new BadRequestException(
        'motivo_diferencia_id solo aplica a recuento',
      );
    }
    // Mismo par de guards que `causa_merma_id` y `motivo_diferencia_id`: el
    // motivo exige su documento, y el documento no se cuelga de otro motivo.
    // Sin el primero, una de las dos filas del traslado podría quedar
    // huérfana y el kardex ya no permitiría reconstruir "estos 5 kg salieron
    // de acá y entraron allá".
    if (params.motivo === 'traslado' && !params.trasladoId) {
      throw new BadRequestException(
        'El traslado requiere el documento que lo respalda',
      );
    }
    if (params.motivo !== 'traslado' && params.trasladoId) {
      throw new BadRequestException('traslado_id solo aplica a traslado');
    }
    // Los otros dos campos que solo el traslado usa. Van con su guard por la
    // misma razón que `causa_merma_id`: un campo que llega poblado donde no
    // significa nada es un llamador confundido, y callarlo hace que el error
    // aparezca lejos de su causa.
    if (
      params.motivo !== 'traslado' &&
      (params.ubicacionDestinoId || params.loteConsumos)
    ) {
      throw new BadRequestException(
        'ubicacionDestinoId y loteConsumos solo aplican a traslado',
      );
    }
    // Y dentro del traslado, cada uno a SU punta: `ubicacionDestinoId` lo lee
    // la salida (es la que mueve la unidad serializada) y `loteConsumos` la
    // entrada (es la que suma lo que la salida descontó). Cruzados se
    // ignorarían en silencio, que es el "llamador confundido que falla lejos
    // de su causa" que estos guards existen para atajar.
    if (params.motivo === 'traslado') {
      if (params.tipo === 'entrada' && params.ubicacionDestinoId) {
        throw new BadRequestException(
          'ubicacionDestinoId es de la salida del traslado, no de la entrada',
        );
      }
      if (params.tipo === 'salida' && params.loteConsumos) {
        throw new BadRequestException(
          'loteConsumos es de la entrada del traslado, no de la salida',
        );
      }
    }

    const costoActualPrevio = productoRows[0].costo_actual ?? null;

    // El `0` es un costo REAL —mercadería de donación o muestra— y por eso
    // cualquier movimiento lo acepta (decisión del owner, 2026-08-29). Acá se
    // valida el SIGNO y nada más.
    //
    // ⚠️ No agregar acá un `> 0` por motivo. Se intentó —prohibir el 0 en
    // `ajuste_costo`, para que ese ajuste no anule el promedio— y rompía un
    // camino legítimo: `ItemsService.update` reconvierte el costo al cambiar
    // `unidad_medida` usando este mismo motivo, así que un producto donado (costo
    // 0) no podía corregir su unidad. Lo que hay que atajar no es el motivo sino
    // el costo positivo que COLAPSA a 0 al convertirse, y eso solo se ve donde
    // está el valor de antes: `assertCostoNoColapsaACero`, en los tres
    // llamadores que convierten.
    if (params.costoUnitario != null) {
      let costoIngresado: Decimal;
      try {
        costoIngresado = new Decimal(params.costoUnitario);
      } catch {
        // Mensaje propio: lo que falló no es el signo. Por API no se llega
        // —`@IsNumberString()` corta antes—, pero un llamador interno pasa
        // strings leídos de la base y un 400 que hable del signo manda a mirar
        // el número equivocado.
        throw new BadRequestException('El costo unitario no es un número');
      }
      if (costoIngresado.isNaN() || costoIngresado.lessThan(0)) {
        throw new BadRequestException(
          'El costo unitario no puede ser negativo',
        );
      }
    }

    // Costo a persistir en item_producto. null = no se toca.
    // Lo recalculan (promedio ponderado móvil) los motivos de
    // MOTIVOS_QUE_RECALCULAN_CPP; las demás entradas pueden congelar un
    // costoUnitario en el movimiento sin pisar el vigente.
    let costoActualNuevo: string | null = null;
    if (
      params.costoUnitario != null &&
      params.tipo === 'entrada' &&
      MOTIVOS_QUE_RECALCULAN_CPP.includes(params.motivo)
    ) {
      costoActualNuevo = this.calcularCostoPromedio(
        stockAnterior,
        costoActualPrevio,
        cantidad,
        params.costoUnitario,
      );
    } else if (esAjusteCosto) {
      // Escala de captura: el número lo tipeó una persona en el ajuste manual
      // y se lleva a la escala de costo (ESCALA_COSTO). No mira modo_redondeo
      // a propósito — esa perilla es la política de lo cobrado, no de captura.
      costoActualNuevo = new Decimal(params.costoUnitario!).toFixed(
        ESCALA_COSTO,
      );
    }

    // El kardex congela lo que se PAGÓ en este movimiento, no el promedio.
    const costoUnitarioCongelado =
      params.costoUnitario != null ? params.costoUnitario : costoActualPrevio;

    let result: MoverResult;

    if (esAjusteCosto) {
      // No hay movimiento de stock: ni branch por modo, ni UPDATE de stock,
      // ni filas en movimiento_inventario_detalle (insertarDetalleMovimiento
      // es no-op cuando result solo trae stockResultante).
      result = { stockResultante: stockAnterior };
    } else if (modo === 'cantidad') {
      result = await this.moverCantidad(
        manager,
        params,
        stockAnterior,
        cantidad,
      );
    } else if (modo === 'serie') {
      result = await this.moverSerie(manager, params, cantidad);
    } else if (modo === 'lote') {
      result = await this.moverLote(manager, params, cantidad);
    } else {
      throw new BadRequestException(
        `Modo de inventario desconocido: ${String(modo)}`,
      );
    }

    const { stockResultante } = result;

    const insertRows: { movimiento_id: string }[] = await manager.query(
      `INSERT INTO movimientos_inventario
         (tenant_id, item_id, ubicacion_id, tipo, motivo, cantidad,
          stock_anterior, stock_resultante, venta_id, usuario_id, comentario,
          costo_unitario, costo_anterior, causa_merma_id, motivo_diferencia_id,
          traslado_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING movimiento_id`,
      [
        params.tenantId,
        params.itemId,
        params.ubicacionId,
        params.tipo,
        params.motivo,
        cantidad.toString(),
        stockAnterior.toString(),
        stockResultante.toString(),
        params.ventaId ?? null,
        params.usuarioId,
        params.comentario ?? null,
        costoUnitarioCongelado,
        esAjusteCosto ? costoActualPrevio : null,
        params.causaMermaId ?? null,
        params.motivoDiferenciaId ?? null,
        params.trasladoId ?? null,
      ],
    );

    const movimientoId = insertRows[0].movimiento_id;
    await this.insertarDetalleMovimiento(
      manager,
      movimientoId,
      params.cantidad,
      result,
    );

    if (costoActualNuevo != null) {
      await manager.query(
        `UPDATE item_producto SET costo_actual = $1 WHERE item_id = $2`,
        [costoActualNuevo, params.itemId],
      );
    }

    return {
      movimientoId,
      stockAnterior: stockAnterior.toString(),
      stockResultante: stockResultante.toString(),
      costoActualPrevio,
      costoActual: costoActualNuevo ?? costoActualPrevio,
      unidadIds: result.unidadIds,
      loteConsumos: result.loteConsumos,
      loteId: result.loteId,
    };
  }

  /**
   * Ajuste manual de `item_producto.costo_actual`: corrige un costo mal
   * cargado (no una compra), sin pasar por el promedio ponderado. Delega en
   * `registrarMovimiento` (motivo `ajuste_costo`), que valida `tipo='ajuste'`,
   * `cantidad=0` y el `costoUnitario`, puebla `costo_anterior` en el kardex y
   * hace el único `UPDATE` de `costo_actual`.
   */
  async registrarAjusteCosto(
    tenantId: string,
    usuarioId: string,
    dto: AjusteCostoDto,
  ): Promise<{
    movimientoId: string;
    costoAnterior: string | null;
    costoNuevo: string;
  }> {
    // El signo lo valida `AjusteCostoDto` (`@IsDecimalPositivo`): acá el 0 no
    // informaría un costo, anularía el promedio. Ese `> 0` es sobre lo TIPEADO;
    // el costo ya convertido y cuantizado lo cuida `assertCostoNoColapsaACero`
    // más abajo, porque `registrarMovimiento` solo valida el signo.
    const costoNuevo = new Decimal(dto.costoNuevo);

    return this.db.transaccion(async (manager) => {
      const rows: {
        tipo: string;
        costo_actual: string | null;
        unidad_medida: string | null;
      }[] = await manager.query(
        `SELECT i.tipo, p.costo_actual, p.unidad_medida
             FROM items i
             JOIN item_producto p ON p.item_id = i.item_id
            WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [dto.itemId, tenantId],
      );
      if (!rows.length) {
        throw new NotFoundException('Item no encontrado');
      }
      if (rows[0].tipo !== 'producto' && rows[0].tipo !== 'ingrediente') {
        throw new BadRequestException(
          'Solo un producto o un ingrediente tiene costo propio',
        );
      }

      // La comparación va sobre el valor REDONDEADO, no sobre el string crudo
      // del DTO: `costo_actual` es NUMERIC(18,4), así que un costo que solo
      // difiere más allá del 4º decimal se persiste idéntico al vigente y
      // dejaría en el kardex un ajuste que no cambió nada.
      const costoAnterior = rows[0].costo_actual;
      // `costoNuevo` viene "por la unidad elegida" (dto.unidadCodigo), no por la
      // unidad base. El ajuste mueve cantidad 0, así que NO sirve la conversión
      // de operación de las mermas: esa divide por la cantidad convertida ⇒
      // división por cero. Acá la conversión es de TASA —cuánto vale una unidad
      // base si una unidad elegida vale `costoNuevo`—, y sale del mismo util
      // pasándole cantidad 1 y el factor de la unidad elegida como divisor. No
      // se escribe aritmética nueva.
      // ⚠️ Lo que el util NO dice en su firma: cuantiza el factor a 4 decimales
      // (ver su docblock). Con cantidad 1 ese redondeo es el peor caso de
      // precisión relativa; hoy es inocuo porque todos los factores sembrados
      // son potencias de 10.
      // Ver docs/superpowers/specs/2026-08-28-costo-por-unidad-elegida-design.md
      let costoEnBase = costoNuevo;
      const unidadBase = rows[0].unidad_medida ?? 'unidad';
      if (dto.unidadCodigo && dto.unidadCodigo !== unidadBase) {
        const factor = await this.catalogService.convertirUnidad(
          '1',
          dto.unidadCodigo,
          unidadBase,
        );
        costoEnBase = new Decimal(
          convertirCostoUnitario('1', costoNuevo.toString(), factor),
        );
      }
      // Escala de captura: el número lo tipeó una persona en este ajuste y se
      // lleva a la escala de costo (ESCALA_COSTO). No mira modo_redondeo a
      // propósito — esa perilla es la política de lo cobrado, no de captura.
      // Va sobre el costo YA convertido, y por eso la comparación de abajo
      // también: cargar 5050/kg en un producto que ya vale 5,0500/g no cambia
      // nada y tiene que rebotar igual que si lo hubieran tipeado en gramos.
      const costoNuevo4 = costoEnBase.toFixed(ESCALA_COSTO);
      // `costoNuevo` es `> 0` por DTO, así que un '0.0000' acá solo puede venir
      // de la conversión de unidad: es el 0 que nadie escribió.
      assertCostoNoColapsaACero(costoNuevo.toString(), costoNuevo4, unidadBase);
      if (
        costoAnterior != null &&
        costoNuevo4 === new Decimal(costoAnterior).toFixed(ESCALA_COSTO)
      ) {
        throw new BadRequestException(
          'El costo nuevo es igual al vigente: no hay nada que ajustar',
        );
      }

      const mov = await this.registrarMovimiento(manager, {
        tenantId,
        itemId: dto.itemId,
        ubicacionId: await this.ubicacionesService.localDe(tenantId),
        usuarioId,
        tipo: 'ajuste',
        motivo: 'ajuste_costo',
        cantidad: '0',
        costoUnitario: costoNuevo4,
        comentario: dto.comentario,
      });

      // El costoAnterior del pre-check es solo para la validación temprana
      // ("igual al vigente"); la respuesta usa el que registrarMovimiento leyó
      // dentro del FOR UPDATE, que es el que de verdad quedó en el kardex —
      // evita que una compra concurrente deje la respuesta desincronizada.
      return {
        movimientoId: mov.movimientoId,
        costoAnterior: mov.costoActualPrevio,
        costoNuevo: costoNuevo4,
      };
    });
  }

  /**
   * Promedio ponderado móvil (CPP). Las salidas nunca lo mueven; las entradas
   * que sí, en MOTIVOS_QUE_RECALCULAN_CPP.
   *
   * ⚠️ Este bloque decía hasta el 2026-08-22 que la devolución **tampoco**
   * recalcula, *"porque re-promediarla metería costo de venta dentro del costo
   * de compra"*. El razonamiento valía mientras el reingreso llegaba sin costo
   * propio; ahora llega con el costo congelado de la salida original, que es
   * costo de compra —el mismo con el que la unidad había entrado—, así que
   * promediarlo devuelve exactamente la valorización previa a la venta. Lo que
   * el comentario viejo temía sigue prohibido: ningún camino pasa acá un precio
   * de venta.
   *
   * Sin stock previo o sin costo previo no hay masa que promediar: manda el
   * costo de compra. Eso además evita dividir por cero.
   */
  private calcularCostoPromedio(
    stockAnterior: Decimal,
    costoActualPrevio: string | null,
    cantidad: Decimal,
    costoCompra: string,
  ): string {
    const compra = new Decimal(costoCompra);
    if (stockAnterior.lessThanOrEqualTo(0) || costoActualPrevio == null) {
      // Misma escala y mismo criterio que el CPP de abajo: el comentario de
      // ese `toFixed` cubre el método entero, esta rama incluida.
      return compra.toFixed(ESCALA_COSTO);
    }
    const valorPrevio = stockAnterior.mul(new Decimal(costoActualPrevio));
    const valorEntrante = cantidad.mul(compra);
    // HALF_UP fijo a escala de costo (4): el CPP es una tasa interna —dinero por
    // unidad base de stock—, no un monto cobrable, y por eso no mira modo_redondeo:
    // esa perilla es la política de lo que se le cobra al cliente. Un tenant en
    // FLOOR/CEIL sesgaría acá la valorización en cada compra, compuesto en cada
    // promedio. La escala de la moneda tampoco aplica: hay costos por gramo (< $1).
    return valorPrevio
      .plus(valorEntrante)
      .div(stockAnterior.plus(cantidad))
      .toFixed(ESCALA_COSTO);
  }

  // ---------------------------------------------------------------------------
  // Helpers por modo
  // ---------------------------------------------------------------------------

  private async moverCantidad(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
    stockAnterior: Decimal,
    cantidad: Decimal,
  ): Promise<MoverResult> {
    const stockResultante =
      params.tipo === 'entrada'
        ? stockAnterior.plus(cantidad)
        : stockAnterior.minus(cantidad);

    if (stockResultante.lessThan(0)) {
      throw new BadRequestException('Stock insuficiente para la salida');
    }

    await manager.query(
      `INSERT INTO stock_ubicacion (item_id, ubicacion_id, stock)
       VALUES ($1, $2, $3)
       ON CONFLICT (item_id, ubicacion_id) DO UPDATE SET stock = EXCLUDED.stock`,
      [params.itemId, params.ubicacionId, stockResultante.toString()],
    );

    return { stockResultante };
  }

  private async moverSerie(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
    cantidad: Decimal,
  ): Promise<MoverResult> {
    if (params.tipo === 'entrada' && params.motivo === 'traslado') {
      // La entrada de un traslado NO crea unidades: las unidades ya existen y
      // ya se movieron —la salida les cambió `ubicacion_id`, ver el branch de
      // abajo—. Lo único que falta acá es el saldo materializado del destino,
      // que se deriva contando lo que efectivamente llegó, y la fila de
      // detalle que ata este movimiento a esas unidades.
      const unidadIds = params.unidadIds ?? [];
      if (unidadIds.length === 0) {
        throw new BadRequestException(
          'La entrada de un traslado en modo serie necesita las unidades que salieron',
        );
      }
      // Que esas unidades sean de ESTE ítem, de ESTE tenant y estén YA en el
      // destino (la salida las movió). Una consulta, no una por unidad. Misma
      // razón que en el branch de lote: hoy llegan de la propia salida, pero
      // el chokepoint no confía en el llamador.
      const llegadas: { unidad_id: string }[] = await manager.query(
        `SELECT unidad_id FROM item_unidad
          WHERE unidad_id = ANY($1) AND item_id = $2 AND tenant_id = $3
            AND ubicacion_id = $4 AND eliminado_el IS NULL`,
        [unidadIds, params.itemId, params.tenantId, params.ubicacionId],
      );
      // `!== unidadIds.length`, no contra el `Set`: las filas que vuelven son
      // distintas por PK, así que comparar contra el largo CRUDO también
      // rechaza una lista con la misma unidad dos veces —que escribiría dos
      // filas de detalle y un kardex del doble de lo que se movió—.
      // El mensaje no dice solo "no llegó al destino": ese filtro es uno de
      // cuatro (ítem, tenant, ubicación, no-eliminada) y nombrarlo solo a él
      // manda a mirar la ubicación cuando el problema puede ser otro. Se
      // agrupan en "no son de este producto" —que cubre ítem, tenant y
      // eliminada, los tres indistinguibles a propósito para no volverse un
      // oráculo entre tenants—, "no llegaron al destino" y "vienen repetidas",
      // que es la comparación de largos de acá abajo y no un filtro de la
      // query.
      if (llegadas.length !== unidadIds.length) {
        throw new BadRequestException(
          'Las unidades de la entrada del traslado no son de este producto, ' +
            'no llegaron al destino, o vienen repetidas',
        );
      }
      // Y que sean TANTAS como dice el movimiento: es el mismo cruce que hacen
      // la entrada y la salida normales de modo serie. Sin él, un llamador que
      // pase 2 unidades con `cantidad: '3'` escribe en el kardex una cantidad
      // que no coincide con lo que llegó.
      if (!new Decimal(unidadIds.length).equals(cantidad)) {
        throw new BadRequestException(
          `La cantidad (${cantidad.toString()}) no coincide con el número de unidades (${unidadIds.length})`,
        );
      }
      const stockResultante = await this.recalcularStockSerie(
        manager,
        params.itemId,
        params.tenantId,
        params.ubicacionId,
      );
      return { stockResultante, unidadIds };
    }

    if (params.tipo === 'entrada') {
      const series = params.series ?? [];
      if (series.length === 0) {
        throw new BadRequestException(
          'Para entrada serie debe proveer las series/IMEIs',
        );
      }
      if (!new Decimal(series.length).equals(cantidad)) {
        throw new BadRequestException(
          `La cantidad (${cantidad.toString()}) no coincide con el número de series (${series.length})`,
        );
      }

      const unidadIds: string[] = [];
      for (const s of series) {
        const rows: { unidad_id: string }[] = await manager.query(
          `INSERT INTO item_unidad
             (tenant_id, item_id, lote_id, serie, estado, condicion, garantia_hasta, ubicacion_id)
           VALUES ($1,$2,$3,$4,'disponible',$5,$6,$7)
           RETURNING unidad_id`,
          [
            params.tenantId,
            params.itemId,
            s.loteId ?? null,
            s.serie,
            s.condicion ?? 'nuevo',
            s.garantiaHasta ?? null,
            params.ubicacionId,
          ],
        );
        unidadIds.push(rows[0].unidad_id);
      }

      const stockResultante = await this.recalcularStockSerie(
        manager,
        params.itemId,
        params.tenantId,
        params.ubicacionId,
      );

      return { stockResultante, unidadIds };
    } else {
      // salida serie
      let unidadIds = params.unidadIds ?? [];
      if (unidadIds.length === 0) {
        // Auto-selección FIFO: las unidades disponibles más antiguas, y solo
        // las de esta ubicación — sin el filtro, una salida en el local
        // podría auto-seleccionar una unidad que físicamente está en la
        // bodega.
        const disponibles: { unidad_id: string }[] = await manager.query(
          `SELECT u.unidad_id FROM item_unidad u
           WHERE u.item_id = $1 AND u.tenant_id = $2 AND u.ubicacion_id = $3
             AND u.estado = 'disponible' AND u.eliminado_el IS NULL
           ORDER BY u.creado_el ASC
           LIMIT $4
           FOR UPDATE`,
          [
            params.itemId,
            params.tenantId,
            params.ubicacionId,
            cantidad.toString(),
          ],
        );
        if (!new Decimal(disponibles.length).equals(cantidad)) {
          throw new BadRequestException(
            `Stock insuficiente: se requieren ${cantidad.toString()} unidades disponibles, hay ${disponibles.length}`,
          );
        }
        unidadIds = disponibles.map((u) => u.unidad_id);
      } else if (!new Decimal(unidadIds.length).equals(cantidad)) {
        throw new BadRequestException(
          `La cantidad (${cantidad.toString()}) no coincide con el número de unidades (${unidadIds.length})`,
        );
      }

      // Un traslado no da de baja la unidad: la MUEVE. Es la única salida que
      // deja la unidad `disponible`, porque no salió del inventario — cambió
      // de lugar. Por eso necesita saber a dónde (`ubicacionDestinoId`), y por
      // eso la escritura la hace la salida y no la entrada: la ubicación de
      // una unidad serializada es un solo campo, así que moverla es UNA
      // escritura, no una resta y una suma.
      const esTraslado = params.motivo === 'traslado';
      if (esTraslado && !params.ubicacionDestinoId) {
        throw new BadRequestException(
          'La salida de un traslado en modo serie necesita la ubicación de destino',
        );
      }
      if (esTraslado) {
        // Acotada al tenant como todo lo demás que entra por parámetro: es el
        // campo que MUEVE la unidad de lugar, así que sin esto un llamador
        // interno podría mandar una unidad a la ubicación de otro tenant. Hoy
        // `TrasladosService` ya valida las dos puntas contra el token, pero la
        // defensa del chokepoint no puede ser asimétrica justo acá (misma
        // razón que el `JOIN items` por tenant del principio del método).
        const destinoRows: unknown[] = await manager.query(
          `SELECT 1 FROM ubicaciones
            WHERE ubicacion_id = $1 AND tenant_id = $2
              AND eliminado_el IS NULL`,
          [params.ubicacionDestinoId, params.tenantId],
        );
        if (!destinoRows.length) {
          throw new BadRequestException(
            'La ubicación de destino del traslado no existe en este tenant',
          );
        }
      }
      const estadoDestino = params.motivo === 'venta' ? 'vendido' : 'baja';

      for (const uid of unidadIds) {
        const rows: {
          estado: string;
          item_id: string;
          tenant_id: string;
          ubicacion_id: string;
          serie: string;
        }[] = await manager.query(
          `SELECT estado, item_id, tenant_id, ubicacion_id, serie FROM item_unidad
             WHERE unidad_id = $1 AND eliminado_el IS NULL FOR UPDATE`,
          [uid],
        );
        if (!rows.length) {
          throw new BadRequestException(`Unidad ${uid} no encontrada`);
        }
        if (rows[0].tenant_id !== params.tenantId) {
          throw new BadRequestException(`Unidad ${uid} no pertenece al tenant`);
        }
        if (rows[0].item_id !== params.itemId) {
          throw new BadRequestException(`Unidad ${uid} no pertenece al item`);
        }
        if (rows[0].ubicacion_id !== params.ubicacionId) {
          // Una unidad serializada está en un solo lugar: la salida tiene que
          // pedirse desde ahí. El mensaje nombra la ubicación real de la
          // unidad, no solo que "no se puede" — sin eso, quien opera no sabe si
          // falta stock o si está mirando la ubicación equivocada. Acotado por
          // tenant y sin eliminadas, como toda lectura nueva de esta tabla: los
          // dos ids que entran acá son de hoy siempre tenant-scoped (la unidad
          // ya se validó contra el tenant arriba, y `params.ubicacionId` sale
          // de `UbicacionesService.localDe` en todos los llamadores actuales),
          // pero sin el filtro esta query se vuelve un oráculo de nombres de
          // otro tenant en cuanto exista un llamador que reciba `ubicacionId`
          // del body (`POST /traslados`).
          const nombresRows: { ubicacion_id: string; nombre: string }[] =
            await manager.query(
              `SELECT ubicacion_id, nombre FROM ubicaciones
                WHERE ubicacion_id = ANY($1) AND tenant_id = $2
                  AND eliminado_el IS NULL`,
              [[rows[0].ubicacion_id, params.ubicacionId], params.tenantId],
            );
          const nombreDe = (id: string) =>
            nombresRows.find((r) => r.ubicacion_id === id)?.nombre ?? id;
          throw new BadRequestException(
            `La unidad ${rows[0].serie} está en ${nombreDe(rows[0].ubicacion_id)}, ` +
              `no en ${nombreDe(params.ubicacionId)}`,
          );
        }
        if (rows[0].estado !== 'disponible') {
          throw new BadRequestException(
            `Unidad ${uid} no está disponible (estado: ${rows[0].estado})`,
          );
        }

        if (esTraslado) {
          await manager.query(
            `UPDATE item_unidad SET ubicacion_id = $1 WHERE unidad_id = $2`,
            [params.ubicacionDestinoId, uid],
          );
        } else {
          await manager.query(
            `UPDATE item_unidad SET estado = $1, venta_id = $2 WHERE unidad_id = $3`,
            [estadoDestino, params.ventaId ?? null, uid],
          );
        }
      }

      const stockResultante = await this.recalcularStockSerie(
        manager,
        params.itemId,
        params.tenantId,
        params.ubicacionId,
      );

      return { stockResultante, unidadIds };
    }
  }

  /**
   * Saldo previo de un lote **en una ubicación**, en un statement APARTE del
   * que haya tomado el `FOR UPDATE` sobre `item_lote` — nunca en un `JOIN`
   * dentro de esa misma query. Mismo motivo que el saldo de `stock_ubicacion`
   * en `registrarMovimiento`: bajo READ COMMITTED, Postgres solo re-evalúa
   * (EvalPlanQual) la fila lockeada al despertar, no las tablas que se le
   * unan en el mismo statement — un `JOIN` a `lote_ubicacion` ahí vería el
   * snapshot de ANTES de encolarse, y el upsert de saldo absoluto de más
   * abajo lo convertiría en un lost update.
   */
  private async saldoLoteEnUbicacion(
    manager: EntityManager,
    loteId: string,
    ubicacionId: string,
  ): Promise<Decimal> {
    const rows: { cantidad: string }[] = await manager.query(
      `SELECT cantidad FROM lote_ubicacion
        WHERE lote_id = $1 AND ubicacion_id = $2`,
      [loteId, ubicacionId],
    );
    return new Decimal(rows[0]?.cantidad ?? 0);
  }

  private async moverLote(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
    cantidad: Decimal,
  ): Promise<MoverResult> {
    if (params.tipo === 'entrada' && params.motivo === 'traslado') {
      // La entrada de un traslado NO crea ni engorda el lote: el lote es uno
      // solo y su `cantidad_inicial` ya contó esa mercadería cuando entró a la
      // empresa. Sumarla de nuevo acá inflaría el lote en cada traslado, y el
      // vencimiento —que es uno solo, del lote, no de la ubicación— tampoco se
      // toca. Lo único que se mueve es el saldo POR UBICACIÓN.
      const consumos = params.loteConsumos ?? [];
      if (!consumos.length) {
        throw new BadRequestException(
          'La entrada de un traslado en modo lote necesita los lotes que salieron',
        );
      }
      // Agrupados por lote ANTES de escribir. El upsert de más abajo escribe
      // el saldo ABSOLUTO, así que dos entradas del mismo `loteId` en la misma
      // lista harían que la segunda pisara a la primera y se perdiera una
      // cantidad en silencio. Hoy los dos caminos de salida producen lotes
      // distintos, pero esta rama dice defender al llamador que se agregue
      // mañana y esto es parte de esa defensa.
      const porLote = new Map<string, Decimal>();
      for (const c of consumos) {
        porLote.set(
          c.loteId,
          (porLote.get(c.loteId) ?? new Decimal(0)).plus(c.cantidad),
        );
      }
      // Y el total tiene que ser el del movimiento: si no, el kardex escribe
      // una cantidad que `lote_ubicacion` no recibió.
      const totalConsumido = [...porLote.values()].reduce(
        (acc, v) => acc.plus(v),
        new Decimal(0),
      );
      if (!totalConsumido.equals(cantidad)) {
        throw new BadRequestException(
          `La cantidad (${cantidad.toString()}) no coincide con lo descontado de los lotes (${totalConsumido.toString()})`,
        );
      }

      const loteIds = [...porLote.keys()];

      // Los lotes, acotados a ESTE ítem y ESTE tenant, en una consulta. Hoy
      // llegan del resultado de la propia salida —ya validado— pero el
      // chokepoint es el lugar donde la defensa vive para el llamador que se
      // agregue mañana, igual que el `JOIN items` por tenant del principio del
      // método. Sin esto, un `loteConsumos` armado a mano escribiría saldo
      // sobre un lote de otro tenant.
      const lotesRows: { lote_id: string }[] = await manager.query(
        `SELECT lote_id FROM item_lote
          WHERE lote_id = ANY($1) AND item_id = $2 AND tenant_id = $3
            AND eliminado_el IS NULL`,
        [loteIds, params.itemId, params.tenantId],
      );
      if (lotesRows.length !== loteIds.length) {
        throw new BadRequestException(
          'Alguno de los lotes de la entrada del traslado no es de este ' +
            'producto o está eliminado',
        );
      }

      // Los saldos previos de TODOS los lotes que llegan, en UNA consulta —
      // nunca un `SELECT` por iteración. Es la misma forma que usa la salida
      // FIFO más abajo, y acá pesa igual o más: cada round-trip de más se paga
      // adentro de la transacción que retiene el lock ancla de
      // `item_producto`, o sea con toda venta de ese producto encolada detrás.
      //
      // Leído DESPUÉS del lock y en su propio statement, como manda
      // `saldoLoteEnUbicacion`: la salida ya tomó `FOR UPDATE` sobre estas
      // filas de `item_lote` en esta misma transacción, que es lo que
      // serializa el saldo del lote.
      const previosRows: { lote_id: string; cantidad: string }[] =
        await manager.query(
          `SELECT lote_id, cantidad FROM lote_ubicacion
            WHERE ubicacion_id = $1 AND lote_id = ANY($2)`,
          [params.ubicacionId, loteIds],
        );
      const previoDe = new Map(
        previosRows.map((r) => [r.lote_id, new Decimal(r.cantidad)]),
      );

      // El `for` que queda es escritura de N filas distintas, no una lectura
      // por iteración: no hay dato que batchear, solo saldos que escribir.
      for (const [loteId, cantidadLote] of porLote) {
        const saldoPrevio = previoDe.get(loteId) ?? new Decimal(0);
        await manager.query(
          `INSERT INTO lote_ubicacion (lote_id, ubicacion_id, cantidad)
           VALUES ($1, $2, $3)
           ON CONFLICT (lote_id, ubicacion_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
          [
            loteId,
            params.ubicacionId,
            saldoPrevio.plus(cantidadLote).toString(),
          ],
        );
      }

      const stockResultante = await this.recalcularStockLote(
        manager,
        params.itemId,
        params.tenantId,
        params.ubicacionId,
      );

      // Los consumos AGRUPADOS, no los crudos: `insertarDetalleMovimiento`
      // escribe una fila por elemento, así que devolver la lista cruda dejaría
      // dos filas de detalle del mismo lote en el caso duplicado que la
      // agrupación de arriba justamente une.
      const loteConsumos = [...porLote].map(([loteId, cant]) => ({
        loteId,
        cantidad: cant.toString(),
      }));

      return { stockResultante, loteConsumos };
    }

    if (params.tipo === 'entrada') {
      const loteInput = params.lote;
      if (!loteInput) {
        throw new BadRequestException(
          'Para entrada lote debe proveer los datos del lote',
        );
      }

      // Ancla del lock: la fila de item_lote, la misma de siempre. Ya no trae
      // el saldo (vivía acá como `cantidad_disponible`) — ese se lee aparte,
      // más abajo, por `saldoLoteEnUbicacion`.
      const existentes: { lote_id: string }[] = await manager.query(
        `SELECT lote_id FROM item_lote
         WHERE item_id = $1 AND codigo_lote = $2 AND eliminado_el IS NULL
         FOR UPDATE`,
        [params.itemId, loteInput.codigoLote],
      );

      let loteId: string;

      if (existentes.length) {
        loteId = existentes[0].lote_id;
        await manager.query(
          `UPDATE item_lote SET cantidad_inicial = cantidad_inicial + $1
           WHERE lote_id = $2`,
          [cantidad.toString(), loteId],
        );
      } else {
        // Recién insertado dentro de esta misma transacción: no hay lector
        // concurrente posible todavía, así que no necesita su propio lock.
        const rows: { lote_id: string }[] = await manager.query(
          `INSERT INTO item_lote
             (tenant_id, item_id, codigo_lote, fecha_elaboracion, fecha_vencimiento,
              cantidad_inicial)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING lote_id`,
          [
            params.tenantId,
            params.itemId,
            loteInput.codigoLote,
            loteInput.fechaElaboracion ?? null,
            loteInput.fechaVencimiento ?? null,
            cantidad.toString(),
          ],
        );
        loteId = rows[0].lote_id;
      }

      const saldoPrevio = await this.saldoLoteEnUbicacion(
        manager,
        loteId,
        params.ubicacionId,
      );
      await manager.query(
        `INSERT INTO lote_ubicacion (lote_id, ubicacion_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (lote_id, ubicacion_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
        [loteId, params.ubicacionId, saldoPrevio.plus(cantidad).toString()],
      );

      const stockResultante = await this.recalcularStockLote(
        manager,
        params.itemId,
        params.tenantId,
        params.ubicacionId,
      );

      return { stockResultante, loteId };
    } else {
      // salida lote
      const loteId = params.loteId;
      if (!loteId) {
        // Auto-selección FIFO: descuenta de los lotes más antiguos CON SALDO
        // EN ESTA UBICACIÓN. El criterio de orden es el que ya tenía este
        // método (creado_el ASC) — no cambia por ubicación, solo se filtra
        // por ella.
        //
        // Ancla del lock: todos los lotes del ítem (el alcance de siempre). El
        // saldo por ubicación se lee aparte, ya bajo el lock — ver el docblock
        // de `saldoLoteEnUbicacion`.
        const lotes: { lote_id: string; codigo_lote: string }[] =
          await manager.query(
            `SELECT lote_id, codigo_lote FROM item_lote
             WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
             ORDER BY creado_el ASC
             FOR UPDATE`,
            [params.itemId, params.tenantId],
          );

        const saldosRows: { lote_id: string; cantidad: string }[] =
          await manager.query(
            `SELECT lote_id, cantidad FROM lote_ubicacion
              WHERE ubicacion_id = $1 AND lote_id = ANY($2) AND cantidad > 0`,
            [params.ubicacionId, lotes.map((l) => l.lote_id)],
          );
        const saldoDe = new Map(
          saldosRows.map((s) => [s.lote_id, new Decimal(s.cantidad)]),
        );
        const lotesConSaldo = lotes.filter((l) => saldoDe.has(l.lote_id));

        const totalDisponible = lotesConSaldo.reduce(
          (acc, l) => acc.plus(saldoDe.get(l.lote_id)!),
          new Decimal(0),
        );
        if (totalDisponible.lessThan(cantidad)) {
          throw new BadRequestException(
            `Stock insuficiente en lotes en esta ubicación (disponible: ${totalDisponible.toString()}, requerido: ${cantidad.toString()})`,
          );
        }

        let restante = cantidad;
        const loteConsumos: { loteId: string; cantidad: string }[] = [];
        for (const l of lotesConSaldo) {
          if (restante.lessThanOrEqualTo(0)) break;
          const disp = saldoDe.get(l.lote_id)!;
          const tomar = Decimal.min(disp, restante);
          await manager.query(
            `INSERT INTO lote_ubicacion (lote_id, ubicacion_id, cantidad)
             VALUES ($1, $2, $3)
             ON CONFLICT (lote_id, ubicacion_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
            [l.lote_id, params.ubicacionId, disp.minus(tomar).toString()],
          );
          loteConsumos.push({
            loteId: l.lote_id,
            cantidad: tomar.toString(),
          });
          restante = restante.minus(tomar);
        }

        const stockResultante = await this.recalcularStockLote(
          manager,
          params.itemId,
          params.tenantId,
          params.ubicacionId,
        );

        return { stockResultante, loteConsumos };
      }

      const rows: { tenant_id: string; codigo_lote: string }[] =
        await manager.query(
          `SELECT tenant_id, codigo_lote FROM item_lote
           WHERE lote_id = $1 AND item_id = $2 AND eliminado_el IS NULL
           FOR UPDATE`,
          [loteId, params.itemId],
        );

      if (!rows.length) {
        throw new BadRequestException('Lote no encontrado');
      }
      if (rows[0].tenant_id !== params.tenantId) {
        throw new BadRequestException('El lote no pertenece al tenant');
      }

      const disponible = await this.saldoLoteEnUbicacion(
        manager,
        loteId,
        params.ubicacionId,
      );
      if (disponible.lessThan(cantidad)) {
        throw new BadRequestException(
          `Stock insuficiente del lote ${rows[0].codigo_lote} en esta ubicación ` +
            `(disponible: ${disponible.toString()})`,
        );
      }

      await manager.query(
        `INSERT INTO lote_ubicacion (lote_id, ubicacion_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (lote_id, ubicacion_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
        [loteId, params.ubicacionId, disponible.minus(cantidad).toString()],
      );

      const stockResultante = await this.recalcularStockLote(
        manager,
        params.itemId,
        params.tenantId,
        params.ubicacionId,
      );

      // Solo `loteId`, como siempre: agregar acá `loteConsumos` haría que
      // `insertarDetalleMovimiento` tomara la otra rama para TODOS los
      // llamadores de salida con lote elegido (venta, merma, ajuste). La
      // entrada del traslado no lo necesita: arma su consumo desde el `loteId`
      // que este mismo método devuelve.
      return { stockResultante, loteId };
    }
  }

  // ---------------------------------------------------------------------------
  // Recálculo de saldo materializado
  // ---------------------------------------------------------------------------

  private async recalcularStockSerie(
    manager: EntityManager,
    itemId: string,
    tenantId: string,
    ubicacionId: string,
  ): Promise<Decimal> {
    // El saldo de esta ubicación cuenta solo SUS unidades: sin el filtro, dos
    // ubicaciones con stock del mismo ítem comparten el mismo COUNT y una
    // vende lo que físicamente está en la otra.
    const rows: { cnt: string }[] = await manager.query(
      `SELECT COUNT(*) AS cnt FROM item_unidad
       WHERE item_id = $1 AND tenant_id = $2 AND ubicacion_id = $3
         AND estado = 'disponible' AND eliminado_el IS NULL`,
      [itemId, tenantId, ubicacionId],
    );
    const nuevo = new Decimal(rows[0].cnt);
    // El saldo que se upsertea acá es el recalculado (el COUNT de arriba),
    // nunca una suma propia.
    await manager.query(
      `INSERT INTO stock_ubicacion (item_id, ubicacion_id, stock)
       VALUES ($1, $2, $3)
       ON CONFLICT (item_id, ubicacion_id) DO UPDATE SET stock = EXCLUDED.stock`,
      [itemId, ubicacionId, nuevo.toString()],
    );
    return nuevo;
  }

  private async recalcularStockLote(
    manager: EntityManager,
    itemId: string,
    tenantId: string,
    ubicacionId: string,
  ): Promise<Decimal> {
    // El saldo de esta ubicación cuenta solo `lote_ubicacion` DE ESA
    // ubicación: sin el filtro, dos ubicaciones con saldo del mismo lote
    // comparten el mismo SUM y una vende lo que físicamente está en la otra.
    // `item_lote` entra solo para acotar por tenant e ítem — `lote_ubicacion`
    // no tiene esas columnas propias (PK compartida vía `lote_id`).
    const rows: { total: string }[] = await manager.query(
      `SELECT COALESCE(SUM(lu.cantidad), 0) AS total
       FROM lote_ubicacion lu
       JOIN item_lote l ON l.lote_id = lu.lote_id
       WHERE l.item_id = $1 AND l.tenant_id = $2 AND lu.ubicacion_id = $3
         AND l.eliminado_el IS NULL`,
      [itemId, tenantId, ubicacionId],
    );
    const nuevo = new Decimal(rows[0].total);
    // El saldo que se upsertea acá es el recalculado (el SUM de arriba), nunca
    // una suma propia.
    await manager.query(
      `INSERT INTO stock_ubicacion (item_id, ubicacion_id, stock)
       VALUES ($1, $2, $3)
       ON CONFLICT (item_id, ubicacion_id) DO UPDATE SET stock = EXCLUDED.stock`,
      [itemId, ubicacionId, nuevo.toString()],
    );
    return nuevo;
  }

  // ---------------------------------------------------------------------------
  // Detalle del movimiento
  // ---------------------------------------------------------------------------

  private async insertarDetalleMovimiento(
    manager: EntityManager,
    movimientoId: string,
    cantidad: string,
    result: MoverResult,
  ): Promise<void> {
    if (result.unidadIds?.length) {
      for (const uid of result.unidadIds) {
        await manager.query(
          `INSERT INTO movimiento_inventario_detalle
             (movimiento_id, unidad_id, cantidad)
           VALUES ($1, $2, '1')`,
          [movimientoId, uid],
        );
      }
    } else if (result.loteConsumos?.length) {
      for (const c of result.loteConsumos) {
        await manager.query(
          `INSERT INTO movimiento_inventario_detalle
             (movimiento_id, lote_id, cantidad)
           VALUES ($1, $2, $3)`,
          [movimientoId, c.loteId, c.cantidad],
        );
      }
    } else if (result.loteId) {
      await manager.query(
        `INSERT INTO movimiento_inventario_detalle
           (movimiento_id, lote_id, cantidad)
         VALUES ($1, $2, $3)`,
        [movimientoId, result.loteId, cantidad],
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  async findMovimientos(
    tenantId: string,
    query: FindMovimientosDto,
  ): Promise<PaginatedResponse<MovimientoListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    // La zona solo se consulta si hay filtro de fecha: sin bordes que expandir
    // es una query de más en el listado más caliente del módulo.
    const zona = requiereZonaTenant(query.desde, query.hasta)
      ? await zonaHorariaTenant(this.db, tenantId)
      : null;
    const { filters, params } = this.buildMovimientosFilters(
      tenantId,
      query,
      zona,
    );

    // Lo que está en el kardex queda en el kardex: el JOIN no filtra
    // `i.eliminado_el` y la fila se muestra marcada. Filtrarlo acá no dejaba la
    // fila vacía ni tachada — bajaba el `COUNT`, así que la pantalla informaba
    // menos movimientos de los que hay sin decir que ocultaba nada. El filtro va
    // en las DOS consultas o el total vuelve a mentir.
    const countRows: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM movimientos_inventario mv
       LEFT JOIN items i ON i.item_id = mv.item_id
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         ${filters}`,
      params,
    );

    const total = countRows[0]?.total ?? 0;
    const listParams = [...params, pageSize, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: MovimientoRow[] = await this.db.query(
      `SELECT
         mv.movimiento_id, mv.item_id, i.nombre AS item_nombre,
         mv.tipo, mv.motivo, mv.cantidad,
         mv.stock_anterior, mv.stock_resultante,
         mv.usuario_id, u.nombre AS usuario_nombre,
         mv.comentario, mv.creado_el, mv.costo_unitario, mv.costo_anterior,
         mv.causa_merma_id, mv.motivo_diferencia_id,
         cm.nombre AS causa_nombre,
         p.unidad_medida,
         -- El kardex global mezcla ítems de distintas monedas: sin esto la UI
         -- formatea todo costo con la moneda oficial del tenant.
         i.moneda_id,
         (i.eliminado_el IS NOT NULL) AS item_eliminado,
         mv.ubicacion_id, ub.nombre AS ubicacion_nombre
       FROM movimientos_inventario mv
       LEFT JOIN items i ON i.item_id = mv.item_id
       LEFT JOIN item_producto p ON p.item_id = mv.item_id
       LEFT JOIN usuarios u ON u.usuario_id = mv.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN causas_merma cm ON cm.causa_merma_id = mv.causa_merma_id AND cm.eliminado_el IS NULL
       -- Sin ub.eliminado_el IS NULL, a propósito e igual que el JOIN de items
       -- arriba: un movimiento ya escrito en el kardex tiene que seguir diciendo
       -- en qué ubicación pasó aunque esa bodega se haya borrado después (es lo
       -- que se hace tras vaciarla). Filtrarlo no ocultaría la fila del kardex,
       -- solo le quitaría el nombre de la ubicación sin decir que lo oculta.
       LEFT JOIN ubicaciones ub ON ub.ubicacion_id = mv.ubicacion_id
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         ${filters}
       ORDER BY mv.creado_el DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );

    return {
      data: rows.map((r) => this.mapMovimientoRow(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private buildMovimientosFilters(
    tenantId: string,
    query: FindMovimientosDto,
    zona: string | null,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let filters = '';

    // La zona ocupa una posición fija apenas hay algún borde de fecha: los dos
    // bordes la comparten.
    let idxZona = 0;
    if (zona != null) {
      params.push(zona);
      idxZona = params.length;
    }

    if (query.itemId) {
      params.push(query.itemId);
      filters += ` AND mv.item_id = $${params.length}`;
    }
    if (query.ubicacionId) {
      params.push(query.ubicacionId);
      filters += ` AND mv.ubicacion_id = $${params.length}`;
    }
    if (query.motivo) {
      params.push(query.motivo);
      filters += ` AND mv.motivo = $${params.length}`;
    }
    if (query.desde) {
      params.push(query.desde);
      filters += bordeFechaSql(
        'mv.creado_el',
        '>=',
        query.desde,
        params.length,
        idxZona,
      );
    }
    if (query.hasta) {
      params.push(query.hasta);
      filters += bordeHastaSql(
        'mv.creado_el',
        query.hasta,
        params.length,
        idxZona,
      );
    }

    return { filters, params };
  }

  private mapMovimientoRow(r: MovimientoRow): MovimientoListItem {
    return {
      id: r.movimiento_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      tipo: r.tipo,
      motivo: r.motivo,
      cantidad: r.cantidad,
      stockAnterior: r.stock_anterior,
      stockResultante: r.stock_resultante,
      usuarioId: r.usuario_id,
      usuarioNombre: r.usuario_nombre,
      comentario: r.comentario,
      creadoEl: r.creado_el,
      costoUnitario: r.costo_unitario,
      costoAnterior: r.costo_anterior,
      causaMermaId: r.causa_merma_id,
      causaNombre: r.causa_nombre,
      motivoDiferenciaId: r.motivo_diferencia_id,
      // Proyección de lectura: cantidad × costo congelado del kardex, a escala de
      // costo (4). Nadie paga este número y no se persiste. Redondearlo con la config
      // vigente haría que el historial cambie al cambiar la preferencia del tenant;
      // el formateo a moneda es de presentación, no de acá.
      costoPerdido:
        r.motivo === 'merma' && r.costo_unitario != null
          ? new Decimal(r.cantidad).mul(r.costo_unitario).toFixed(ESCALA_COSTO)
          : null,
      unidadMedida: r.unidad_medida,
      monedaId: r.moneda_id,
      itemEliminado: r.item_eliminado,
      ubicacionId: r.ubicacion_id,
      ubicacionNombre: r.ubicacion_nombre,
    };
  }
}

export interface MovimientoListItem {
  id: string;
  itemId: string;
  itemNombre: string;
  tipo: string;
  motivo: string;
  cantidad: string;
  stockAnterior: string;
  stockResultante: string;
  usuarioId: string | null;
  usuarioNombre: string | null;
  comentario: string | null;
  creadoEl: Date;
  costoUnitario: string | null;
  costoAnterior: string | null;
  causaMermaId: string | null;
  causaNombre: string | null;
  motivoDiferenciaId: string | null;
  costoPerdido: string | null;
  unidadMedida: string | null;
  monedaId: string;
  /**
   * El producto fue dado de baja después de este movimiento. El kardex lo
   * conserva igual (nada en el backend escribe `movimientos_inventario.
   * eliminado_el`); la pantalla lo marca para que el que audita entienda por
   * qué ese producto ya no aparece en el catálogo.
   */
  itemEliminado: boolean;
  /** Dónde ocurrió — frente de bodegas y traslados. */
  ubicacionId: string;
  /**
   * `null` si la ubicación se eliminó después del movimiento: el kardex la
   * conserva igual (mismo criterio que `itemEliminado`), solo se queda sin
   * nombre para mostrar.
   */
  ubicacionNombre: string | null;
}

interface MovimientoRow {
  movimiento_id: string;
  item_id: string;
  // `LEFT JOIN items` pero no nullable: `movimientos_inventario.item_id` es
  // `NOT NULL REFERENCES items`, así que la fila padre siempre está. El LEFT
  // solo saca de la ecuación el filtro de borrado, no la existencia.
  item_nombre: string;
  tipo: string;
  motivo: string;
  cantidad: string;
  stock_anterior: string;
  stock_resultante: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  comentario: string | null;
  creado_el: Date;
  costo_unitario: string | null;
  costo_anterior: string | null;
  causa_merma_id: string | null;
  causa_nombre: string | null;
  motivo_diferencia_id: string | null;
  unidad_medida: string | null;
  moneda_id: string;
  item_eliminado: boolean;
  ubicacion_id: string;
  ubicacion_nombre: string | null;
}
