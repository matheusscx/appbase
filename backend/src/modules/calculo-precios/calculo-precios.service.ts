import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ItemsService } from '../items/items.service';
import { ImpuestosService } from '../impuestos/impuestos.service';
import { DescuentosService } from '../descuentos/descuentos.service';
import { RecargosService } from '../recargos/recargos.service';
import { TenantsService } from '../tenants/tenants.service';
import { MonedasService } from '../monedas/monedas.service';
import { Db } from '../../common/db/db.service';
import { fechaLocalTenant } from '../../common/utils/rango-fecha.util';
import { CalcularVentaDto, LineaDto } from './dto/calcular.dto';
import {
  calcularVenta,
  modoToRounding,
  type AdvertenciaPrecio,
  type ConfigCalculo,
  type ImpuestoResuelto,
  type ModoRedondeo,
  type LineaResuelta,
  type ReglaResuelta,
  type ResultadoVenta,
} from './calculo-precios.engine';

/**
 * Decimales con los que el libro mayor de ventas guarda plata: `precio_unitario`,
 * `subtotal`, `descuento_aplicado`, `total_linea` y los totales de la cabecera son
 * todos `NUMERIC(18,4)`.
 *
 * **No es `escalaCalculo`**, y la distinción es la que decide el redondeo de la
 * conversión — el porqué está en `convertirAMonedaOficial`. (Tampoco es universal
 * en el esquema: `tenants.monto_tolerancia` y los montos de la pasarela son
 * `NUMERIC(18,6)`. La afirmación acotada al libro de ventas es la que se sostiene.)
 */
const ESCALA_PERSISTIDA = 4;

type ItemsBaseMap = Awaited<ReturnType<ItemsService['cargarBasePorIds']>>;
type ItemsReglasMap = Awaited<ReturnType<ItemsService['cargarReglasPorIds']>>;

/**
 * Capa de servicio del motor: carga los datos del tenant (ítems, catálogos de
 * reglas y preferencias financieras) y delega el cálculo en el motor puro
 * (`calculo-precios.engine.ts`). No persiste nada — ventas lo consumirá.
 */
@Injectable()
export class CalculoPreciosService {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly impuestosService: ImpuestosService,
    private readonly descuentosService: DescuentosService,
    private readonly recargosService: RecargosService,
    private readonly tenantsService: TenantsService,
    private readonly monedasService: MonedasService,
    private readonly db: Db,
  ) {}

  /**
   * Las preferencias financieras del tenant, en la forma que consume el motor.
   *
   * Pública porque ventas la necesita **antes** de llamar a `calcular`: convierte
   * los precios a moneda oficial por su cuenta y ese paso también redondea con
   * `modo_redondeo`. Pasando después el mismo objeto por `configPrecargada`, la
   * venta no paga las consultas dos veces — son las mismas dos de siempre, movidas
   * un poco más arriba.
   */
  async cargarConfig(
    tenantId: string,
    decimalesMoneda: number,
  ): Promise<ConfigCalculo> {
    const prefs =
      await this.tenantsService.getPreferenciasFinancieras(tenantId);
    return {
      formula: prefs.formula,
      calculoDescuentos: prefs.calculoDescuentos,
      calculoRecargos: prefs.calculoRecargos,
      escalaCalculo: prefs.escalaCalculo,
      modoRedondeo: prefs.modoRedondeo,
      nivelRedondeo: prefs.nivelRedondeo,
      decimalesMoneda,
    };
  }

  /**
   * @param configPrecargada Tiene que ser la del **mismo `tenantId`**. No se
   * valida —`ConfigCalculo` ni siquiera lleva el tenant, y agregárselo para poder
   * chequear un caso que ningún llamador puede producir hoy sería cambiar un tipo
   * del motor por una defensa hipotética—. Se anota porque la consecuencia es
   * silenciosa: una config ajena calcularía sin error y quedaría **congelada** en
   * `ventas.config_calculo`, que es el registro con el que después se audita esa
   * venta.
   */
  async calcular(
    tenantId: string,
    dto: CalcularVentaDto,
    configPrecargada?: ConfigCalculo,
  ): Promise<ResultadoVenta> {
    // Sin `configPrecargada` (la previsualización), acá es donde se resuelve
    // la escala de la moneda oficial: una consulta más, no una por línea.
    const config =
      configPrecargada ??
      (await this.cargarConfig(
        tenantId,
        await this.monedasService.decimalesOficiales(tenantId),
      ));

    // El día del local para el instante que decide: la apertura de la cuenta
    // si la venta nace de una, y si no, ahora.
    const fechaLocal = await fechaLocalTenant(
      this.db,
      tenantId,
      await this.instanteDeVigencia(tenantId, dto.cuentaId),
    );

    // Catálogos del tenant cargados una vez e indexados por id.
    /**
     * **Secuencial a propósito, y no es una desoptimización en el camino que
     * importa.** `calcular()` corre dentro de `crearEnTransaccion` →
     * `db.transaccion(...)` en toda venta real (`ventas.service.ts`), y ahí las
     * tres ramas resuelven contra el `EntityManager` del contexto ALS: **un
     * único `pg.Client`**. Un `Promise.all` las dispara concurrentes sobre ese
     * cliente y node-postgres las encola igual; en `pg@9` la segunda **tira**.
     *
     * ⚠️ **Las tres, no una.** `descuentos` y `recargos` consultan por
     * `@InjectRepository`, que acá NO es el repo del pool: `RepositoriosModule`
     * (ADR-020) inyecta un **Proxy** que en cada acceso resuelve
     * `TxContext.managerActivo()` y usa el manager de la transacción si hay una
     * viva. El ADR lo dice con todas las letras, *"motor de precios incluido"*.
     * Buscar `this.db.query` literal no alcanza para saber quién toca el cliente
     * compartido — el proxy no aparece en ese grep.
     *
     * **El costo, declarado:** hay un camino sin transacción —la previsualización
     * de `POST /calculo-precios/calcular`, que no la envuelve—, y ahí estas tres
     * sí corrían en paralelo real sobre conexiones distintas del pool. Ese camino
     * pierde ese paralelismo. Se acepta: son tres consultas, y la previsualización
     * no es el camino caliente; el de la venta sí, y ahí no había paralelismo que
     * perder.
     */
    const impuestos = await this.impuestosService.findAll(tenantId);
    const descuentos = await this.descuentosService.findAll(tenantId);
    const recargos = await this.recargosService.findAll(tenantId);
    const impuestoMap = new Map<string, ImpuestoResuelto & { tipo: string }>(
      impuestos.map((i) => [
        i.id,
        {
          id: i.id,
          nombre: i.nombre,
          porcentaje: i.porcentaje,
          tipo: i.tipo,
          activo: i.activo,
        },
      ]),
    );
    // El IVA del país del tenant. Hay a lo sumo uno visible: `impuestos.tipo`
    // tiene default 'otro' y no está expuesto en CreateImpuestoDto ni en
    // UpdateImpuestoDto, así que un tenant no puede crear otra fila 'iva'.
    // Se busca una vez por cálculo, no por línea. Se toma de `impuestoMap` (no
    // de `impuestos` directo) para que la fila que termina en la traza de la
    // línea tenga la misma forma recortada que los demás impuestos de la
    // lista ({id, nombre, porcentaje, tipo}), no la entidad completa
    // (tenantId, paisId, creadoEl…). Ver ADR-018.
    const ivaDelPais = (() => {
      const iva = [...impuestoMap.values()].find((i) => i.tipo === 'iva');
      // ⚠️ El IVA NO se pausa: lo gobierna la clasificación tributaria del ítem
      // —afecto o exento—, nunca el interruptor `activo` (ADR-018). Se fuerza
      // `activo: true` para que una fila mal sembrada, o tocada por SQL directo,
      // no deje de cobrar IVA en silencio. Eso sería un problema fiscal, no un
      // descuento mal aplicado. Un tenant tampoco puede llegar acá: la fila del
      // IVA es del país (`tenant_id` nulo) y su PATCH devuelve 404.
      return iva ? { ...iva, activo: true } : null;
    })();
    const descuentoMap = this.indexarReglas(descuentos, fechaLocal);
    const recargoMap = this.indexarReglas(recargos, fechaLocal);

    const tasaMap = new Map(
      (await this.monedasService.findMonedas(tenantId)).map((m) => [
        m.monedaId,
        m.valorDelDia ?? '1',
      ]),
    );

    // Ítems del carrito en 2 queries fijas, no 4+ por línea: `cargarBasePorIds`
    // valida pertenencia al tenant (lanza 404 igual que `findOne`) y
    // `cargarReglasPorIds` trae las tres listas de reglas que el motor necesita.
    // Antes cada línea llamaba a `findOne`, que además construía ingredientes,
    // componentes y grupos para descartarlos acá.
    // La cantidad se valida ANTES de cargar: si no, el 404 por ítem inexistente
    // le ganaría al 400 por cantidad inválida de la MISMA línea, al revés que
    // el camino por línea. (Entre líneas distintas el orden tampoco es el de
    // antes: ahora todos los 400 preceden a todos los 404, sin importar la
    // posición. Los dos son 4xx de cliente.)
    for (const l of dto.lineas) {
      if (new Decimal(l.cantidad).lessThanOrEqualTo(0)) {
        throw new BadRequestException('La cantidad debe ser mayor a 0');
      }
    }

    // El IVA no entra por payload, mismo contrato que POST/PATCH /items. El
    // strip de `resolverLinea` es defensa contra `item_impuestos` viejo, no
    // contrato de la API: si el cliente lo manda explícito, se le dice.
    for (const l of dto.lineas) {
      if (l.impuestoIds?.some((id) => impuestoMap.get(id)?.tipo === 'iva')) {
        throw new BadRequestException(
          'El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria',
        );
      }
    }

    const itemIds = dto.lineas.map((l) => l.itemId);
    /**
     * **Secuencial a propósito, y no es una desoptimización.** Los dos loaders
     * consultan con `this.db.query`, y `calcular()` corre dentro de
     * `crearEnTransaccion` → `db.transaccion(...)`, así que los dos resuelven
     * contra el `EntityManager` del contexto ALS: **un único `pg.Client`**. Un
     * `Promise.all` los dispara concurrentes sobre ese cliente y node-postgres
     * los encola igual; en `pg@9` la segunda tira en vez de esperar.
     *
     * En el camino de la venta el `await` secuencial no cambia el orden real de
     * ejecución —ya era serie— ni ningún resultado: cambia la vía por la que
     * corre en serie, de una anunciada como removida a una soportada. En la
     * previsualización, que corre fuera de transacción, sí saca paralelismo
     * real: dos consultas, costo aceptado (ver el bloque de arriba).
     *
     * ⚠️ **El `DeprecationWarning` que el backlog citaba como evidencia no era
     * de acá** (medido 2026-08-21 con `--trace-deprecation`): sale del
     * `Promise.all` interno de TypeORM en `DataSource.synchronize`, al arrancar
     * cada app de test. Node emite cada deprecación **una vez por proceso**, así
     * que ese warning tapa cualquier otro y no sirve para observar este caso. El
     * mecanismo sí se verificó, pero por el código: `Db.query` → `managerActivo`.
     *
     * Los dos siguen siendo loaders BATCH —una consulta por llamada, no una por
     * línea—, que es lo que este par vino a resolver.
     */
    const itemsBase = await this.itemsService.cargarBasePorIds(
      tenantId,
      itemIds,
    );
    const reglasPorItem = await this.itemsService.cargarReglasPorIds(
      tenantId,
      itemIds,
    );

    const lineas: LineaResuelta[] = dto.lineas.map((linea) =>
      this.resolverLinea(
        linea,
        itemsBase,
        reglasPorItem,
        impuestoMap,
        ivaDelPais,
        descuentoMap,
        recargoMap,
        tasaMap,
        config.modoRedondeo,
      ),
    );

    const resultado = calcularVenta({
      lineas,
      metodoPagoId: dto.metodoPagoId ?? null,
      descuentosVenta: this.resolverReglas(
        dto.descuentosVentaIds ?? [],
        descuentoMap,
        'descuento',
      ),
      recargosVenta: this.resolverReglas(
        dto.recargosVentaIds ?? [],
        recargoMap,
        'recargo',
      ),
      config,
    });

    this.advertirItemsPausados(dto, itemsBase, resultado);

    return resultado;
  }

  /**
   * El instante que decide la vigencia: la apertura de la cuenta si hay una, y
   * si no, ahora.
   *
   * Un `cuentaId` que no resuelve —inexistente, o de otro tenant— es 400 y no
   * un silencioso "entonces ahora": el descarte mudo esconde el error justo
   * donde cambia la plata.
   */
  private async instanteDeVigencia(
    tenantId: string,
    cuentaId?: string,
  ): Promise<Date> {
    if (!cuentaId) return new Date();
    const filas: { abierta_el: Date }[] = await this.db.query(
      `SELECT abierta_el FROM cuentas
        WHERE cuenta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [cuentaId, tenantId],
    );
    if (!filas[0]) throw new BadRequestException('La cuenta no existe');
    return filas[0].abierta_el;
  }

  /**
   * Un ítem pausado (`activo = false`) SÍ se cobra en el POS —el producto puede
   * estar ya en la mano del cliente— pero el cajero se entera. La tienda online,
   * donde todavía no pasó nada, lo rechaza antes de llegar acá
   * (`OnlineService.prepararLineasCheckout`); salones ya rechaza agregar líneas
   * nuevas. Por eso el filtro no vive en `cargarBasePorIds`, que comparten los
   * tres canales.
   *
   * Va en el servicio y NO en el motor a propósito: el motor calcula plata, y un
   * ítem pausado no cambia ningún monto. El detalle dice "ya no se ofrece", no
   * "no se aplicó": lo segundo sería mentira, la línea se cobra igual.
   *
   * `resultado.lineas` es 1:1 con `dto.lineas` y en el mismo orden, así que el
   * índice sirve para las dos. La advertencia se empuja a las DOS listas que el
   * motor mantiene —la de la línea y la agregada de la venta— porque
   * `resultado.advertencias` se armó por copia antes de este paso: escribir solo
   * en la línea la dejaría fuera de los toasts del POS (`ventas.service.ts` las
   * aplana desde ahí). `advertenciasVenta` no se toca: es solo para las reglas a
   * nivel venta, que no pertenecen a ninguna línea.
   */
  private advertirItemsPausados(
    dto: CalcularVentaDto,
    itemsBase: ItemsBaseMap,
    resultado: ResultadoVenta,
  ): void {
    // El mismo ítem en varias líneas —receta personalizada dos veces, salones—
    // daba un toast por línea. Decisión del owner (2026-08-11): uno por regla.
    // La deduplicación va acá y no alcanza con la del motor (`sinRepetidas`),
    // porque esta advertencia se empuja DESPUÉS de que el motor devolvió.
    // Se deduplica por `itemId` y no por el texto: dos ítems distintos pueden
    // llamarse igual, y acá el id está a mano.
    //
    // ⚠️ En minúsculas. `@IsUUID('4')` acepta el UUID en mayúsculas y la BD lo
    // devuelve en minúsculas, así que un carrito puede traer el MISMO ítem con
    // dos casings —por eso existe `aliasarCasingDeIds` en `items.service.ts`—.
    // Con la clave cruda, esas dos líneas se veían como ítems distintos y el
    // aviso salía dos veces: justo el bug que esto viene a cerrar.
    const yaAvisados = new Set<string>();
    dto.lineas.forEach((linea, i) => {
      const item = itemsBase.get(linea.itemId)!;
      if (item.activo) return;
      const advertencia: AdvertenciaPrecio = {
        titulo: `Producto "${item.nombre}"`,
        detalle: 'está en pausa y ya no se ofrece en el catálogo',
      };
      // La de la línea va siempre: es la que marca CUÁL línea está afectada.
      resultado.lineas[i].advertencias.push(advertencia);
      const clave = linea.itemId.toLowerCase();
      if (yaAvisados.has(clave)) return;
      yaAvisados.add(clave);
      resultado.advertencias.push(advertencia);
    });
  }

  private indexarReglas(
    reglas: {
      id: string;
      nombre: string;
      modo: string;
      valorMonto: string | null;
      valorPorcentaje: string | null;
      tipoRegla: { codigo: string } | null;
      tramos: {
        minimo: string | null;
        valorMonto: string | null;
        valorPorcentaje: string | null;
      }[];
      metodoPagoIds: string[];
      activo: boolean;
      fechaInicio: string | null;
      fechaFin: string | null;
    }[],
    fechaLocal: string,
  ): Map<string, ReglaResuelta> {
    return new Map(
      reglas.map((r) => [
        r.id,
        {
          id: r.id,
          nombre: r.nombre,
          codigo: r.tipoRegla?.codigo ?? null,
          modo: r.modo as ReglaResuelta['modo'],
          valorMonto: r.valorMonto,
          valorPorcentaje: r.valorPorcentaje,
          // El `?? '0'` del `minimo` queda: un tramo sin mínimo arranca en cero
          // y eso es un dato, no una ambigüedad. Los importes NO llevan default:
          // poner `'0'` en las dos columnas volvería a inventar el dato que
          // este cambio vino a desambiguar. El default lo aplica el motor,
          // DESPUÉS de elegir la columna.
          tramos: r.tramos.map((t) => ({
            minimo: t.minimo ?? '0',
            valorMonto: t.valorMonto,
            valorPorcentaje: t.valorPorcentaje,
          })),
          metodoPagoIds: r.metodoPagoIds,
          // El mapa conserva las reglas pausadas a propósito: sacarlas de acá
          // haría que `requerir()` tirara 400 por id ausente en cada ítem que
          // la tenga asociada, y el POS dejaría de vender. El descarte pasa al
          // aplicarlas, en el motor.
          activo: r.activo,
          // Fuera de rango no se aplica. Comparación de strings: las fechas
          // ISO ordenan lexicográficamente igual que cronológicamente, así que
          // es exacta y no necesita librería. Bordes INCLUSIVOS los dos, mismo
          // criterio que los filtros de fecha (2026-08-22).
          vigente:
            (!r.fechaInicio || r.fechaInicio <= fechaLocal) &&
            (!r.fechaFin || fechaLocal <= r.fechaFin),
        },
      ]),
    );
  }

  private resolverLinea(
    linea: LineaDto,
    itemsBase: ItemsBaseMap,
    reglasPorItem: ItemsReglasMap,
    impuestoMap: Map<string, ImpuestoResuelto & { tipo: string }>,
    ivaDelPais: (ImpuestoResuelto & { tipo: string }) | null,
    descuentoMap: Map<string, ReglaResuelta>,
    recargoMap: Map<string, ReglaResuelta>,
    tasaMap: Map<string, string>,
    modoRedondeo: ModoRedondeo,
  ): LineaResuelta {
    // La cantidad ya se validó en `calcular()`, antes de cargar nada.
    // `cargarBasePorIds` ya validó pertenencia al tenant (404 si falta), así
    // que acá el ítem existe sí o sí.
    const item = itemsBase.get(linea.itemId)!;
    const reglas = reglasPorItem.get(linea.itemId);

    const impuestoIds = linea.impuestoIds ?? reglas?.impuestosIds ?? [];
    const descuentoIds = linea.descuentoIds ?? reglas?.descuentosIds ?? [];
    const recargoIds = linea.recargoIds ?? reglas?.recargosIds ?? [];

    const precioUnitario =
      linea.precioUnitario !== undefined
        ? linea.precioUnitario
        : this.convertirAMonedaOficial(
            item.precioBase,
            item.monedaId,
            tasaMap,
            modoRedondeo,
          );

    // El IVA de una línea lo decide la clasificación tributaria, NUNCA la lista
    // de impuestos: se saca cualquier 'iva' que venga —del ítem o pisado por la
    // línea— y se agrega el del país solo si es afecto. El mismo código cubre
    // las dos direcciones y no puede duplicar. Los 'otro' aplican siempre, en
    // afectos y exentos (DL 825 / IndExe del DTE).
    //
    // ⚠️ La condición es POSITIVA a propósito. `clasificacion_tributaria` es
    // nullable (los ingredientes no tienen tratamiento fiscal): un `!== 'exento'`
    // dejaría pasar el null y le cobraría IVA a un ingrediente.
    const impuestosLinea = impuestoIds
      .map((id) => this.requerir(impuestoMap, id, 'impuesto'))
      .filter((imp) => imp.tipo !== 'iva');

    if (item.clasificacionTributaria === 'afecto') {
      if (!ivaDelPais) {
        throw new BadRequestException(
          `El ítem "${item.nombre}" es afecto a IVA, pero el país del tenant no tiene un impuesto tipo 'iva' configurado`,
        );
      }
      impuestosLinea.push(ivaDelPais);
    }

    return {
      itemId: item.id,
      cantidad: linea.cantidad,
      precioUnitario,
      precioIncluyeImpuesto: item.precioIncluyeImpuesto,
      clasificacionTributaria: item.clasificacionTributaria,
      impuestos: impuestosLinea,
      descuentos: this.resolverReglas(descuentoIds, descuentoMap, 'descuento'),
      recargos: this.resolverReglas(recargoIds, recargoMap, 'recargo'),
    };
  }

  private resolverReglas(
    ids: string[],
    mapa: Map<string, ReglaResuelta>,
    label: string,
  ): ReglaResuelta[] {
    return ids.map((id) => this.requerir(mapa, id, label));
  }

  /**
   * Convierte un precio de la moneda del ítem a la moneda oficial del tenant
   * (`valor_del_dia`). **Único** lugar donde se hace esta cuenta: ventas la llama
   * para el precio que persiste y este service para el que previsualiza. Estuvo
   * duplicada hasta el 2026-08-11 y las dos copias derivaron —una arreglada y la
   * otra no deja el precio mostrado y el guardado con criterios distintos—, así
   * que vive acá y se comparte.
   *
   * Es el único lugar del backend donde se hace la cuenta `precio × tasa` (medido
   * el 2026-08-11: un solo `.times(tasa)` en todo `backend/src`). **No** es el
   * único redondeo de plata fuera del motor —el CPP de inventario, el costo
   * propuesto de una receta y el reparto de propinas también redondean, y todos
   * siguen en HALF_UP fijo; están anotados en `docs/agent/pendientes.md`—. Las dos
   * decisiones que gobiernan esta parecen descuidos y solo una lo era:
   *
   * **La escala (4) es correcta, no un `escalaCalculo` olvidado.** El esquema
   * define `escala_calculo` (0-12, hoy 6) como "decimales para cálculos
   * intermedios": el borrador con el que el motor arrastra descuentos, recargos e
   * impuestos sin acumular error. Este valor no es un intermedio — se persiste en
   * `venta_detalles.precio_unitario`, `NUMERIC(18,4)`. Redondear a `escalaCalculo`
   * no evitaría el recorte: lo movería al `INSERT`, donde lo hace Postgres con su
   * propia regla, fuera de la config del tenant y sin que ningún test lo vea.
   *
   * **El modo sí sale de la config** (decisión del owner, 2026-08-11). Antes era
   * un `.toFixed(4)`, que redondea con el default de Decimal.js —HALF_UP— pase lo
   * que pase. Un tenant con `modo_redondeo = 'FLOOR'` eligió no redondear nunca
   * hacia arriba, y esto se lo desobedecía: 18992.96788… daba `18992.9679` en vez
   * de `18992.9678`.
   */
  convertirAMonedaOficial(
    precio: string,
    monedaId: string,
    tasaMap: Map<string, string>,
    modoRedondeo: ModoRedondeo,
  ): string {
    const tasa = new Decimal(tasaMap.get(monedaId) ?? '1');
    return new Decimal(precio)
      .times(tasa)
      .toDecimalPlaces(ESCALA_PERSISTIDA, modoToRounding(modoRedondeo))
      .toFixed(ESCALA_PERSISTIDA);
  }

  private requerir<T>(mapa: Map<string, T>, id: string, label: string): T {
    const v = mapa.get(id);
    if (!v) {
      throw new BadRequestException(`${label} ${id} no encontrado`);
    }
    return v;
  }
}
