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
import { serieNormalizadaSql } from '../items/entities/item-unidad.entity';
import type { FindMovimientosDto } from './dto/find-movimientos.dto';
import type { AjusteCostoDto } from './dto/ajuste-costo.dto';
import type { FindStockMinimoDto } from './dto/find-stock-minimo.dto';
import type { OrigenStockMinimo } from './entities/stock-minimo.entity';
import {
  bordeFechaSql,
  bordeHastaSql,
  diaNegocioTenant,
  empujarDiaNegocio,
  fechaLocalTenant,
  requiereDiaNegocio,
  type DiaNegocio,
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
  unidadIds?: string[]; // salida serie: IDs de unidades a consumir (obligatorias)
  /**
   * La cuenta abierta del salón dueña de esta salida (la que se cierra o la que
   * anula su línea). Solo importa en la salida de modo `serie`: una unidad
   * apartada por una cuenta abierta solo puede salir por esa misma cuenta, y
   * cualquier otra salida la rechaza. Ausente en el resto de los llamadores.
   */
  cuentaId?: string | null;
  // Modo 'lote'
  lote?: LoteInput; // entrada lote: crea o agrega a lote existente
  loteId?: string; // salida lote: lote a descontar
  motivoBajaId?: string | null;
  /**
   * La anulación (parte 2) que generó este consumo, cuando `motivo` es
   * 'merma' porque el plato salió de una línea de cuenta anulada. Solo la
   * parte 2 la escribe; una merma normal la deja en null.
   */
  cuentaLineaAnulacionId?: string | null;
  /**
   * Si es true y la salida en modo `cantidad` no tiene stock suficiente,
   * descuenta `min(disponible, cantidad)` en vez de lanzar — nunca deja el
   * stock negativo. Reusa el `stockAnterior` que este método ya leyó bajo su
   * propio lock: no dispara ninguna lectura de stock nueva. Solo aplica en
   * modo `cantidad`: en modo serie/lote el chokepoint no tiene forma de
   * entregar "media unidad" o "medio lote", así que ahí sigue lanzando
   * `Stock insuficiente...` igual que siempre, banderas o no.
   *
   * Solo con `motivo: 'merma'` (mismo par de guards que `motivoBajaId`):
   * `ItemsService.consumirLineaAnulada` (spec `anular-plato-despachado` §4.3,
   * ronda de fixes 1, owner) la usa porque el plato ya salió de cocina y la
   * anulación no puede quedar bloqueada por un faltante de stock que no es
   * culpa de ese momento. Default `false`/ausente: el resto de los llamadores
   * (incluida la venta) no cambia de comportamiento.
   */
  permiteSalidaParcial?: boolean;
  motivoDiferenciaId?: string | null; // solo en motivo='recuento'
  /**
   * El documento interno que ata las DOS filas de kardex de un traslado
   * (salida en el origen, entrada en el destino). Solo en motivo='traslado'.
   */
  trasladoId?: string | null;
  /**
   * La línea de compra que genera este movimiento (spec compras-recepcion
   * § 3.4). Solo en motivo `compra` (la entrada, las diferencias de cantidad,
   * la anulación) y `correccion_compra`, que además la exige.
   */
  compraLineaId?: string | null;
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
   * tomado de varios lotes, por vencimiento), y así las dos filas de kardex describen el
   * mismo movimiento.
   */
  loteConsumos?: { loteId: string; cantidad: string }[];
}

interface MoverResult {
  stockResultante: Decimal;
  unidadIds?: string[];
  loteId?: string;
  loteConsumos?: { loteId: string; cantidad: string }[];
  /**
   * Lo que de verdad se movió, cuando puede ser MENOS que lo pedido —solo lo
   * llena `moverCantidad` con `permiteSalidaParcial`—. Ausente en el resto de
   * los casos: el chokepoint asume `cantidad` (lo pedido) cuando no viene.
   */
  cantidadMovida?: Decimal;
}

/**
 * Los únicos motivos que un ítem eliminado sigue aceptando: los que **deshacen**
 * algo, o los que registran un consumo que YA ocurrió aunque el catálogo haya
 * cambiado después. Anular una venta o recibir una devolución cierran una
 * operación que existió y cuya plata ya se movió, así que tienen que poder
 * ejecutarse aunque el producto se haya discontinuado después. Comprar,
 * ajustar costo o contar un producto eliminado no tiene operación real
 * detrás.
 *
 * `traslado` entró el 2026-09-07 con `POST /traslados` y no rompe ese criterio:
 * mover mercadería de lugar no crea ni valoriza nada —el costo no se toca y el
 * total del tenant no cambia—, y sin él una bodega llena de producto
 * discontinuado no se podría vaciar nunca, que es justo lo que hay que hacer
 * para poder eliminar esa bodega (`docs/features/bodegas-y-traslados.md`, «Bordes»,
 * última fila).
 *
 * `merma` entró el 2026-09-16 (spec `anular-plato-despachado` §4.3, owner): un
 * plato ya despachado a cocina consumió el ingrediente de verdad, se anule la
 * línea o no — borrar el producto del catálogo entretanto no deshace ese
 * consumo, y no dejar rastro en el kardex sería peor que dejarlo.
 *
 * ⚠️ La allowlist es por MOTIVO, no por llamador: se abre para **cualquier**
 * escritura de `merma` sobre un ítem eliminado, no solo para
 * `ItemsService.consumirLineaAnulada` (que es quien lo necesita). Hoy es
 * segura igual porque `MermasService.registrar` —el único otro llamador con
 * este motivo— sigue rechazando un ítem borrado por su cuenta (404, antes de
 * llegar a este chokepoint) y no hay un tercer llamador. Si mañana aparece
 * uno, hereda esta apertura salvo que también filtre `eliminado_el` por su
 * cuenta — corregido acá (ronda de fixes 1, Minor 5 de la revisión): la
 * versión anterior de este comentario decía que la allowlist "solo le abre la
 * puerta" al llamador nuevo, lo cual no es cierto: la lista no distingue
 * quién llama.
 *
 * Es una allowlist y no una lista de rechazos a propósito: un motivo nuevo nace
 * rechazado sobre un eliminado, que es el lado seguro del default.
 */
const MOTIVOS_SOBRE_ITEM_ELIMINADO = [
  'anulacion',
  'devolucion',
  'traslado',
  'merma',
];

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

/**
 * Ajustes de VALOR: cantidad 0, tipo `ajuste`, pisan `costo_actual` y dejan el
 * anterior en `costo_anterior`. `correccion_compra` NO va en
 * `MOTIVOS_QUE_RECALCULAN_CPP` —su costo ES el resultado de rehacer la
 * cuenta, no una entrada que promediar— ni en `MOTIVOS_SOBRE_ITEM_ELIMINADO`:
 * una línea de un producto en la papelera no se corrige (lado seguro del
 * default de esa allowlist).
 */
const MOTIVOS_DE_VALOR = ['ajuste_costo', 'correccion_compra'];

/**
 * Salidas que nunca se llevan un lote vencido. `venta`: un lote vencido se
 * merma pero no se vende —la venta lo salta y saca del siguiente— (owner,
 * 2026-09-28); vale igual para el ingrediente de una receta, que sale con
 * motivo `venta`. `traslado`: sin lote elegido, los vencidos se quedan donde
 * están para mermarlos ahí (owner, 2026-10-03); elegido a mano, sí viajan.
 *
 * El resto (`merma`, ajuste, recuento, compra) sí puede sacarlos: mermar un
 * vencido es justamente lo que hay que hacer con él, y con el orden por
 * vencimiento la merma sin lote elegido se lleva primero el vencido.
 */
const MOTIVOS_QUE_SALTAN_VENCIDOS = ['venta', 'traslado'];

/**
 * El par está bajo su mínimo: hay mínimo cargado y el saldo —0 si nunca se
 * movió ahí— es estrictamente menor. Igual al mínimo no avisa. Cuenta unidades
 * del saldo materializado, igual para los modos `cantidad`, `serie` y `lote`.
 * Supone los alias `sm` (stock_minimo) y `su` (stock_ubicacion).
 */
const BAJO_MINIMO_SQL = `(sm.minimo IS NOT NULL AND COALESCE(su.stock, 0) < sm.minimo)`;

/**
 * Ya hay mercadería pedida para ese par: una compra en `borrador` con una
 * línea del ítem, que entra a esa misma ubicación. Solo `borrador`: una
 * `confirmada` ya movió el stock (si igual está abajo, lo que llegó no
 * alcanzó y es urgencia real) y una `anulada` no trae nada. Se evalúa en vivo,
 * así que sacar la línea o descartar el borrador lo devuelve al aviso.
 * ⚠️ Una compra acá es "cargar lo que llegó", no una orden a proveedor
 * (`docs/features/compras.md`): el borrador es lo más parecido a "en camino"
 * que el sistema tiene hoy. Supone los alias `i` y `u`, y el tenant en `$1`.
 */
const EN_CAMINO_SQL = `EXISTS (
  SELECT 1
    FROM compra_lineas cl
    JOIN compras c ON c.compra_id = cl.compra_id
   WHERE cl.item_id = i.item_id AND c.ubicacion_id = u.ubicacion_id
     AND c.tenant_id = $1 AND c.estado = 'borrador'
     AND c.eliminado_el IS NULL AND cl.eliminado_el IS NULL
)`;

@Injectable()
export class InventarioService {
  constructor(
    @InjectRepository(MovimientoInventario)
    private readonly movimientoRepo: Repository<MovimientoInventario>,
    private readonly db: Db,
    private readonly catalogService: CatalogService,
    private readonly ubicacionesService: UbicacionesService,
  ) {}

  /**
   * "Hoy" en el calendario del local (zona de la provincia), memo por
   * transacción. Una venta con varias líneas en modo lote pasa por
   * `moverLote` una vez por línea, y resolver la zona en cada una sería una
   * consulta por iteración. La clave es el `queryRunner` de la transacción y
   * no la instancia —que es singleton— ni el `manager` sin transacción, que
   * vive para siempre y serviría el día de ayer pasada la medianoche. Sin
   * `queryRunner` no hay memo: se resuelve cada vez.
   */
  private readonly hoyLocalPorTx = new WeakMap<
    object,
    Map<string, Promise<string>>
  >();

  private hoyLocal(manager: EntityManager, tenantId: string): Promise<string> {
    const tx = manager.queryRunner;
    if (!tx) return fechaLocalTenant(manager, tenantId, new Date());
    let porTenant = this.hoyLocalPorTx.get(tx);
    if (!porTenant) {
      porTenant = new Map();
      this.hoyLocalPorTx.set(tx, porTenant);
    }
    let hoy = porTenant.get(tenantId);
    if (!hoy) {
      hoy = fechaLocalTenant(manager, tenantId, new Date());
      porTenant.set(tenantId, hoy);
    }
    return hoy;
  }

  async registrarMovimiento(
    manager: EntityManager,
    params: RegistrarMovimientoParams,
  ): Promise<{
    movimientoId: string;
    stockAnterior: string;
    stockResultante: string;
    /**
     * Lo que de verdad se descontó/agregó. Igual a `params.cantidad` salvo
     * que `permiteSalidaParcial` haya clampado una salida en modo `cantidad`
     * por falta de stock — ahí es MENOS, y el llamador lo usa para calcular
     * el faltante (`params.cantidad - cantidadMovida`) y avisarlo.
     */
    cantidadMovida: string;
    // Costo vigente antes/después de este movimiento, leídos dentro del mismo
    // FOR UPDATE que serializa la concurrencia — a diferencia de un pre-check
    // que corre antes de tomar el lock (bajo READ COMMITTED, una compra
    // concurrente que commitea en el medio ya es visible), estos valores son
    // los que de verdad quedaron escritos en el kardex.
    costoActualPrevio: string | null;
    costoActual: string | null;
    /**
     * Qué se movió realmente, para que el llamador no tenga que adivinarlo.
     * Solo lo usa el traslado: su SALIDA puede auto-seleccionar lotes (por
     * vencimiento; las unidades con serie ya no se auto-seleccionan, se nombran),
     * y la ENTRADA tiene que registrar **esos mismos** —no volver a elegir— o las
     * dos filas de kardex describirían movimientos distintos.
     */
    unidadIds?: string[];
    loteConsumos?: { loteId: string; cantidad: string }[];
    loteId?: string;
  }> {
    if (!params.ubicacionId) {
      throw new BadRequestException('El movimiento necesita una ubicación');
    }

    // La ubicación, contra su borrado: `FOR SHARE`, el par del `FOR UPDATE` de
    // `UbicacionesService.remove`. Sin él, un borrado concurrente contaba 0 de
    // saldo sin ver lo que este movimiento todavía no commiteaba, y el saldo
    // quedaba colgado de una bodega borrada: fuera de `GET /items` y del peso
    // del CPP (`test/ajuste-borrado-ubicacion-concurrente.e2e-spec.ts`). Acá y
    // no en cada llamador, porque este método es el chokepoint. Y ANTES del
    // `FOR UPDATE OF ip` de abajo: el orden del traslado
    // (`docs/patterns/backend.md` §15). Para el traslado, que ya tomó este
    // lock al leer origen y destino, volver a pedirlo no hace nada.
    await this.ubicacionesService.bloquearContraBorrado(
      manager,
      params.tenantId,
      params.ubicacionId,
    );

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
          'solo admite movimientos de anulación, devolución, traslado o merma',
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

    // Los ajustes de VALOR no mueven cantidad: son los únicos motivos que
    // registran cantidad 0. `ajuste_costo` es el que tipea una persona;
    // `correccion_compra` es el que deja "rehacer la cuenta" de compras
    // (spec compras-recepcion § 4.3) con el costo recalculado. La mecánica es la
    // misma —pisa `costo_actual` y deja el anterior en el kardex—; lo que cambia
    // es de dónde sale el número.
    const esAjusteCosto = MOTIVOS_DE_VALOR.includes(params.motivo);
    if (esAjusteCosto) {
      if (params.tipo !== 'ajuste') {
        throw new BadRequestException("El ajuste de costo usa tipo 'ajuste'");
      }
      if (!cantidad.isZero()) {
        throw new BadRequestException('El ajuste de costo no mueve cantidad');
      }
      // `correccion_compra` es la única que puede dejar el producto SIN costo:
      // anular la única entrada con costo de un producto que no tenía lo
      // devuelve a como estaba (owner, 2026-09-19). Un `ajuste_costo` lo tipea
      // una persona, y "sin costo" no es un costo que se tipee.
      if (
        params.costoUnitario == null &&
        params.motivo !== 'correccion_compra'
      ) {
        throw new BadRequestException(
          'El ajuste de costo requiere el costo nuevo',
        );
      }
    } else if (cantidad.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }

    if (params.motivo === 'merma' && !params.motivoBajaId) {
      throw new BadRequestException('La merma requiere un motivo de baja');
    }
    if (params.motivo !== 'merma' && params.motivoBajaId) {
      throw new BadRequestException('motivo_baja_id solo aplica a merma');
    }
    if (params.motivo !== 'merma' && params.cuentaLineaAnulacionId) {
      throw new BadRequestException(
        'cuenta_linea_anulacion_id solo aplica a merma',
      );
    }
    if (params.motivo !== 'merma' && params.permiteSalidaParcial) {
      throw new BadRequestException('permiteSalidaParcial solo aplica a merma');
    }
    if (params.permiteSalidaParcial && params.tipo !== 'salida') {
      throw new BadRequestException(
        'permiteSalidaParcial solo aplica a una salida',
      );
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
    // Mismo par de guards que `motivo_baja_id` y `motivo_diferencia_id`: el
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
    // Mismo par para la línea de compra. La entrada `compra` del atajo del
    // ajuste de stock no tiene línea, así que ahí es opcional; la corrección de
    // costo sí la exige, porque sin ella el kardex no dice qué compra la causó.
    if (params.motivo === 'correccion_compra' && !params.compraLineaId) {
      throw new BadRequestException(
        'La corrección de compra requiere la línea que la respalda',
      );
    }
    if (
      params.compraLineaId &&
      params.motivo !== 'compra' &&
      params.motivo !== 'correccion_compra'
    ) {
      throw new BadRequestException(
        'compra_linea_id solo aplica a compra y a correccion_compra',
      );
    }
    // Los otros dos campos que solo el traslado usa. Van con su guard por la
    // misma razón que `motivo_baja_id`: un campo que llega poblado donde no
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
    // está el valor de antes: `assertCostoNoColapsaACero`, en cada llamador
    // que convierte.
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
      // El peso del promedio es el stock del PRODUCTO en todo el tenant, no
      // `stockAnterior`: ése es el de la ubicación del movimiento y el costo es
      // uno solo por producto (decisión 3 de
      // `docs/features/bodegas-y-traslados.md`). Con el de la ubicación, 10 kg
      // comprados en un local vacío pisaban el costo de los 100 kg de la bodega.
      // Red: `test/costeo-cpp-multiubicacion.e2e-spec.ts`.
      //
      // Statement aparte y ya con el lock de `item_producto` en la mano, por lo
      // mismo que el saldo de arriba: todo escritor de `stock_ubicacion` en
      // runtime (el seeder solo siembra al arrancar) pasa por este método y
      // toma ese lock primero, así que una entrada concurrente en OTRA
      // ubicación ya commiteó cuando esto lee. Va antes del upsert de `moverX`:
      // es el stock previo a este movimiento.
      //
      // La definición del peso vive en `stockTotalPorProducto`, que comparten
      // compras (la congela en la línea) y "rehacer la cuenta".
      const stockTotal = (
        await this.stockTotalPorProducto(manager, params.tenantId, [
          params.itemId,
        ])
      ).get(params.itemId)!;
      costoActualNuevo = this.calcularCostoPromedio(
        new Decimal(stockTotal),
        costoActualPrevio,
        cantidad,
        params.costoUnitario,
      );
    } else if (esAjusteCosto && params.costoUnitario != null) {
      // Escala de captura: el número lo tipeó una persona en el ajuste manual
      // y se lleva a la escala de costo (ESCALA_COSTO). No mira modo_redondeo
      // a propósito — esa perilla es la política de lo cobrado, no de captura.
      costoActualNuevo = new Decimal(params.costoUnitario).toFixed(
        ESCALA_COSTO,
      );
    }
    // La corrección que deja el producto sin costo (validada arriba): pisa
    // `costo_actual` con null. Aparte de `costoActualNuevo`, cuyo null
    // significa "no se toca".
    const borraCosto = esAjusteCosto && params.costoUnitario == null;

    // El kardex congela lo que se PAGÓ en este movimiento, no el promedio. La
    // corrección a "sin costo" congela eso: null, no el costo que borra.
    const costoUnitarioCongelado =
      params.costoUnitario != null
        ? params.costoUnitario
        : borraCosto
          ? null
          : costoActualPrevio;

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
    // Lo que de verdad se movió: normalmente igual a lo pedido, MENOS que eso
    // solo cuando `moverCantidad` clampó por `permiteSalidaParcial`. El kardex
    // registra esto, no lo pedido — si guardara `cantidad` (lo pedido) la fila
    // diría "salieron 0.2 kg" cuando `stock_resultante` solo bajó 0.05, un
    // kardex que no cierra con su propio saldo.
    const cantidadMovida = result.cantidadMovida ?? cantidad;

    const insertRows: { movimiento_id: string }[] = await manager.query(
      `INSERT INTO movimientos_inventario
         (tenant_id, item_id, ubicacion_id, tipo, motivo, cantidad,
          stock_anterior, stock_resultante, venta_id, usuario_id, comentario,
          costo_unitario, costo_anterior, motivo_baja_id, motivo_diferencia_id,
          traslado_id, cuenta_linea_anulacion_id, compra_linea_id,
          costo_informado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING movimiento_id`,
      [
        params.tenantId,
        params.itemId,
        params.ubicacionId,
        params.tipo,
        params.motivo,
        cantidadMovida.toString(),
        stockAnterior.toString(),
        stockResultante.toString(),
        params.ventaId ?? null,
        params.usuarioId,
        params.comentario ?? null,
        costoUnitarioCongelado,
        esAjusteCosto ? costoActualPrevio : null,
        params.motivoBajaId ?? null,
        params.motivoDiferenciaId ?? null,
        params.trasladoId ?? null,
        params.cuentaLineaAnulacionId ?? null,
        params.compraLineaId ?? null,
        // Si trajo costo: `costo_unitario` no lo dice, porque sin costo congela
        // el CPP vigente. "Rehacer la cuenta" lo lee para saber qué entrada
        // promedió (spec compras-recepcion § 4.3).
        params.costoUnitario != null,
      ],
    );

    const movimientoId = insertRows[0].movimiento_id;
    await this.insertarDetalleMovimiento(
      manager,
      movimientoId,
      params.cantidad,
      result,
    );

    if (costoActualNuevo != null || borraCosto) {
      await manager.query(
        `UPDATE item_producto SET costo_actual = $1 WHERE item_id = $2`,
        [costoActualNuevo, params.itemId],
      );
    }

    return {
      movimientoId,
      stockAnterior: stockAnterior.toString(),
      stockResultante: stockResultante.toString(),
      cantidadMovida: cantidadMovida.toString(),
      costoActualPrevio,
      costoActual: borraCosto ? null : (costoActualNuevo ?? costoActualPrevio),
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
   * El stock de cada producto sumado en todas sus ubicaciones: el PESO del
   * costo promedio (ADR-016, addendum 2026-09-18). Una sola definición para
   * todos los que lo usan —el promedio de `registrarMovimiento`, la línea de
   * compra que lo congela al confirmar y "rehacer la cuenta"—, porque dos
   * copias de esta SQL se separarían con el primer cambio y la cuenta rehecha
   * partiría de otro número.
   *
   * En lote (`ANY`) para que compras no haga una consulta por línea. Filtra
   * ubicaciones eliminadas igual que el stock total de `GET /items`, para que
   * el peso sea el mismo número que ve la pantalla. Un id sin filas vuelve
   * `'0'`.
   *
   * ⚠️ Se llama con el lock de `item_producto` ya tomado: fuera de él, una
   * entrada concurrente en otra ubicación puede no estar commiteada todavía.
   *
   * Acota por tenant por su cuenta, a través de la ubicación, en vez de
   * confiar en que el llamador ya validó los ids: los llamadores de compras
   * arman el lote desde las líneas de un documento, y un id de otro tenant
   * colado en ese arreglo tiene que sumar cero, no el stock ajeno.
   */
  async stockTotalPorProducto(
    manager: EntityManager,
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, string>> {
    const rows: { item_id: string; stock: string }[] = await manager.query(
      `SELECT su.item_id, COALESCE(SUM(su.stock), 0) AS stock
         FROM stock_ubicacion su
         JOIN ubicaciones u
           ON u.ubicacion_id = su.ubicacion_id AND u.eliminado_el IS NULL
          AND u.tenant_id = $2
        WHERE su.item_id = ANY($1::uuid[])
        GROUP BY su.item_id`,
      [itemIds, tenantId],
    );
    const porItem = new Map(rows.map((r) => [r.item_id, r.stock]));
    return new Map(itemIds.map((id) => [id, porItem.get(id) ?? '0']));
  }

  /**
   * "Rehacer la cuenta" (spec compras-recepcion § 4.3): el CPP del producto
   * recalculado desde una compra hacia adelante, como si sus líneas hubieran
   * llegado desde el principio con la cantidad y el costo que tienen HOY. Lo
   * llaman corregir y anular una compra; confirmar no, porque ahí no hay nada
   * que rehacer.
   *
   * Parte del punto congelado en la primera línea de la compra con ese producto
   * (`stock_total_anterior`, `costo_producto_anterior`) y recorre el kardex del
   * producto en todas las ubicaciones por `secuencia`, el orden real de
   * aplicación (`creado_el` es la hora en que EMPEZÓ cada transacción). Las
   * entradas que promedian pasan por `calcularCostoPromedio`, la misma cuenta
   * que `registrarMovimiento`: una copia se separaría con el primer cambio.
   *
   * Si el resultado difiere del `costo_actual`, lo escribe con una
   * `correccion_compra`. Ningún movimiento pasado cambia su costo congelado: lo
   * vendido queda como estaba.
   *
   * Un resultado sin costo (`null`) también se escribe: pasa cuando la compra
   * anulada era la única entrada con costo de un producto que no tenía, y el
   * producto vuelve a quedar sin costo (owner, 2026-09-19).
   */
  async recalcularCostoDesdeCompra(
    manager: EntityManager,
    p: {
      tenantId: string;
      itemId: string;
      compraId: string;
      usuarioId: string;
      comentario: string;
    },
  ): Promise<{
    costoAnterior: string | null;
    costoNuevo: string | null;
    movimientoId: string | null;
  }> {
    // 1. Dónde queda la corrección, con su lock ANTES del de `item_producto`
    //    (`docs/patterns/backend.md` §15). El JOIN no filtra la ubicación
    //    eliminada a propósito: es justo lo que se pregunta. Si la bodega de la
    //    compra se vació y se borró, la corrección va al local, porque
    //    `bloquearContraBorrado` da 404 sobre una ubicación borrada. La
    //    corrección no mueve stock, así que la ubicación solo dice dónde se lee.
    const compraRows: { ubicacion_id: string; ubicacion_viva: boolean }[] =
      await manager.query(
        `SELECT c.ubicacion_id, (u.eliminado_el IS NULL) AS ubicacion_viva
           FROM compras c
           JOIN ubicaciones u
             ON u.ubicacion_id = c.ubicacion_id AND u.tenant_id = c.tenant_id
          WHERE c.tenant_id = $1 AND c.compra_id = $2 AND c.eliminado_el IS NULL`,
        [p.tenantId, p.compraId],
      );
    if (!compraRows.length) {
      throw new NotFoundException('Compra no encontrada');
    }
    const ubicacionId = compraRows[0].ubicacion_viva
      ? compraRows[0].ubicacion_id
      : await this.ubicacionesService.localDe(p.tenantId);
    await this.ubicacionesService.bloquearContraBorrado(
      manager,
      p.tenantId,
      ubicacionId,
    );

    // 2. El producto, bajo el mismo lock que `registrarMovimiento`: mientras se
    //    recorre el kardex nadie le agrega un movimiento, y la corrección de
    //    abajo lo vuelve a pedir dentro de esta transacción, así que no espera.
    const productoRows: { costo_actual: string | null }[] = await manager.query(
      `SELECT ip.costo_actual
         FROM item_producto ip
         JOIN items i ON i.item_id = ip.item_id
        WHERE ip.item_id = $1 AND i.tenant_id = $2
        FOR UPDATE OF ip`,
      [p.itemId, p.tenantId],
    );
    if (!productoRows.length) {
      throw new BadRequestException('El item no tiene control de stock');
    }
    const costoAnterior = productoRows[0].costo_actual;

    // 3. El punto de partida: la primera línea de la compra con este producto,
    //    por el orden en que entró al kardex.
    const partidaRows: {
      compra_linea_id: string;
      stock_total_anterior: string;
      costo_producto_anterior: string | null;
      secuencia: string;
    }[] = await manager.query(
      `SELECT cl.compra_linea_id, cl.stock_total_anterior,
              cl.costo_producto_anterior, m.secuencia
         FROM compra_lineas cl
         JOIN movimientos_inventario m
           ON m.movimiento_id = cl.movimiento_id AND m.eliminado_el IS NULL
        WHERE cl.tenant_id = $1 AND cl.compra_id = $2 AND cl.item_id = $3
          AND cl.eliminado_el IS NULL
        ORDER BY m.secuencia
        LIMIT 1`,
      [p.tenantId, p.compraId, p.itemId],
    );
    if (!partidaRows.length) {
      throw new BadRequestException(
        'La compra no tiene una entrada de ese producto: no hay cuenta que rehacer',
      );
    }
    const partida = partidaRows[0];

    // 4. El recorrido, en UNA consulta: cada movimiento con la cantidad y el
    //    costo VIGENTES de su línea de compra, si tiene, y el estado de la
    //    compra. Sin filtro de ubicación eliminada (spec § 4.3): mientras tuvo
    //    stock, ese stock entró en el peso del CPP de su momento.
    //    Los JOIN a `compra_lineas` y `compras` no filtran `eliminado_el`, y no
    //    es un olvido: una línea con movimiento es de una compra confirmada, y
    //    ni esa línea ni esa compra se borran (la compra se anula). Filtrarlos
    //    mandaría su entrada, en silencio, a la rama de "sin línea".
    const movimientos: {
      tipo: string;
      motivo: string;
      cantidad: string;
      stock_anterior: string;
      stock_resultante: string;
      costo_unitario: string | null;
      costo_informado: boolean;
      compra_linea_id: string | null;
      es_entrada_de_linea: boolean | null;
      cantidad_base: string | null;
      costo_unitario_base: string | null;
      compra_estado: string | null;
    }[] = await manager.query(
      `SELECT m.tipo, m.motivo, m.cantidad, m.stock_anterior,
              m.stock_resultante, m.costo_unitario, m.costo_informado,
              m.compra_linea_id,
              (m.movimiento_id = cl.movimiento_id) AS es_entrada_de_linea,
              cl.cantidad_base, cl.costo_unitario_base,
              c.estado AS compra_estado
         FROM movimientos_inventario m
         LEFT JOIN compra_lineas cl
           ON cl.compra_linea_id = m.compra_linea_id
          AND cl.tenant_id = m.tenant_id
         LEFT JOIN compras c
           ON c.compra_id = cl.compra_id AND c.tenant_id = cl.tenant_id
        WHERE m.tenant_id = $1 AND m.item_id = $2 AND m.secuencia >= $3
          AND m.eliminado_el IS NULL
        ORDER BY m.secuencia`,
      [p.tenantId, p.itemId, partida.secuencia],
    );

    // 5. La cuenta. El stock va sumando lo que cada movimiento cambió en su
    //    ubicación (`stock_resultante - stock_anterior`), que es exactamente lo
    //    que ese movimiento le sumó al stock total.
    let stock = new Decimal(partida.stock_total_anterior);
    let costo = partida.costo_producto_anterior;
    for (const m of movimientos) {
      if (m.motivo === 'compra' && m.compra_linea_id != null) {
        // Una línea de compra entra UNA vez, en su lugar original, con lo que
        // vale hoy. Sus diferencias de cantidad y la salida de su anulación ya
        // están contadas ahí; una compra anulada no entra.
        if (!m.es_entrada_de_linea || m.compra_estado === 'anulada') continue;
        const cantidad = new Decimal(m.cantidad_base!);
        if (m.costo_unitario_base != null) {
          costo = this.calcularCostoPromedio(
            stock,
            costo,
            cantidad,
            m.costo_unitario_base,
          );
        }
        stock = stock.plus(cantidad);
        continue;
      }
      // Solo `ajuste_costo` reinicia, aunque `correccion_compra` también sea un
      // ajuste de valor: ésa es un resultado de esta misma cuenta, no un hecho.
      // Como no mueve cantidad ni es entrada, cae abajo sin tocar nada.
      if (m.motivo === 'ajuste_costo') {
        costo = m.costo_unitario;
        continue;
      }
      // La misma condición que decide el promedio en `registrarMovimiento`.
      if (
        m.tipo === 'entrada' &&
        m.costo_informado &&
        MOTIVOS_QUE_RECALCULAN_CPP.includes(m.motivo)
      ) {
        costo = this.calcularCostoPromedio(
          stock,
          costo,
          new Decimal(m.cantidad),
          m.costo_unitario!,
        );
      }
      stock = stock.plus(
        new Decimal(m.stock_resultante).minus(m.stock_anterior),
      );
    }

    const igual =
      costo == null || costoAnterior == null
        ? costo === costoAnterior
        : new Decimal(costo).equals(costoAnterior);
    if (igual) {
      return { costoAnterior, costoNuevo: costo, movimientoId: null };
    }

    const mov = await this.registrarMovimiento(manager, {
      tenantId: p.tenantId,
      itemId: p.itemId,
      ubicacionId,
      tipo: 'ajuste',
      motivo: 'correccion_compra',
      cantidad: '0',
      costoUnitario: costo,
      compraLineaId: partida.compra_linea_id,
      usuarioId: p.usuarioId,
      comentario: p.comentario,
    });
    return {
      costoAnterior: mov.costoActualPrevio,
      costoNuevo: costo,
      movimientoId: mov.movimientoId,
    };
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
   * `stockPrevio` es el del producto en todas las ubicaciones del tenant, no
   * el `stock_anterior` del kardex (que es de la ubicación del movimiento):
   * el costo es uno solo por producto.
   *
   * Sin stock previo o sin costo previo no hay masa que promediar: manda el
   * costo de compra. Eso además evita dividir por cero.
   */
  private calcularCostoPromedio(
    stockPrevio: Decimal,
    costoActualPrevio: string | null,
    cantidad: Decimal,
    costoCompra: string,
  ): string {
    const compra = new Decimal(costoCompra);
    if (stockPrevio.lessThanOrEqualTo(0) || costoActualPrevio == null) {
      // Misma escala y mismo criterio que el CPP de abajo: el comentario de
      // ese `toFixed` cubre el método entero, esta rama incluida.
      return compra.toFixed(ESCALA_COSTO);
    }
    const valorPrevio = stockPrevio.mul(new Decimal(costoActualPrevio));
    const valorEntrante = cantidad.mul(compra);
    // HALF_UP fijo a escala de costo (4): el CPP es una tasa interna —dinero por
    // unidad base de stock—, no un monto cobrable, y por eso no mira modo_redondeo:
    // esa perilla es la política de lo que se le cobra al cliente. Un tenant en
    // FLOOR/CEIL sesgaría acá la valorización en cada compra, compuesto en cada
    // promedio. La escala de la moneda tampoco aplica: hay costos por gramo (< $1).
    return valorPrevio
      .plus(valorEntrante)
      .div(stockPrevio.plus(cantidad))
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
    let cantidadMovida = cantidad;
    let stockResultante =
      params.tipo === 'entrada'
        ? stockAnterior.plus(cantidad)
        : stockAnterior.minus(cantidad);

    if (stockResultante.lessThan(0)) {
      // `permiteSalidaParcial` (ver su docblock en `RegistrarMovimientoParams`):
      // en vez de lanzar, se clampa a lo que HAY —nunca se inventa stock ni
      // queda negativo—. Reusa `stockAnterior`, ya leído bajo el lock de este
      // mismo método: no hay SELECT nuevo acá.
      //
      // `stockAnterior.greaterThan(0)` es la otra mitad de la condición (ronda
      // de fixes 2, Important I-A): con NADA disponible no hay "lo que hay"
      // que mover, y clampar igual a 0 escribiría una fila de kardex con
      // `cantidad = 0` —viola la regla de más arriba, "la cantidad debe ser
      // mayor a cero"— además de un upsert de `stock_ubicacion` a 0 que no
      // cambió nada. Con 0 disponible cae al mismo throw de siempre, y
      // `ItemsService.moverConsumoOSaltear` lo trata como el salteo completo
      // que ya usa para serie/lote.
      if (
        params.tipo === 'salida' &&
        params.permiteSalidaParcial &&
        stockAnterior.greaterThan(0)
      ) {
        cantidadMovida = stockAnterior;
        stockResultante = new Decimal(0);
      } else {
        throw new BadRequestException('Stock insuficiente para la salida');
      }
    }

    await manager.query(
      `INSERT INTO stock_ubicacion (item_id, ubicacion_id, stock)
       VALUES ($1, $2, $3)
       ON CONFLICT (item_id, ubicacion_id) DO UPDATE SET stock = EXCLUDED.stock`,
      [params.itemId, params.ubicacionId, stockResultante.toString()],
    );

    return { stockResultante, cantidadMovida };
  }

  /**
   * La serie es única **por producto vivo** y **comparada normalizada** —
   * `uq_unidad_item_serie`, que lo crea `SeederService`, sobre
   * `(item_id, serieNormalizadaSql('serie')) WHERE eliminado_el IS NULL`—: por
   * producto y no por tenant, porque cada proveedor numera como quiere (owner,
   * 2026-09-19), y sin los blancos de los bordes ni mayúsculas, guardando el
   * texto tal como se tipeó (owner, 2026-09-20).
   *
   * El índice es la red de la base, pero solo: reventarlo da un 500 que no dice
   * cuál serie viene repetida, y el operador que acaba de tipear 30 IMEIs no
   * tiene con qué arreglarlo. Acá sale un 400 que la nombra.
   *
   * Va en `moverSerie` y no en los llamadores porque este es el **único** lugar
   * que inserta en `item_unidad`: los cuatro caminos que crean unidades —alta de
   * producto en modo serie con stock inicial, ajuste/entrada manual de stock,
   * confirmación de compra y `corregirCantidad` de una compra— entran todos por
   * `registrarMovimiento`. Mismo criterio que el resto de este método: el
   * chokepoint no confía en el llamador.
   *
   * Tres rechazos, porque son tres duplicados distintos: la serie que **no dice
   * nada** (solo espacios), las repetidas **dentro de la misma tanda** —que
   * ningún índice puede ver, porque son filas que todavía no existen— y las que
   * **ya están vivas** en el producto.
   *
   * ⚠️ **La normalización la hace Postgres, no JavaScript**, y es deliberado: el
   * `toLowerCase()` de JS y el `lower()` de Postgres **no coinciden fuera de
   * ASCII** (`lower()` depende de la collation), así que normalizar acá en JS
   * dejaría al guard y al índice discrepando en los bordes — y el caso que se
   * escapa vuelve como el 500 del índice que este método existe para evitar. Por
   * eso la consulta le pasa las series **crudas** y deja que la base calcule
   * `lower(btrim(...))` de los dos lados: gemelo exacto por construcción.
   *
   * Es UNA consulta para las N series, no una por serie.
   *
   * `ComprasService.validarTrazabilidad` también rechaza repetidas, pero con
   * `.trim()` y sensible a mayúsculas, y solo dentro de una línea del borrador:
   * es un aviso temprano en la pantalla, no la red.
   */
  private async assertSeriesLibres(
    manager: EntityManager,
    itemId: string,
    series: string[],
  ): Promise<void> {
    // Los filtros de la consulta son **exactamente** la clave y el predicado del
    // índice `uq_unidad_item_serie` —`(item_id, serieNormalizadaSql('serie'))` con
    // `eliminado_el IS NULL`, sin `tenant_id`, que `item_id` ya determina—: un
    // guard que mire una columna de más o normalice distinto deja pasar filas
    // que el índice sí rechaza.
    //
    // Vuelve una fila por serie entrante, con la forma normalizada que calculó
    // la base (`norm`) y, si hay una unidad viva que colisiona, **la serie tal
    // como está guardada** (`ya_viva`): el mensaje puede decir "`abc123 ` choca
    // con `ABC123`", que es lo que el operador necesita para entender por qué su
    // serie "nueva" no entra.
    const filas: {
      cruda: string;
      norm: string;
      ya_viva: string | null;
    }[] = await manager.query(
      `WITH entrantes AS (
         SELECT t.cruda, ${serieNormalizadaSql('t.cruda')} AS norm
           FROM unnest($2::text[]) AS t(cruda)
       )
       SELECT e.cruda,
              e.norm,
              (SELECT u.serie FROM item_unidad u
                WHERE u.item_id = $1
                  AND ${serieNormalizadaSql('u.serie')} = e.norm
                  AND u.eliminado_el IS NULL
                LIMIT 1) AS ya_viva
         FROM entrantes e`,
      [itemId, series],
    );

    // Una serie que normaliza a vacío no identifica nada. El borde ya la rechaza
    // —las tres DTO piden `@Matches(/\S/)`—, así que por la API esto no se
    // alcanza; vive acá igual porque es el invariante del chokepoint, no una
    // regla de pantalla, y lo cubre un test unitario.
    const enBlanco = filas.filter((f) => f.norm === '');
    if (enBlanco.length > 0) {
      throw new BadRequestException('Una serie no puede ser solo espacios');
    }

    const vistas = new Set<string>();
    const repetidas: string[] = [];
    for (const f of filas) {
      if (vistas.has(f.norm)) repetidas.push(f.cruda);
      vistas.add(f.norm);
    }
    if (repetidas.length > 0) {
      throw new BadRequestException(
        `Estas series vienen repetidas en la misma entrada: ${[
          ...new Set(repetidas),
        ]
          .sort()
          .join(', ')}`,
      );
    }

    const ocupadas = filas.filter((f) => f.ya_viva != null);
    if (ocupadas.length > 0) {
      // Nombra las dos: la que se mandó y la que ya está guardada. Cuando
      // difieren solo en mayúsculas o en un espacio, ver solo una de las dos
      // hace que el mensaje parezca un error del sistema.
      const detalle = ocupadas
        .map((o) =>
          o.cruda === o.ya_viva
            ? `"${o.cruda}"`
            : `"${o.cruda}" (ya existe como "${o.ya_viva!}")`,
        )
        .sort()
        .join(', ');
      throw new BadRequestException(
        `Este producto ya tiene una unidad con ${
          ocupadas.length === 1 ? 'la serie' : 'las series'
        }: ${detalle}`,
      );
    }
  }

  /**
   * La validación de unidades de una salida en modo serie: UNA, compartida por
   * la salida de `moverSerie` (venta, merma, ajuste, traslado) y por el salón al
   * pedir una línea con serie. Quien vende elige qué unidades salen; acá solo se
   * comprueba que se puedan llevar y se las lockea.
   *
   * Orden de bloqueo (`docs/patterns/backend.md` §15): `item_producto` primero,
   * después las unidades **en un solo `SELECT … ORDER BY unidad_id FOR UPDATE`**,
   * nunca en el orden en que las mandó el cliente. El `ORDER BY` es lo que decide
   * el orden de adquisición, y ningún test de conducta caza su ausencia: lo fija
   * el unitario sobre el SQL.
   *
   * Toma el lock de `item_producto` por su cuenta aunque `registrarMovimiento`
   * ya lo tenga: el salón llama acá en un PATCH que cambia una unidad por otra
   * sin cambiar la cantidad, y ese camino no pasa por `validarStockAlPedir`.
   * Re-lockear la misma fila en la misma transacción no cuesta nada. El chequeo
   * de apartado se lee con ese lock tomado: pedir en el salón y vender en el POS
   * se serializan ahí, por eso no hace falta un índice único sobre lo apartado.
   *
   * Devuelve las filas en orden de `unidad_id`.
   */
  async bloquearUnidadesParaSalida(
    manager: EntityManager,
    p: {
      tenantId: string;
      itemId: string;
      ubicacionId: string;
      unidadIds: string[];
      cuentaId?: string | null;
    },
  ): Promise<{ unidad_id: string; serie: string; condicion: string }[]> {
    // Un uuid en mayúsculas es la misma unidad que en minúsculas (Postgres lo
    // devuelve siempre en minúsculas): se normaliza antes del chequeo de
    // repetidas y de los `Map`/`includes` de más abajo, igual que el dedupe de
    // `ventas.service`.
    const unidadIds = p.unidadIds.map((u) => u.toLowerCase());
    if (new Set(unidadIds).size !== unidadIds.length) {
      throw new BadRequestException('Una unidad viene repetida');
    }

    // Mismo acote por tenant contra el padre que el chokepoint (`item_producto`
    // no tiene `tenant_id`), y `OF ip` por la misma razón. Trae el nombre para
    // el mensaje de "elegí", sin una query más.
    // SIN `i.eliminado_el IS NULL`, a propósito: el producto de una línea ya
    // pedida puede haberse eliminado después, y su línea igual tiene que poder
    // anularse (devolver la unidad). El chokepoint (`registrarMovimiento`) lee
    // `item_eliminado_el` y es quien decide, por motivo, si un producto
    // eliminado admite el movimiento; filtrar acá lo volvería un "no existe".
    const productoRows: { item_nombre: string }[] = await manager.query(
      `SELECT i.nombre AS item_nombre
         FROM item_producto ip
         JOIN items i ON i.item_id = ip.item_id
        WHERE ip.item_id = $1 AND i.tenant_id = $2
        FOR UPDATE OF ip`,
      [p.itemId, p.tenantId],
    );
    if (!productoRows.length) {
      throw new BadRequestException('El item no tiene control de stock');
    }
    if (unidadIds.length === 0) {
      throw new BadRequestException(
        `Elegí qué unidades salen: «${productoRows[0].item_nombre}» tiene número de serie`,
      );
    }

    // `tenant_id` y `eliminado_el` en la query: una unidad ajena o borrada no
    // vuelve, y se rechaza con el mismo mensaje que una de otro producto — no
    // distingue, para que el 400 no sea un oráculo entre tenants.
    const filas: {
      unidad_id: string;
      serie: string;
      condicion: string;
      estado: string;
      item_id: string;
      ubicacion_id: string;
    }[] = await manager.query(
      `SELECT unidad_id, serie, condicion, estado, item_id, ubicacion_id
         FROM item_unidad
        WHERE unidad_id = ANY($1) AND tenant_id = $2 AND eliminado_el IS NULL
        ORDER BY unidad_id
        FOR UPDATE`,
      [unidadIds, p.tenantId],
    );
    const porId = new Map(filas.map((f) => [f.unidad_id, f]));
    for (const uid of unidadIds) {
      if (porId.get(uid)?.item_id !== p.itemId) {
        throw new BadRequestException(
          `Unidad ${uid} no pertenece a este producto`,
        );
      }
    }

    const fueraDeLugar = filas.filter((f) => f.ubicacion_id !== p.ubicacionId);
    if (fueraDeLugar.length) {
      // Una unidad serializada está en un solo lugar: la salida tiene que
      // pedirse desde ahí. El mensaje nombra la ubicación real de la unidad, no
      // solo que "no se puede" — sin eso, quien opera no sabe si falta stock o
      // si está mirando la ubicación equivocada. UNA consulta de nombres para
      // todas las fuera de lugar, acotada por tenant y sin eliminadas: sin el
      // filtro sería un oráculo de nombres de otro tenant en cuanto exista un
      // llamador que reciba `ubicacionId` del body (`POST /traslados`).
      const nombresRows: { ubicacion_id: string; nombre: string }[] =
        await manager.query(
          `SELECT ubicacion_id, nombre FROM ubicaciones
            WHERE ubicacion_id = ANY($1) AND tenant_id = $2
              AND eliminado_el IS NULL`,
          [
            [...fueraDeLugar.map((f) => f.ubicacion_id), p.ubicacionId],
            p.tenantId,
          ],
        );
      const nombreDe = (id: string) =>
        nombresRows.find((r) => r.ubicacion_id === id)?.nombre ?? id;
      throw new BadRequestException(
        `La unidad ${fueraDeLugar[0].serie} está en ${nombreDe(fueraDeLugar[0].ubicacion_id)}, ` +
          `no en ${nombreDe(p.ubicacionId)}`,
      );
    }

    const noDisponible = filas.find((f) => f.estado !== 'disponible');
    if (noDisponible) {
      throw new BadRequestException(
        `La unidad ${noDisponible.serie} no está disponible (estado: ${noDisponible.estado})`,
      );
    }

    // Apartada: la tiene una línea de una cuenta ABIERTA que no es la dueña de
    // esta salida. Solo cuentas vivas y abiertas, en mesas vivas (una mesa con
    // cuentas abiertas no se puede eliminar, así que el JOIN interno no pierde
    // ninguna). Una consulta para todas las unidades.
    const apartadas: { unidad_id: string; mesa_nombre: string }[] =
      await manager.query(
        `SELECT x.unidad_id, me.nombre AS mesa_nombre
           FROM cuenta_lineas cl
           JOIN cuentas c ON c.cuenta_id = cl.cuenta_id AND c.tenant_id = $1
            AND c.estado = 'abierta' AND c.eliminado_el IS NULL
           JOIN mesas me ON me.mesa_id = c.mesa_id AND me.eliminado_el IS NULL
          CROSS JOIN LATERAL unnest(cl.unidad_ids) AS x(unidad_id)
          WHERE cl.tenant_id = $1 AND cl.eliminado_el IS NULL
            AND x.unidad_id = ANY($2::uuid[])
            AND c.cuenta_id IS DISTINCT FROM $3::uuid`,
        [p.tenantId, unidadIds, p.cuentaId ?? null],
      );
    if (apartadas.length) {
      const serie = porId.get(apartadas[0].unidad_id)?.serie;
      throw new BadRequestException(
        `La unidad ${serie ?? apartadas[0].unidad_id} está apartada en la cuenta de ${apartadas[0].mesa_nombre}`,
      );
    }

    return filas.map(({ unidad_id, serie, condicion }) => ({
      unidad_id,
      serie,
      condicion,
    }));
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

      await this.assertSeriesLibres(
        manager,
        params.itemId,
        series.map((s) => s.serie),
      );

      // El `loteId` de una serie es metadato (ADR-007) y tiene que ser un lote
      // vivo de ESTE ítem y de ESTE tenant: `item_unidad.lote_id` no tiene FK,
      // y sin este chequeo una unidad colgaba del lote de otro tenant y
      // `GET /items/:id/unidades` devolvía su código. Un solo mensaje para
      // ajeno, borrado, de otro producto o inexistente: distinguirlos sería un
      // oráculo de uuids entre tenants. La query corre solo si alguna serie
      // trae lote. En minúsculas antes del `Set`: `@IsUUID` acepta mayúsculas
      // y el mismo lote escrito de las dos formas contaría dos contra una fila.
      const loteIds = [
        ...new Set(
          series.flatMap((s) => (s.loteId ? [s.loteId.toLowerCase()] : [])),
        ),
      ];
      if (loteIds.length) {
        const lotesValidos: { lote_id: string }[] = await manager.query(
          `SELECT lote_id FROM item_lote
            WHERE lote_id = ANY($1::uuid[]) AND item_id = $2 AND tenant_id = $3
              AND eliminado_el IS NULL`,
          [loteIds, params.itemId, params.tenantId],
        );
        if (lotesValidos.length !== loteIds.length) {
          throw new BadRequestException(
            'El lote de la serie no es de este producto',
          );
        }
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
      // El chokepoint no elige: quien vende dice qué unidades salen y acá solo
      // se valida y se lockea. El vacío rechaza ANTES que la cantidad, para que
      // el mensaje de "elegí" gane sobre el de "no coincide".
      const unidadIds = params.unidadIds ?? [];
      await this.bloquearUnidadesParaSalida(manager, {
        tenantId: params.tenantId,
        itemId: params.itemId,
        ubicacionId: params.ubicacionId,
        unidadIds,
        cuentaId: params.cuentaId,
      });
      if (!new Decimal(unidadIds.length).equals(cantidad)) {
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

      // UNA sentencia para todas las unidades, ya lockeadas y validadas arriba.
      if (esTraslado) {
        await manager.query(
          `UPDATE item_unidad SET ubicacion_id = $1 WHERE unidad_id = ANY($2)`,
          [params.ubicacionDestinoId, unidadIds],
        );
      } else {
        await manager.query(
          `UPDATE item_unidad SET estado = $1, venta_id = $2 WHERE unidad_id = ANY($3)`,
          [estadoDestino, params.ventaId ?? null, unidadIds],
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
      // automática más abajo, y acá pesa igual o más: cada round-trip de más se paga
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
        // Auto-selección FEFO (owner, 2026-09-28): sale primero el lote que
        // vence antes, entre los que tienen saldo EN ESTA UBICACIÓN. Los lotes
        // sin vencimiento van al final. Dentro del mismo día de vencimiento
        // decide la llegada (`creado_el`); dos lotes de la misma factura
        // llegan en la misma transacción y empatan ahí, así que desempata
        // `codigo_lote` —lo que el usuario ve en la caja— y la PK cierra un
        // orden total.
        //
        // El orden es también el orden en que se toman los locks (en Postgres
        // `LockRows` corre sobre el `Sort`), y por eso tiene que ser total:
        // dos salidas del mismo ítem lockean el mismo conjunto en el mismo
        // orden. Igual corren detrás del ancla `FOR UPDATE OF ip` de
        // `registrarMovimiento`, que ya las serializa.
        //
        // `::date` en la sesión de la base: el mismo cast con que se escribió
        // la fecha pura que manda la pantalla (`'2027-01-15'` → medianoche de
        // la sesión), así que devuelve el día tal como se tipeó. Un timestamp
        // completo cuenta por el día en que cae en esa misma zona.
        //
        // Ancla del lock: todos los lotes del ítem (el alcance de siempre),
        // vencidos incluidos: lo que cambia es cuáles se consumen, no qué se
        // lockea. El saldo por ubicación se lee aparte, ya bajo el lock — ver
        // el docblock de `saldoLoteEnUbicacion`.
        const lotes: {
          lote_id: string;
          codigo_lote: string;
          vence: string | null;
        }[] = await manager.query(
          `SELECT lote_id, codigo_lote, fecha_vencimiento::date::text AS vence
             FROM item_lote
            WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
            ORDER BY fecha_vencimiento::date ASC NULLS LAST, creado_el ASC,
                     codigo_lote ASC, lote_id ASC
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

        // Vencido = su día ya pasó en el calendario del local: el día del
        // vencimiento todavía se vende. La zona se resuelve solo si algún lote
        // tiene fecha y el motivo salta vencidos.
        const hoy =
          MOTIVOS_QUE_SALTAN_VENCIDOS.includes(params.motivo) &&
          lotes.some((l) => l.vence)
            ? await this.hoyLocal(manager, params.tenantId)
            : null;
        const vencido = (l: { vence: string | null }) =>
          hoy !== null && l.vence !== null && l.vence < hoy;

        const lotesConSaldo = lotes.filter(
          (l) => saldoDe.has(l.lote_id) && !vencido(l),
        );

        const totalDisponible = lotesConSaldo.reduce(
          (acc, l) => acc.plus(saldoDe.get(l.lote_id)!),
          new Decimal(0),
        );
        if (totalDisponible.lessThan(cantidad)) {
          const enVencidos = lotes
            .filter((l) => saldoDe.has(l.lote_id) && vencido(l))
            .reduce(
              (acc, l) => acc.plus(saldoDe.get(l.lote_id)!),
              new Decimal(0),
            );
          throw new BadRequestException(
            `Stock insuficiente en lotes en esta ubicación (disponible: ${totalDisponible.toString()}, requerido: ${cantidad.toString()})` +
              (enVencidos.isZero()
                ? ''
                : `; hay ${enVencidos.toString()} más en lotes vencidos`),
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

      const rows: {
        tenant_id: string;
        codigo_lote: string;
        vence: string | null;
      }[] = await manager.query(
        `SELECT tenant_id, codigo_lote, fecha_vencimiento::date::text AS vence
           FROM item_lote
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
      // Elegido a mano, un vencido no se vende (owner, 2026-09-28: bloquear).
      // Solo `venta`: el traslado con lote elegido es justamente la forma de
      // mover un vencido (ver `MOTIVOS_QUE_SALTAN_VENCIDOS`).
      const vence = rows[0].vence;
      if (
        params.motivo === 'venta' &&
        vence &&
        vence < (await this.hoyLocal(manager, params.tenantId))
      ) {
        throw new BadRequestException(
          `El lote ${rows[0].codigo_lote} venció el ${vence}: no se puede vender`,
        );
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

  /**
   * Carga (o, con `null`, limpia) el mínimo de un producto en una ubicación
   * (`docs/features/aviso-stock-bajo.md`). `origen` queda siempre en
   * `'manual'`: ningún camino de este endpoint puede declarar `'sistema'`.
   *
   * No toma locks: el mínimo no es saldo ni lo cuenta el borrado de una
   * ubicación, y si la ubicación o el ítem se borran justo después, las
   * lecturas del aviso ya los filtran.
   */
  async upsertMinimo(
    tenantId: string,
    itemId: string,
    ubicacionId: string,
    minimo: string | null,
  ): Promise<void> {
    // Las dos validaciones en una consulta. El ítem se exige con fila en
    // `item_producto` —la tienen `producto` e `ingrediente`, los dos tipos con
    // stock— y vivo: un mínimo sobre un ítem en la papelera no se puede cargar
    // ni limpiar.
    const [v]: { item_ok: boolean; ubicacion_ok: boolean }[] =
      await this.db.query(
        `SELECT
           EXISTS (
             SELECT 1
               FROM item_producto ip
               JOIN items i ON i.item_id = ip.item_id
              WHERE ip.item_id = $1 AND i.tenant_id = $3 AND i.eliminado_el IS NULL
           ) AS item_ok,
           EXISTS (
             SELECT 1
               FROM ubicaciones
              WHERE ubicacion_id = $2 AND tenant_id = $3 AND eliminado_el IS NULL
           ) AS ubicacion_ok`,
        [itemId, ubicacionId, tenantId],
      );
    if (!v?.item_ok) {
      throw new BadRequestException('El item no tiene control de stock');
    }
    // Mismo criterio y mensaje que `TrasladosService`: una ubicación de otro
    // tenant es indistinguible de una inexistente. Una bodega desactivada sí
    // acepta mínimo: no se evalúa mientras esté apagada, pero el número queda.
    if (!v.ubicacion_ok) {
      throw new NotFoundException('Ubicación no encontrada');
    }

    if (minimo === null) {
      await this.db.query(
        `UPDATE stock_minimo
            SET eliminado_el = NOW(), actualizado_el = NOW()
          WHERE item_id = $1 AND ubicacion_id = $2 AND eliminado_el IS NULL`,
        [itemId, ubicacionId],
      );
      return;
    }

    // Upsert que revive: limpiar y volver a cargar el mismo par encuentra la
    // fila apagada por su PK (docs/patterns/backend.md § 14b).
    await this.db.query(
      `INSERT INTO stock_minimo (item_id, ubicacion_id, minimo, origen, creado_el, actualizado_el)
       VALUES ($1, $2, $3, 'manual', NOW(), NOW())
       ON CONFLICT (item_id, ubicacion_id)
       DO UPDATE SET minimo = EXCLUDED.minimo, origen = 'manual',
                     eliminado_el = NULL, actualizado_el = NOW()`,
      [itemId, ubicacionId, minimo],
    );
  }

  /**
   * El listado del aviso de stock bajo: cada producto en cada ubicación activa
   * del tenant, con su mínimo si se cargó y la marca por fila
   * (`docs/features/aviso-stock-bajo.md`). Es la lista completa —el usuario
   * vino a buscarla—, a diferencia del bloque del inicio, que no crece.
   *
   * Lista también los pares SIN mínimo: esta pantalla es donde se carga, y un
   * mínimo nace vacío.
   *
   * Tres consultas fijas, ninguna por fila: `COUNT`, la página, y el origen
   * sugerido para el traslado en batch sobre los ítems de la página.
   */
  async findStockMinimo(
    tenantId: string,
    query: FindStockMinimoDto,
  ): Promise<PaginatedResponse<StockMinimoFila>> {
    const { page, pageSize, offset } = resolvePagination(query);
    const { from, params } = this.fromStockMinimo(tenantId, query);

    const [{ total }]: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total ${from}`,
      params,
    );
    const data = await this.filasStockMinimo(
      tenantId,
      from,
      params,
      pageSize,
      offset,
    );
    return { data, meta: buildPaginationMeta(page, pageSize, total) };
  }

  /**
   * Carga o limpia el mínimo y devuelve la fila del listado ya recalculada,
   * para que la pantalla la repinte sin volver a pedir la página ni derivar
   * `bajoMinimo` en el cliente. `null` si el par no se lista —una bodega
   * desactivada acepta el mínimo pero no se evalúa (spec § 9)—.
   */
  async setMinimo(
    tenantId: string,
    itemId: string,
    ubicacionId: string,
    minimo: string | null,
  ): Promise<StockMinimoFila | null> {
    await this.upsertMinimo(tenantId, itemId, ubicacionId, minimo);
    const { from, params } = this.fromStockMinimo(tenantId, {
      ubicacionId,
      itemId,
    });
    const [fila] = await this.filasStockMinimo(tenantId, from, params, 1, 0);
    return fila ?? null;
  }

  /**
   * El `FROM`/`WHERE` compartido por el `COUNT`, la página y la fila suelta.
   *
   * El JOIN a `item_producto` es el corte de "tiene stock" (producto e
   * ingrediente). Una ubicación desactivada no se lista (spec § 9): "acá ya no
   * repongo". `stock_minimo` y `stock_ubicacion` van por LEFT JOIN: sin fila de
   * mínimo el par se lista sin marca, y sin fila de saldo el stock es 0.
   */
  private fromStockMinimo(
    tenantId: string,
    filtro: FindStockMinimoDto & { itemId?: string },
  ): { from: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let filtros = '';
    if (filtro.itemId) {
      params.push(filtro.itemId);
      filtros += ` AND i.item_id = $${params.length}`;
    }
    if (filtro.ubicacionId) {
      params.push(filtro.ubicacionId);
      filtros += ` AND u.ubicacion_id = $${params.length}`;
    }
    if (filtro.search) {
      params.push(`%${filtro.search}%`);
      filtros += ` AND i.nombre ILIKE $${params.length}`;
    }
    if (filtro.soloBajoMinimo) {
      filtros += ` AND ${BAJO_MINIMO_SQL}`;
    }
    const from = `
      FROM items i
      JOIN item_producto ip ON ip.item_id = i.item_id
      JOIN ubicaciones u ON u.tenant_id = i.tenant_id
                        AND u.eliminado_el IS NULL AND u.activo = true
      LEFT JOIN stock_minimo sm ON sm.item_id = i.item_id
                               AND sm.ubicacion_id = u.ubicacion_id
                               AND sm.eliminado_el IS NULL
      LEFT JOIN stock_ubicacion su ON su.item_id = i.item_id
                                  AND su.ubicacion_id = u.ubicacion_id
      WHERE i.tenant_id = $1 AND i.eliminado_el IS NULL
        ${filtros}`;
    return { from, params };
  }

  private async filasStockMinimo(
    tenantId: string,
    from: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<StockMinimoFila[]> {
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const rows: StockMinimoRow[] = await this.db.query(
      `SELECT i.item_id, i.nombre AS item_nombre, ip.unidad_medida,
              u.ubicacion_id, u.nombre AS ubicacion_nombre,
              sm.minimo, sm.origen,
              COALESCE(su.stock, 0)::numeric(18,4) AS stock,
              ${BAJO_MINIMO_SQL} AS bajo_minimo,
              ${EN_CAMINO_SQL} AS en_camino
         ${from}
        ORDER BY bajo_minimo DESC, en_camino ASC, i.nombre ASC, u.nombre ASC,
                 i.item_id, u.ubicacion_id
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset],
    );

    const origenes = await this.origenesDeTraslado(
      tenantId,
      rows.filter((r) => r.bajo_minimo).map((r) => r.item_id),
    );

    return rows.map((r) => ({
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      ubicacionId: r.ubicacion_id,
      ubicacionNombre: r.ubicacion_nombre,
      unidadMedida: r.unidad_medida,
      minimo: r.minimo,
      origen: r.origen,
      stock: r.stock,
      bajoMinimo: r.bajo_minimo,
      enCamino: r.en_camino,
      origenSugerido: r.bajo_minimo
        ? this.mejorOrigen(origenes, r.item_id, r.ubicacion_id)
        : null,
    }));
  }

  /**
   * El bloque del inicio: cuántos pares están bajo el mínimo y las 4
   * ubicaciones con más, nunca la lista (`docs/features/aviso-stock-bajo.md`).
   * La propiedad es que no crezca: 40 productos abajo ocupan lo mismo que 6.
   *
   * No cuenta lo que ya está en camino (una compra en borrador): "baja de
   * urgencia o sale del bloque" se implementa como salir (spec § 2).
   *
   * Una sola consulta, fija: agrupa por ubicación y saca el total con una
   * ventana sobre TODOS los grupos, que se evalúa antes del `LIMIT` — así el
   * total sigue contando las ubicaciones que no se detallan.
   */
  async resumenStockBajo(tenantId: string): Promise<StockBajoResumen> {
    const rows: {
      ubicacion_id: string;
      ubicacion_nombre: string;
      cantidad: number;
      total: number;
    }[] = await this.db.query(
      `SELECT u.ubicacion_id, u.nombre AS ubicacion_nombre,
              COUNT(*)::int AS cantidad,
              (SUM(COUNT(*)) OVER ())::int AS total
         FROM stock_minimo sm
         JOIN items i ON i.item_id = sm.item_id
                     AND i.tenant_id = $1 AND i.eliminado_el IS NULL
         JOIN ubicaciones u ON u.ubicacion_id = sm.ubicacion_id
                           AND u.tenant_id = $1 AND u.eliminado_el IS NULL
                           AND u.activo = true
         LEFT JOIN stock_ubicacion su ON su.item_id = sm.item_id
                                     AND su.ubicacion_id = sm.ubicacion_id
        WHERE sm.eliminado_el IS NULL
          AND ${BAJO_MINIMO_SQL}
          AND NOT ${EN_CAMINO_SQL}
        GROUP BY u.ubicacion_id, u.nombre
        ORDER BY cantidad DESC, u.nombre ASC, u.ubicacion_id
        LIMIT 4`,
      [tenantId],
    );
    return {
      total: rows[0]?.total ?? 0,
      porUbicacion: rows.map((r) => ({
        ubicacionId: r.ubicacion_id,
        ubicacionNombre: r.ubicacion_nombre,
        cantidad: r.cantidad,
      })),
    };
  }

  /**
   * Para cada ítem, las ubicaciones del tenant donde tiene stock: de ahí sale
   * el origen del traslado precargado. Una consulta para toda la página.
   *
   * Sin `u.activo = true`, a propósito: una bodega desactivada sigue sirviendo
   * de ORIGEN de traslado (`docs/features/bodegas-y-traslados.md`, la asimetría
   * de `TrasladosService`); lo que deja de hacer es ser evaluada como destino.
   */
  private async origenesDeTraslado(
    tenantId: string,
    itemIds: string[],
  ): Promise<OrigenRow[]> {
    if (!itemIds.length) return [];
    return this.db.query(
      `SELECT su.item_id, su.ubicacion_id, u.nombre AS ubicacion_nombre, su.stock
         FROM stock_ubicacion su
         JOIN ubicaciones u ON u.ubicacion_id = su.ubicacion_id
                           AND u.tenant_id = $1 AND u.eliminado_el IS NULL
        WHERE su.item_id = ANY($2::uuid[]) AND su.stock > 0`,
      [tenantId, itemIds],
    );
  }

  /** La otra ubicación con más stock del ítem; desempata por nombre. */
  private mejorOrigen(
    origenes: OrigenRow[],
    itemId: string,
    destinoId: string,
  ): StockMinimoFila['origenSugerido'] {
    const candidatos = origenes
      .filter((o) => o.item_id === itemId && o.ubicacion_id !== destinoId)
      .sort(
        (a, b) =>
          new Decimal(b.stock).comparedTo(a.stock) ||
          a.ubicacion_nombre.localeCompare(b.ubicacion_nombre),
      );
    const o = candidatos[0];
    return o
      ? {
          ubicacionId: o.ubicacion_id,
          ubicacionNombre: o.ubicacion_nombre,
          stock: o.stock,
        }
      : null;
  }

  async findMovimientos(
    tenantId: string,
    query: FindMovimientosDto,
  ): Promise<PaginatedResponse<MovimientoListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    // El día del negocio solo se consulta si hay filtro de fecha: sin bordes
    // que expandir es una query de más en el listado más caliente del módulo.
    const dia = requiereDiaNegocio(query.desde, query.hasta)
      ? await diaNegocioTenant(this.db, tenantId)
      : null;
    const { filters, params } = this.buildMovimientosFilters(
      tenantId,
      query,
      dia,
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
         mv.motivo_baja_id, mv.motivo_diferencia_id,
         mb.nombre AS motivo_baja_nombre,
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
       LEFT JOIN motivo_baja mb ON mb.motivo_baja_id = mv.motivo_baja_id AND mb.eliminado_el IS NULL
       -- Sin ub.eliminado_el IS NULL, a propósito e igual que el JOIN de items
       -- arriba: un movimiento ya escrito en el kardex tiene que seguir diciendo
       -- en qué ubicación pasó aunque esa bodega se haya borrado después (es lo
       -- que se hace tras vaciarla). Filtrarlo no ocultaría la fila del kardex,
       -- solo le quitaría el nombre de la ubicación sin decir que lo oculta.
       LEFT JOIN ubicaciones ub ON ub.ubicacion_id = mv.ubicacion_id
       WHERE mv.tenant_id = $1 AND mv.eliminado_el IS NULL
         ${filters}
       -- El desempate por secuencia no es cosmético: una sola transacción
       -- escribe VARIAS filas acá —bajar una cantidad de compra deja la salida
       -- del stock y, aparte, su correccion_compra— y creado_el es la hora en
       -- que esa transacción EMPEZÓ, igual al microsegundo en todas. Sin
       -- desempate, cuál queda arriba lo elige el plan de Postgres y puede
       -- cambiar entre dos cargas de la misma pantalla. secuencia es el orden
       -- de aplicación (docs/features/compras.md), el mismo por el que recorre
       -- el kardex "rehacer la cuenta".
       ORDER BY mv.creado_el DESC, mv.secuencia DESC
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
    dia: DiaNegocio | null,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let filters = '';

    // La zona y el corte ocupan una posición fija apenas hay algún borde de
    // fecha: los dos bordes la comparten.
    const idxDia = dia ? empujarDiaNegocio(params, dia) : null;

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
        idxDia,
      );
    }
    if (query.hasta) {
      params.push(query.hasta);
      filters += bordeHastaSql(
        'mv.creado_el',
        query.hasta,
        params.length,
        idxDia,
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
      motivoBajaId: r.motivo_baja_id,
      motivoBajaNombre: r.motivo_baja_nombre,
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
  motivoBajaId: string | null;
  motivoBajaNombre: string | null;
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
  motivo_baja_id: string | null;
  motivo_baja_nombre: string | null;
  motivo_diferencia_id: string | null;
  unidad_medida: string | null;
  moneda_id: string;
  item_eliminado: boolean;
  ubicacion_id: string;
  ubicacion_nombre: string | null;
}

/** Una fila del listado del aviso de stock bajo: un producto en una ubicación. */
export interface StockMinimoFila {
  itemId: string;
  itemNombre: string;
  ubicacionId: string;
  ubicacionNombre: string;
  unidadMedida: string;
  /** `null` = nunca se cargó mínimo para este par: no hay aviso posible. */
  minimo: string | null;
  origen: OrigenStockMinimo | null;
  /** Saldo en esta ubicación; 0 si el producto nunca se movió acá. */
  stock: string;
  bajoMinimo: boolean;
  /** Hay una compra en borrador con este producto para esta ubicación. */
  enCamino: boolean;
  /**
   * Dónde hay stock para cubrirlo con un traslado: la otra ubicación con más
   * saldo. Solo en las filas bajo el mínimo; `null` si no hay stock en ningún
   * otro lado.
   */
  origenSugerido: {
    ubicacionId: string;
    ubicacionNombre: string;
    stock: string;
  } | null;
}

/** El bloque del inicio: un número y hasta 4 ubicaciones, nunca la lista. */
export interface StockBajoResumen {
  /** Todos los pares bajo el mínimo del tenant, no solo los de las 4 filas. */
  total: number;
  porUbicacion: {
    ubicacionId: string;
    ubicacionNombre: string;
    cantidad: number;
  }[];
}

interface StockMinimoRow {
  item_id: string;
  item_nombre: string;
  unidad_medida: string;
  ubicacion_id: string;
  ubicacion_nombre: string;
  minimo: string | null;
  origen: OrigenStockMinimo | null;
  stock: string;
  bajo_minimo: boolean;
  en_camino: boolean;
}

interface OrigenRow {
  item_id: string;
  ubicacion_id: string;
  ubicacion_nombre: string;
  stock: string;
}
