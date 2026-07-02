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
  type ConfigCalculo,
  type ImpuestoResuelto,
  type LineaResuelta,
  type ReglaResuelta,
  type ResultadoVenta,
} from './calculo-precios.engine';

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
    const impuestoMap = new Map<string, ImpuestoResuelto>(
      impuestos.map((i) => [
        i.id,
        { id: i.id, nombre: i.nombre, porcentaje: i.porcentaje },
      ]),
    );
    const descuentoMap = this.indexarReglas(descuentos);
    const recargoMap = this.indexarReglas(recargos);

    const tasaMap = new Map(
      (await this.monedasService.findMonedas(tenantId)).map((m) => [
        m.monedaId,
        m.valorDelDia ?? '1',
      ]),
    );

    const lineas: LineaResuelta[] = [];
    for (const linea of dto.lineas) {
      lineas.push(
        await this.resolverLinea(
          tenantId,
          linea,
          impuestoMap,
          descuentoMap,
          recargoMap,
          tasaMap,
        ),
      );
    }

    return calcularVenta({
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
        },
      ]),
    );
  }

  private async resolverLinea(
    tenantId: string,
    linea: LineaDto,
    impuestoMap: Map<string, ImpuestoResuelto>,
    descuentoMap: Map<string, ReglaResuelta>,
    recargoMap: Map<string, ReglaResuelta>,
    tasaMap: Map<string, string>,
  ): Promise<LineaResuelta> {
    if (new Decimal(linea.cantidad).lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    }
    // findOne valida pertenencia al tenant y trae los ids asociados.
    const item = await this.itemsService.findOne(tenantId, linea.itemId);

    const impuestoIds = linea.impuestoIds ?? item.impuestosIds;
    const descuentoIds = linea.descuentoIds ?? item.descuentosIds;
    const recargoIds = linea.recargoIds ?? item.recargosIds;

    const precioUnitario =
      linea.precioUnitario !== undefined
        ? linea.precioUnitario
        : this.convertirAMonedaOficial(
            item.precioBase,
            item.monedaId,
            tasaMap,
          );

    return {
      itemId: item.id,
      cantidad: linea.cantidad,
      precioUnitario,
      precioIncluyeImpuesto: item.precioIncluyeImpuesto,
      impuestos: impuestoIds.map((id) =>
        this.requerir(impuestoMap, id, 'impuesto'),
      ),
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
