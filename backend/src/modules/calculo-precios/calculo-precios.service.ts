import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ItemsService } from '../items/items.service';
import { ImpuestosService } from '../impuestos/impuestos.service';
import { DescuentosService } from '../descuentos/descuentos.service';
import { RecargosService } from '../recargos/recargos.service';
import { TenantsService } from '../tenants/tenants.service';
import { MonedasService } from '../monedas/monedas.service';
import { PromocionesService } from '../promociones/promociones.service';
import {
  evaluarPromos,
  type AplicacionPromo,
  type InstanteLocal,
  type LineaPromo,
} from '../promociones/promociones.evaluator';
import { Db } from '../../common/db/db.service';
import {
  fechaLocalTenant,
  instanteLocalEnZona,
  zonaHorariaTenant,
} from '../../common/utils/rango-fecha.util';
import { NivelRegla } from '../../common/enums/reglas.enums';
import type { ReglasCongeladas } from '../../common/dto/reglas-congeladas.dto';
import {
  CalcularVentaDto,
  CalcularVentaInput,
  LineaCalculo,
} from './dto/calcular.dto';
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

/**
 * Una regla del catálogo con el dato que el motor **no** necesita: dónde se
 * puede usar. Se agrega acá y no en `ReglaResuelta` para que el contrato del
 * motor siga diciendo solo lo que el motor lee — el nivel se consume entero en
 * este service, en `resolverReglas`.
 */
type ReglaResueltaConNivel = ReglaResuelta & { nivel: NivelRegla };

type ItemsBaseMap = Awaited<ReturnType<ItemsService['cargarBasePorIds']>>;
type ItemsReglasMap = Awaited<ReturnType<ItemsService['cargarReglasPorIds']>>;

/**
 * **"Sacar no cobra, agregar sí"** — el criterio único del proyecto, y desde el
 * 2026-08-30 su **única** implementación: una línea que solo omite ingredientes o
 * deja un comentario no puede mover el precio, así que no se resuelve y no cuesta
 * ni una consulta. Vivía duplicado en los dos clientes
 * (`personalizacionAfectaPrecio` en el POS, `tienePersonalizacionConRecargo` en
 * salones); los dos se borraron.
 *
 * ⚠️ Saltarse el resolver también se saltea sus **validaciones** (omitido que no
 * pertenece a la receta, grupo obligatorio sin elegir). Es la misma conducta que
 * tenía la previsualización antes de que el motor tasara la personalización —no
 * resolvía nada— y el cobro sigue validando todo: una previsualización más
 * permisiva que la venta es tolerable; una más estricta rompería el carrito sin
 * decir por qué.
 */
function puedeCostar(linea: LineaCalculo): boolean {
  const p = linea.personalizacion;
  if (!p) return false;
  return (
    (p.extras?.length ?? 0) > 0 ||
    (p.grupos?.length ?? 0) > 0 ||
    (p.componentes?.length ?? 0) > 0
  );
}

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
    private readonly promocionesService: PromocionesService,
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
      promosAcumulanDescuentos: prefs.promosAcumulanDescuentos,
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
    dto: CalcularVentaInput,
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

    /**
     * El precio de cada línea, decidido **en el servidor**. Tres orígenes, en
     * este orden:
     *
     * 1. `precioUnitarioResuelto` — lo pone `ventas.service`, que ya resolvió la
     *    personalización (para el snapshot y el stock) y ya convirtió con este
     *    mismo `modo_redondeo`. No es parte del DTO HTTP.
     * 2. `precioBase + precioExtraTotal`, convertido acá — la previsualización de
     *    una línea personalizada. Es el camino que antes cubría un
     *    `precioUnitario` del cliente, que llegaba **sin convertir**.
     * 3. `undefined` — el resto. `resolverLinea` convierte `item.precioBase`.
     *
     * **Secuencial a propósito**, por el mismo motivo que los dos loaders de
     * arriba: en el camino de la venta esto corre dentro de `db.transaccion` y
     * los resolvers pegan al `EntityManager` del contexto ALS, o sea un único
     * `pg.Client`. Un `Promise.all` los encolaría igual y en `pg@9` la segunda
     * tira.
     *
     * **Y secuencial no significa una consulta por línea:** los catálogos que
     * los resolvers necesitan son por ÍTEM —`(tenantId, itemId)`, nada de la
     * línea—, así que se precargan por lote acá abajo y el loop no toca la base.
     * Lo que queda por línea es cuenta en memoria.
     *
     * ⚠️ La personalización sobre un ítem que no es receta ni combo se **ignora**,
     * que es exactamente lo que hace `ventas.service.ts` al armar sus
     * personalizaciones. La previsualización tiene que coincidir con el cobro,
     * no ser más estricta que él: `salones.service.agregarLinea` sí la rechaza,
     * pero eso pasa mucho antes, al agregar la línea a la cuenta.
     */
    // Los catálogos que necesita resolver una personalización son **por ítem, no
    // por línea** —las tres consultas toman `(tenantId, itemId)` y nada de la
    // línea—, así que se precargan por lote una vez y no una vez por línea. Sin
    // esto, una precuenta de 5 líneas con extras costaba ~18 consultas; con esto,
    // entre 2 y 5 según qué haya en el carrito —son techos, no valores fijos: el
    // catálogo de grupos corta temprano si nadie tiene—, y **no crecen con las
    // líneas**.
    // En el camino de la venta esta lista queda vacía (todas las líneas traen
    // `precioUnitarioResuelto`) y no se consulta nada.
    const itemsAPreCargar = dto.lineas
      .filter((l) => l.precioUnitarioResuelto === undefined && puedeCostar(l))
      .map((l) => itemsBase.get(l.itemId)!)
      .filter((i) => i.tipo === 'receta' || i.tipo === 'combo')
      .map((i) => ({ itemId: i.id, tipo: i.tipo }));
    const catalogosPersonalizacion = itemsAPreCargar.length
      ? await this.itemsService.cargarCatalogosPersonalizacion(
          this.db,
          tenantId,
          itemsAPreCargar,
        )
      : undefined;

    const preciosResueltos: (string | undefined)[] = [];
    for (const linea of dto.lineas) {
      if (linea.precioUnitarioResuelto !== undefined) {
        preciosResueltos.push(linea.precioUnitarioResuelto);
        continue;
      }
      const item = itemsBase.get(linea.itemId)!;
      const pers = linea.personalizacion;
      if (
        !pers ||
        !puedeCostar(linea) ||
        (item.tipo !== 'receta' && item.tipo !== 'combo')
      ) {
        preciosResueltos.push(undefined);
        continue;
      }
      const { precioExtraTotal } =
        item.tipo === 'combo'
          ? await this.itemsService.resolverPersonalizacionCombo(
              this.db,
              tenantId,
              item.id,
              pers,
              catalogosPersonalizacion,
            )
          : await this.itemsService.resolverPersonalizacionReceta(
              this.db,
              tenantId,
              item.id,
              pers,
              catalogosPersonalizacion,
            );
      // El `.toFixed(4)` NO redondea: los dos sumandos ya vienen con 4 decimales
      // exactos (`precio_base` es `NUMERIC(18,4)` y `precioExtraTotal` sale ya
      // redondeado de `items.service.ts`). Solo formatea. El único redondeo de
      // esta cuenta es el de la conversión, que sí toma el modo del tenant.
      // Mismo razonamiento —y misma cuenta— que `ventas.service.ts`.
      preciosResueltos.push(
        this.convertirAMonedaOficial(
          new Decimal(item.precioBase).plus(precioExtraTotal).toFixed(4),
          item.monedaId,
          tasaMap,
          config.modoRedondeo,
        ),
      );
    }

    const lineas: LineaResuelta[] = dto.lineas.map((linea, i) =>
      this.resolverLinea(
        linea,
        preciosResueltos[i],
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

    const promociones = await this.resolverPromociones(
      tenantId,
      dto,
      lineas,
      itemsBase,
      fechaLocal,
    );

    const resultado = calcularVenta({
      lineas,
      promociones,
      metodoPagoId: dto.metodoPagoId ?? null,
      descuentosVenta: this.resolverReglas(
        dto.descuentosVentaIds ?? [],
        descuentoMap,
        'descuento',
        NivelRegla.VENTA,
      ),
      recargosVenta: this.resolverReglas(
        dto.recargosVentaIds ?? [],
        recargoMap,
        'recargo',
        NivelRegla.VENTA,
      ),
      config,
    });

    this.advertirItemsPausados(dto, itemsBase, resultado);

    return resultado;
  }

  /**
   * Las promos del tenant que este carrito gana, ya arbitradas entre sí.
   *
   * **Cero costo para el tenant sin promos:** si `cargarVigentes` vuelve vacía
   * se corta acá, antes de resolver la zona horaria y antes de tocar
   * `cuenta_lineas`. La única consulta que paga ese tenant es la de promos, y
   * es la misma para un carrito de 1 línea que para uno de 40.
   *
   * **Secuencial a propósito**, igual que los loaders de arriba: esto corre
   * dentro de `crearEnTransaccion` → `db.transaccion(...)`, o sea sobre un
   * único `pg.Client`. Un `Promise.all` entre la carga de promos y los
   * instantes las dispararía concurrentes sobre ese cliente y `pg@9` tira.
   *
   * El evaluador es **puro**: recibe las promos, las líneas ya resueltas
   * (precio de LISTA unitario convertido a moneda oficial, categoría e
   * instante) y devuelve las aplicaciones que sobreviven al conflicto entre
   * promos. El conflicto promo-vs-descuento de catálogo NO se decide acá — es
   * del motor, que es quien conoce lo que el catálogo terminó aplicando en cada
   * línea.
   *
   * ⚠️ **Lo que se le pasa es el precio que el cliente VE**, no el neto: en una
   * línea con `precio_incluye_impuesto` eso es la góndola. Es deliberado —la
   * promo se promete sobre la etiqueta— y el motor convierte cada monto a neto
   * al aplicarlo. Ver `LineaPromo.precioListaUnitario` y `factorListaANeto`.
   */
  private async resolverPromociones(
    tenantId: string,
    dto: CalcularVentaDto,
    lineas: LineaResuelta[],
    itemsBase: ItemsBaseMap,
    fechaLocal: string,
  ): Promise<AplicacionPromo[]> {
    const promos = await this.promocionesService.cargarVigentes(
      tenantId,
      fechaLocal,
    );
    if (promos.length === 0) return [];

    const instantes = await this.instantesDeLineas(tenantId, dto);

    const lineasPromo: LineaPromo[] = lineas.map((linea, index) => ({
      index,
      // El id CANÓNICO (el que devolvió la BD), no el del body: el scope trae
      // sus `itemIds` en minúsculas y `@IsUUID('4')` acepta mayúsculas, así
      // que cruzar por el del request dejaría la promo sin aplicar según cómo
      // el cliente escribió el UUID.
      itemId: linea.itemId,
      categoriaId: itemsBase.get(linea.itemId)?.categoriaId ?? null,
      cantidad: linea.cantidad,
      precioListaUnitario: linea.precioUnitario,
      instante: instantes[index],
    }));

    return evaluarPromos({
      promos,
      lineas: lineasPromo,
      canal: dto.canal ?? 'fisico',
    });
  }

  /**
   * El instante local con el que cada línea mide la ventana de una promo.
   *
   * **Es POR LÍNEA y sale de la BD, jamás del body** (decisión 4 del owner):
   * lo que vale es cuándo se PIDIÓ el producto, no cuándo se cobra la mesa. Un
   * happy hour de 18 a 20 tiene que seguir aplicando a la cerveza pedida a las
   * 19:00 aunque la cuenta se cierre a las 23:00 — y no puede aplicar a la que
   * se pidió a las 21:00 en esa misma cuenta. Aceptar el instante del cliente
   * sería la forma de hacer que cualquier promo aplique siempre.
   *
   * Sin `cuentaId` no hay historia que leer: la venta se está armando ahora y
   * todas las líneas comparten "ahora".
   *
   * **El cruce DTO ↔ `cuenta_lineas` es por `itemId` + consumo por orden.** No
   * hay un id de línea de cuenta en el DTO —el carrito del cobro se arma desde
   * la cuenta pero viaja como lista de ítems— así que las filas se ponen en una
   * cola por ítem, ordenadas por `creado_el`, y cada línea del DTO consume la
   * siguiente de su ítem. Es exacto mientras la venta conserve el orden de la
   * cuenta, que es lo que hace `ventas.service.ts`. Una línea que no encuentra
   * fila usa "ahora": es una línea AGREGADA en el cobro, y negarle la promo
   * sería no aplicarle un beneficio que el cliente sí acaba de ganar.
   *
   * ⚠️ **UNA query a `cuenta_lineas` y UNA a la zona horaria**, no una por
   * línea: `instanteLocalTenant` resuelve la zona con una consulta cada vez,
   * así que colapsar N instantes con él serían N viajes idénticos a `tenants`.
   * Por eso la zona se resuelve una sola vez y el colapso lo hace la mitad
   * pura (`instanteLocalEnZona`).
   */
  private async instantesDeLineas(
    tenantId: string,
    dto: CalcularVentaDto,
  ): Promise<InstanteLocal[]> {
    const zona = await zonaHorariaTenant(this.db, tenantId);
    const ahora = instanteLocalEnZona(zona, new Date());
    if (!dto.cuentaId) return dto.lineas.map(() => ahora);

    const filas: { item_id: string; creado_el: Date }[] = await this.db.query(
      `SELECT item_id, creado_el
         FROM cuenta_lineas
        WHERE cuenta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
        ORDER BY creado_el`,
      [dto.cuentaId, tenantId],
    );

    // Minúsculas, mismo motivo que `advertirItemsPausados`: el body puede
    // traer el UUID en mayúsculas y la BD lo devuelve canónico.
    const colaPorItem = new Map<string, Date[]>();
    for (const fila of filas) {
      const clave = fila.item_id.toLowerCase();
      const cola = colaPorItem.get(clave);
      if (cola) cola.push(fila.creado_el);
      else colaPorItem.set(clave, [fila.creado_el]);
    }

    return dto.lineas.map((linea) => {
      const creado = colaPorItem.get(linea.itemId.toLowerCase())?.shift();
      return creado ? instanteLocalEnZona(zona, creado) : ahora;
    });
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
        minimoCantidad: string | null;
        minimoMonto: string | null;
        valorMonto: string | null;
        valorPorcentaje: string | null;
      }[];
      metodoPagoIds: string[];
      activo: boolean;
      nivel: NivelRegla;
      fechaInicio: string | null;
      fechaFin: string | null;
    }[],
    fechaLocal: string,
  ): Map<string, ReglaResueltaConNivel> {
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
          // Ni el mínimo ni el importe llevan default: poner `'0'` en las dos
          // columnas volvería a inventar el dato que este cambio vino a
          // desambiguar —cuál de las dos unidades usa el tramo—. Cuál mide lo
          // dice qué columna está llena, y el CHECK de tabla garantiza que sea
          // exactamente una.
          tramos: r.tramos.map((t) => ({
            minimoCantidad: t.minimoCantidad,
            minimoMonto: t.minimoMonto,
            valorMonto: t.valorMonto,
            valorPorcentaje: t.valorPorcentaje,
          })),
          metodoPagoIds: r.metodoPagoIds,
          // El motor no lee `nivel` —recibe las dos listas ya separadas—, pero
          // el mapa sí lo lleva: es lo que `resolverReglas` compara para negarse
          // a aplicar una regla por la puerta equivocada.
          nivel: r.nivel,
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

  /**
   * Las reglas de catálogo que rigen sobre un ítem **en este instante**, ya
   * resueltas y listas para congelarse en una línea de cuenta.
   *
   * Usa el mismo `indexarReglas` que `calcular()` —mismos tramos, mismo
   * `activo`, misma forma— pero **el instante NO es el mismo**, y la diferencia
   * es intencional: acá se congela contra **ahora**, que es cuando se pidió la
   * línea, y `calcular()` evalúa la vigencia contra `cuentas.abierta_el`, que es
   * cuando se sentó la mesa. Con una cuenta que cruza la medianoche los dos
   * difieren, y el que tiene razón es éste: la regla del owner es *lo que regía
   * cuando se pidió*. Que `calcular()` mire la apertura es la grieta que este
   * mismo frente cierra en su tarea de promociones — hasta entonces, los dos
   * números conviven y este docblock es el aviso.
   *
   * ⚠️ **Cuesta hasta diez consultas, no cuatro** (medido con `log_statement=all`
   * sobre un `POST /cuentas/:id/lineas`): la zona horaria (1), y si el ítem tiene
   * alguna regla asociada, los catálogos completos de descuentos y recargos
   * (4 + 4, cada uno con sus tramos, métodos de pago y tipos). Por eso las
   * asociaciones se leen **primero**: un ítem sin descuentos ni recargos —el caso
   * común de una carta— sale con **una sola** consulta y no paga los catálogos.
   * Ninguna crece con las líneas de la cuenta; crecen con el tamaño del catálogo
   * del tenant. Un loader por ids lo dejaría en costo fijo y es la mejora
   * evidente si algún día molesta.
   *
   * **Impuestos quedan afuera a propósito** (ADR-010): son fiscales y se leen
   * vivos al cobrar.
   */
  async congelarReglasDeItem(
    tenantId: string,
    itemId: string,
  ): Promise<ReglasCongeladas> {
    const reglasPorItem = await this.itemsService.cargarReglasPorIds(tenantId, [
      itemId,
    ]);
    const delItem = reglasPorItem.get(itemId);
    const sinReglas =
      !delItem?.descuentosIds.length && !delItem?.recargosIds.length;
    if (sinReglas) return { descuentos: [], recargos: [] };

    // Secuencial, no `Promise.all`: en el camino de la venta esto corre dentro
    // de `db.transaccion` y las tres resuelven contra el mismo `pg.Client` del
    // contexto ALS. Mismo motivo que documentan los loaders de `calcular()`.
    const fechaLocal = await fechaLocalTenant(this.db, tenantId, new Date());
    const descuentos = await this.descuentosService.findAll(tenantId);
    const recargos = await this.recargosService.findAll(tenantId);
    const descuentoMap = this.indexarReglas(descuentos, fechaLocal);
    const recargoMap = this.indexarReglas(recargos, fechaLocal);
    // Un id asociado que ya no está en el catálogo se ignora en vez de tirar, y
    // eso **cambia** lo que pasa hoy: con la regla borrada, `calcular()` corta
    // con 400 (`requerir`) y la venta no se puede emitir, mientras que agregar la
    // línea sigue funcionando. Congelar sin ella es lo que la decisión del owner
    // pide —la mesa se cobra con lo que regía— y de paso saca ese 400 del camino
    // cuando el cobro pase a leer lo congelado. Negarse acá dejaría al garzón sin
    // poder tomar el pedido por una edición de catálogo.
    const resolver = (
      ids: string[] | undefined,
      mapa: Map<string, ReglaResueltaConNivel>,
    ) => (ids ?? []).flatMap((id) => (mapa.has(id) ? [mapa.get(id)!] : []));
    return {
      descuentos: resolver(delItem?.descuentosIds, descuentoMap),
      recargos: resolver(delItem?.recargosIds, recargoMap),
    };
  }

  private resolverLinea(
    linea: LineaCalculo,
    precioResuelto: string | undefined,
    itemsBase: ItemsBaseMap,
    reglasPorItem: ItemsReglasMap,
    impuestoMap: Map<string, ImpuestoResuelto & { tipo: string }>,
    ivaDelPais: (ImpuestoResuelto & { tipo: string }) | null,
    descuentoMap: Map<string, ReglaResueltaConNivel>,
    recargoMap: Map<string, ReglaResueltaConNivel>,
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

    // `precioResuelto` ya viene convertido —lo decidió `calcular()`—; el resto
    // de las líneas se convierten acá desde el precio de catálogo. Ninguna de
    // las dos ramas puede traer un precio del cliente.
    const precioUnitario =
      precioResuelto ??
      this.convertirAMonedaOficial(
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
      descuentos: this.resolverReglas(
        descuentoIds,
        descuentoMap,
        'descuento',
        NivelRegla.LINEA,
      ),
      recargos: this.resolverReglas(
        recargoIds,
        recargoMap,
        'recargo',
        NivelRegla.LINEA,
      ),
    };
  }

  /**
   * Resuelve ids del catálogo **exigiendo el nivel que corresponde a la puerta
   * por la que entraron**: los de una línea tienen que ser de nivel línea, y los
   * de la venta, de nivel venta. Es la segunda de las dos puertas donde el nivel
   * se hace cumplir; la primera es `ItemsService.validarReglas`, que cubre la
   * asociación en el catálogo.
   *
   * Hacen falta las DOS. Una línea puede mandar `descuentoIds` propios y pisar
   * los del ítem (`resolverLinea`), así que la puerta del catálogo no ve ese
   * camino; y `descuentosVentaIds` no pasa por ningún ítem.
   *
   * ⚠️ **La validación vive acá y NO en el motor.** El motor recibe las reglas
   * ya separadas en dos listas y calcula plata; el nivel es una regla del
   * catálogo sobre dónde se puede usar cada una, del mismo orden que "el ítem
   * está pausado" —que por la misma razón se resuelve en este service—.
   *
   * ⚠️ **Tira 400 y no advierte, al revés que la regla pausada** —que este mismo
   * archivo conserva en el mapa justo para no dejar de vender (ver
   * `indexarReglas`)—, y la diferencia es qué clase de cosa es cada una. Una
   * regla pausada es un ESTADO al que el catálogo llega solo, con ítems ya
   * asociados: cortar ahí deja el POS sin vender por una decisión de
   * administración. Un id en la lista equivocada es un REQUEST mal armado, y no
   * es alcanzable desde el catálogo: `item_descuentos` no puede contener una
   * regla de venta (lo impiden `ItemsService.validarReglas` al asociar y
   * `validarCambioDeNivel` al cambiar el nivel, que cuenta también los ítems en
   * la papelera).
   *
   * ✅ **La ventana que este párrafo declaraba se cerró el 2026-08-28.** Decía que
   * `validarCambioDeNivel` corría FUERA de `db.transaccion`, así que un
   * `PATCH /items` que asociara la regla entre su `COUNT` y el `save` dejaba la
   * fila puente con una regla de venta. Hoy las dos puertas se serializan sobre
   * la fila de la regla: el guard corre adentro de la transacción y toma
   * `FOR UPDATE`; `ItemsService.validarReglas` toma `FOR SHARE` en el mismo
   * statement que lee `nivel`. El orden de bloqueo está en
   * `docs/patterns/backend.md` § 15 — reglas antes que `items`, sin ciclo.
   *
   * ⚠️ Sigue sin ser una garantía **estructural**: no hay constraint en la base
   * que impida la fila, lo que hay son dos puertas que ahora no se cruzan. Un
   * camino nuevo que escriba `item_descuentos` / `item_recargos` sin pasar por
   * `validarReglas` reabre el agujero sin que nada avise.
   *
   * Si esa carrera se materializa, el síntoma es este 400 al vender y el arreglo
   * es quitar la asociación. Si el estado se volviera alcanzable **por catálogo**
   * —no por carrera—, esta decisión hay que releerla entera: ahí el 400 dejaría
   * de ser "te equivocaste al pedir" y pasaría a ser "el catálogo te dejó sin
   * vender".
   */
  private resolverReglas(
    ids: string[],
    mapa: Map<string, ReglaResueltaConNivel>,
    label: string,
    nivelEsperado: NivelRegla,
  ): ReglaResuelta[] {
    return ids.map((id) => {
      const regla = this.requerir(mapa, id, label);
      if (regla.nivel !== nivelEsperado) {
        throw new BadRequestException(
          nivelEsperado === NivelRegla.LINEA
            ? `El ${label} "${regla.nombre}" es de nivel venta: se elige en la venta, no por línea`
            : `El ${label} "${regla.nombre}" es de nivel línea: se asocia a un ítem, no a la venta`,
        );
      }
      return regla;
    });
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
