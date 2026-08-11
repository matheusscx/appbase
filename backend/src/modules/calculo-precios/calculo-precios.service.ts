import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ItemsService } from '../items/items.service';
import { ImpuestosService } from '../impuestos/impuestos.service';
import { DescuentosService } from '../descuentos/descuentos.service';
import { RecargosService } from '../recargos/recargos.service';
import { TenantsService } from '../tenants/tenants.service';
import { MonedasService } from '../monedas/monedas.service';
import { CalcularVentaDto, LineaDto } from './dto/calcular.dto';
import {
  calcularVenta,
  type AdvertenciaPrecio,
  type ConfigCalculo,
  type ImpuestoResuelto,
  type LineaResuelta,
  type ReglaResuelta,
  type ResultadoVenta,
} from './calculo-precios.engine';

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
  ) {}

  async calcular(
    tenantId: string,
    dto: CalcularVentaDto,
  ): Promise<ResultadoVenta> {
    const prefs =
      await this.tenantsService.getPreferenciasFinancieras(tenantId);
    const config: ConfigCalculo = {
      formula: prefs.formula,
      calculoDescuentos: prefs.calculoDescuentos,
      calculoRecargos: prefs.calculoRecargos,
      escalaCalculo: prefs.escalaCalculo,
      modoRedondeo: prefs.modoRedondeo,
    };

    // Catálogos del tenant cargados una vez e indexados por id.
    const [impuestos, descuentos, recargos] = await Promise.all([
      this.impuestosService.findAll(tenantId),
      this.descuentosService.findAll(tenantId),
      this.recargosService.findAll(tenantId),
    ]);
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
    const descuentoMap = this.indexarReglas(descuentos);
    const recargoMap = this.indexarReglas(recargos);

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
    const [itemsBase, reglasPorItem] = await Promise.all([
      this.itemsService.cargarBasePorIds(tenantId, itemIds),
      this.itemsService.cargarReglasPorIds(tenantId, itemIds),
    ]);

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
      valor: string | null;
      tipoRegla: { codigo: string } | null;
      tramos: { minimo: string | null; valor: string | null }[];
      metodoPagoIds: string[];
      activo: boolean;
    }[],
  ): Map<string, ReglaResuelta> {
    return new Map(
      reglas.map((r) => [
        r.id,
        {
          id: r.id,
          nombre: r.nombre,
          codigo: r.tipoRegla?.codigo ?? null,
          modo: r.modo as ReglaResuelta['modo'],
          valor: r.valor,
          tramos: r.tramos.map((t) => ({
            minimo: t.minimo ?? '0',
            valor: t.valor ?? '0',
          })),
          metodoPagoIds: r.metodoPagoIds,
          // El mapa conserva las reglas pausadas a propósito: sacarlas de acá
          // haría que `requerir()` tirara 400 por id ausente en cada ítem que
          // la tenga asociada, y el POS dejaría de vender. El descarte pasa al
          // aplicarlas, en el motor.
          activo: r.activo,
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
        : this.convertirAMonedaOficial(item.precioBase, item.monedaId, tasaMap);

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

  /** Convierte precio de la moneda del ítem a moneda oficial (valor_del_dia). */
  private convertirAMonedaOficial(
    precio: string,
    monedaId: string,
    tasaMap: Map<string, string>,
  ): string {
    const tasa = new Decimal(tasaMap.get(monedaId) ?? '1');
    return new Decimal(precio).times(tasa).toFixed(4);
  }

  private requerir<T>(mapa: Map<string, T>, id: string, label: string): T {
    const v = mapa.get(id);
    if (!v) {
      throw new BadRequestException(`${label} ${id} no encontrado`);
    }
    return v;
  }
}
