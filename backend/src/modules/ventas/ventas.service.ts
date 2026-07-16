import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { CajaService } from '../caja/caja.service';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService } from '../items/items.service';
import { PagosService, calcularEstadoVenta } from '../pagos/pagos.service';
import { CatalogService } from '../catalog/catalog.service';
import {
  assertPresentacionPareada,
  resolverCantidadDesdePresentacion,
} from '../../common/utils/cantidad-presentacion.util';
import type { CreateVentaDto } from './dto/create-venta.dto';
import type { QueryVentasDto } from './dto/query-ventas.dto';
import { Venta, EstadoVenta } from './entities/venta.entity';
import { VentaDetalle } from './entities/venta-detalle.entity';
import { VentaDescuento } from './entities/venta-descuento.entity';
import { VentaRecargo } from './entities/venta-recargo.entity';
import { VentaImpuesto } from './entities/venta-impuesto.entity';
import { VentaCustomer } from './entities/venta-customer.entity';
import { TIPO_DOCUMENTO_NC_ID } from './entities/tipo-documento-tributario.entity';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import type { PersonalizacionRecetaSnapshot } from '../../common/dto/personalizacion-receta.dto';

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

export interface TipoDocumentoResponse {
  id: string;
  nombre: string;
  codigo: string | null;
  customerRequerido: boolean;
}

@Injectable()
export class VentasService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly cajaService: CajaService,
    private readonly inventarioService: InventarioService,
    private readonly itemsService: ItemsService,
    private readonly pagosService: PagosService,
    private readonly catalogService: CatalogService,
  ) {}

  async crear(tenantId: string, usuarioId: string, dto: CreateVentaDto) {
    return this.dataSource.transaction((manager) =>
      this.crearEnTransaccion(manager, tenantId, usuarioId, dto),
    );
  }

  async crearEnTransaccion(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    dto: CreateVentaDto,
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

    // 2. Cargar todos los items para obtener monedaId, tipo, nombre
    const items = await Promise.all(
      dto.lineas.map((l) => this.itemsService.findOne(tenantId, l.itemId)),
    );

    for (const item of items) {
      if (item.tipo === 'ingrediente') {
        throw new BadRequestException(
          'Los ingredientes no se pueden vender directamente',
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

      if (!linea.cantidadPresentacion || !linea.unidadCodigoPresentacion) {
        return {
          cantidadCanonica: linea.cantidad,
          cantidadPresentacion: null as string | null,
          unidadCodigoPresentacion: null as string | null,
        };
      }

      const unidadBase =
        item.tipo === 'receta' ? 'unidad' : (item.unidadMedida ?? 'unidad');

      const res = resolverCantidadDesdePresentacion({
        cantidadPresentacion: linea.cantidadPresentacion,
        unidadCodigoPresentacion: linea.unidadCodigoPresentacion,
        unidadBaseCodigo: unidadBase,
        catalogo,
        forzarConteo: item.tipo === 'receta',
      });

      return {
        cantidadCanonica: res.cantidadCanonica,
        cantidadPresentacion: res.cantidadPresentacion,
        unidadCodigoPresentacion: res.unidadCodigoPresentacion,
      };
    });

    // 3. Resolver moneda oficial del tenant (es_default = true)
    const monedaRows: {
      moneda_id: string;
      valor_del_dia: string;
      es_default: boolean;
    }[] = await this.dataSource.query(
      `SELECT moneda_id, valor_del_dia, es_default
         FROM tenant_moneda
         WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [tenantId],
    );
    const monedaOficial = monedaRows.find((r) => r.es_default);
    if (!monedaOficial) {
      throw new BadRequestException(
        'El tenant no tiene moneda oficial configurada',
      );
    }
    const monedaOficialId = monedaOficial.moneda_id;

    // Mapa de monedaId → valor_del_dia para conversión
    const tasaMap = new Map(
      monedaRows.map((r) => [r.moneda_id, r.valor_del_dia ?? '1']),
    );

    const personalizaciones = await Promise.all(
      dto.lineas.map(async (linea, i) => {
        const item = items[i];
        if (item.tipo !== 'receta' || !linea.personalizacion) {
          return null;
        }
        return this.itemsService.resolverPersonalizacionReceta(
          manager,
          tenantId,
          item.id,
          linea.personalizacion,
        );
      }),
    );

    // 4. Construir DTO para el motor de precios con precios ya convertidos a moneda oficial
    const lineasConversion = dto.lineas.map((linea, i) => {
      const item = items[i];
      const pers = personalizaciones[i];
      const { cantidadCanonica, cantidadPresentacion, unidadCodigoPresentacion } =
        cantidadesResueltas[i];
      const tasa = new Decimal(tasaMap.get(item.monedaId) ?? '1');
      const precioOrigen =
        pers != null
          ? new Decimal(item.precioBase).plus(pers.precioExtraTotal).toFixed(4)
          : (linea.precioUnitario ?? item.precioBase);
      const precioConvertido = new Decimal(precioOrigen).times(tasa).toFixed(4);
      return {
        linea,
        item,
        cantidadCanonica,
        cantidadPresentacion,
        unidadCodigoPresentacion,
        precioOrigen,
        tasa: tasa.toFixed(6),
        precioConvertido,
        personalizacion: (pers?.snapshot ?? null) as PersonalizacionRecetaSnapshot | null,
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
    };

    // 5. Calcular importes (sin persistencia)
    const resultado = await this.calculoPreciosService.calcular(
      tenantId,
      calcularDto,
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
        totalImpuestos: resultado.totales.totalImpuestos,
        totalFinal: resultado.totales.totalFinal,
        comentario: dto.comentario ?? null,
      }),
    );

    // 7b. Líneas / detalles
    const detalles = await Promise.all(
      resultado.lineas.map((rLinea, i) => {
        const {
          item,
          precioOrigen,
          tasa,
          precioConvertido,
          personalizacion,
          cantidadPresentacion,
          unidadCodigoPresentacion,
        } = lineasConversion[i];
        return manager.save(
          VentaDetalle,
          manager.create(VentaDetalle, {
            ventaId: venta.id,
            itemId: rLinea.itemId,
            monedaIdOrigen: item.monedaId,
            precioUnitarioOrigen: precioOrigen,
            tasaCambio: tasa,
            precioUnitario: precioConvertido,
            descripcion: item.nombre,
            cantidad: rLinea.cantidad,
            cantidadPresentacion,
            unidadCodigoPresentacion,
            subtotal: rLinea.subtotalNeto,
            descuentoAplicado: rLinea.descuentoAplicado,
            recargoAplicado: rLinea.recargoAplicado,
            impuestoAplicado: rLinea.impuestoAplicado,
            totalLinea: rLinea.totalLinea,
            personalizacion,
          }),
        );
      }),
    );

    // 7c. Reglas aplicadas — descuentos por línea
    for (let i = 0; i < resultado.lineas.length; i++) {
      const rLinea = resultado.lineas[i];
      for (const traza of rLinea.trazas.descuentos) {
        await manager.save(
          VentaDescuento,
          manager.create(VentaDescuento, {
            ventaId: venta.id,
            descuentoId: traza.id,
            valorAplicado: traza.monto,
            porcentajeAplicado: null,
            aplicadoEn: 'detalle',
          }),
        );
      }
      for (const traza of rLinea.trazas.recargos) {
        await manager.save(
          VentaRecargo,
          manager.create(VentaRecargo, {
            ventaId: venta.id,
            recargoId: traza.id,
            valorAplicado: traza.monto,
            porcentajeAplicado: null,
            aplicadoEn: 'detalle',
          }),
        );
      }
      for (const traza of rLinea.trazas.impuestos) {
        await manager.save(
          VentaImpuesto,
          manager.create(VentaImpuesto, {
            ventaId: venta.id,
            impuestoId: traza.id,
            valorAplicado: traza.monto,
            porcentajeAplicado: traza.tasa,
            aplicadoEn: 'detalle',
          }),
        );
      }
    }

    // 7d. Reglas a nivel venta
    for (const traza of resultado.trazasVenta.descuentos) {
      await manager.save(
        VentaDescuento,
        manager.create(VentaDescuento, {
          ventaId: venta.id,
          descuentoId: traza.id,
          valorAplicado: traza.monto,
          porcentajeAplicado: null,
          aplicadoEn: 'venta',
        }),
      );
    }
    for (const traza of resultado.trazasVenta.recargos) {
      await manager.save(
        VentaRecargo,
        manager.create(VentaRecargo, {
          ventaId: venta.id,
          recargoId: traza.id,
          valorAplicado: traza.monto,
          porcentajeAplicado: null,
          aplicadoEn: 'venta',
        }),
      );
    }

    // 7e. Customer (opcional)
    if (dto.customer) {
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
    const advertenciasReceta: string[] = [];
    for (let i = 0; i < lineasConversion.length; i++) {
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
        const advertencias = await this.itemsService.venderIngredientesReceta(
          manager,
          {
            tenantId,
            usuarioId,
            ventaId: venta.id,
            recetaItemId: item.id,
            recetaNombre: item.nombre,
            cantidadVendida: cantidadCanonica,
            snapshot: personalizacion ?? undefined,
          },
        );
        advertenciasReceta.push(...advertencias);
      }
    }

    // 7g. Pagos — delegado a PagosService (incluye vuelto + movimientos de caja)
    const savedPagos = await this.pagosService.registrar(manager, {
      tenantId,
      ventaId: venta.id,
      pagos: pagosDto,
      cajaId: caja.id,
      monedaOficialId,
      target: resultado.totales.totalFinal,
    });

    // 7h. Actualizar estado de la venta según montos netos de los pagos registrados
    if (savedPagos.length > 0) {
      const montoAplicado = savedPagos.reduce(
        (acc, p) =>
          acc.plus(new Decimal(p.monto)).minus(new Decimal(p.vuelto ?? '0')),
        new Decimal(0),
      );
      const estadoFinal = calcularEstadoVenta(
        resultado.totales.totalFinal,
        montoAplicado.toFixed(4),
      );
      await manager.query(
        `UPDATE ventas SET estado=$1, actualizado_el=NOW() WHERE venta_id=$2`,
        [estadoFinal, venta.id],
      );
      venta.estado = estadoFinal;
    }

    return { ...venta, detalles, advertenciasReceta };
  }

  /**
   * Crea una nota de crédito interna (sin SII) por un reembolso de pasarela.
   * Los totales se COPIAN del monto reembolsado — nunca pasan por el motor de
   * precios — y la venta original no se modifica (queda `pagada`; la NC
   * documenta la devolución). Las líneas son opcionales e informativas: solo
   * los ítems elegidos para devolver a stock, sin validar cruce con el monto.
   */
  async crearNotaCredito(params: {
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
  }): Promise<{
    id: string;
    totalFinal: string;
    movimientoCajaId: string | null;
    fecha: Date;
    comentario: string | null;
    devoluciones: DevolucionReembolso[];
  }> {
    if (new Decimal(params.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');

    return this.dataSource.transaction(async (manager) => {
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
      }

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
        }),
      );

      for (const linea of lineas) {
        const totalLinea = new Decimal(linea.precioUnitario)
          .times(linea.cantidad)
          .toFixed(4);
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
        const saldo = await this.cajaService.calcularSaldoEsperado(
          caja.id,
          manager,
        );
        if (new Decimal(saldo).minus(params.monto).lt(0))
          throw new UnprocessableEntityException('Saldo insuficiente en caja');
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

    await this.dataSource.transaction(async (manager) => {
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
      for (const linea of lineas) {
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId: params.tenantId,
          itemId: linea.itemId,
          tipo: 'entrada',
          motivo: 'devolucion',
          cantidad: linea.cantidad,
          usuarioId: params.usuarioId,
          ventaId: params.ventaOriginalId,
          comentario: params.comentario,
        });
      }
    });
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
  }> {
    const rows: {
      venta_id: string;
      caja_id: string | null;
      moneda_id: string;
      canal: string;
      total_final: string;
      estado: string;
      tipo_documento_id: string | null;
    }[] = await manager.query(
      `SELECT venta_id, caja_id, moneda_id, canal, total_final, estado, tipo_documento_id
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
      modo_inventario: string | null;
    }[] = await manager.query(
      `SELECT d.item_id, d.cantidad, d.precio_unitario, d.precio_unitario_origen,
              d.tasa_cambio, d.moneda_id_origen, d.descripcion, ip.modo_inventario
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
      };
    });
  }

  async findTiposDocumento(tenantId: string): Promise<TipoDocumentoResponse[]> {
    const rows: {
      tipo_documento_id: string;
      nombre: string;
      codigo: string | null;
      customer_requerido: boolean;
    }[] = await this.dataSource.query(
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

  async resumen(tenantId: string): Promise<VentasResumen> {
    const rows: {
      total_ventas: number;
      total_facturado: string;
      saldo_pendiente: string;
    }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total_ventas,
              COALESCE(SUM(v.total_final), 0)::text AS total_facturado,
              COALESCE(SUM(
                v.total_final - COALESCE((
                  SELECT SUM(p.monto - p.vuelto)
                  FROM pagos p
                  WHERE p.venta_id = v.venta_id AND p.eliminado_el IS NULL
                ), 0)
              ), 0)::text AS saldo_pendiente
       FROM ventas v
       WHERE v.tenant_id = $1 AND v.eliminado_el IS NULL
         AND v.tipo_documento_id IS DISTINCT FROM $2`,
      [tenantId, TIPO_DOCUMENTO_NC_ID],
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
  ): Promise<PaginatedResponse<VentaListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    const { filters, params } = this.buildListarFilters(tenantId, query);

    const countRows: { total: number }[] = await this.dataSource.query(
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
    }[] = await this.dataSource.query(
      `SELECT v.venta_id, v.canal, v.estado, v.total_final, v.fecha, v.creado_el,
              v.tipo_documento_id,
              COALESCE((
                SELECT SUM(p.monto - p.vuelto)
                FROM pagos p
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
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let paramIdx = 2;
    let filters = '';

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

  async findOne(tenantId: string, ventaId: string) {
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
      comentario: string | null;
      fecha: Date;
      creado_el: Date;
      venta_referencia_id: string | null;
      tipo_documento_codigo: string | null;
      tipo_documento_nombre: string | null;
    }[] = await this.dataSource.query(
      `SELECT v.venta_id, v.caja_id, v.moneda_id, v.tipo_documento_id, v.canal, v.estado,
              v.total_bruto, v.total_descuentos, v.total_recargos, v.total_impuestos, v.total_final,
              v.comentario, v.fecha, v.creado_el, v.venta_referencia_id,
              td.codigo AS tipo_documento_codigo, td.nombre AS tipo_documento_nombre
       FROM ventas v
       LEFT JOIN tipos_documento_tributario td
            ON td.tipo_documento_id = v.tipo_documento_id AND td.eliminado_el IS NULL
       WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL`,
      [ventaId, tenantId],
    );

    if (!rows.length) throw new NotFoundException('Venta no encontrada');
    const v = rows[0];

    type Row = Record<string, unknown>;
    const detalles: Row[] = await this.dataSource.query(
      `SELECT d.detalle_id, d.item_id, d.descripcion, d.cantidad, d.precio_unitario,
              d.precio_unitario_origen, d.tasa_cambio, d.moneda_id_origen,
              d.subtotal, d.descuento_aplicado, d.recargo_aplicado, d.impuesto_aplicado,
              d.total_linea, ip.modo_inventario
       FROM venta_detalles d
       LEFT JOIN item_producto ip ON ip.item_id = d.item_id
       WHERE d.venta_id = $1 AND d.eliminado_el IS NULL ORDER BY d.creado_el ASC`,
      [ventaId],
    );
    // Ya devuelto por ítem (movimientos 'devolucion' de esta venta o de sus NCs
    // hijas): el modal de reembolso lo usa para capear las cantidades.
    const devueltos: { item_id: string; devuelto: string }[] =
      await this.dataSource.query(
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
    const reembolsos: Row[] = await this.dataSource.query(
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
    const notasCredito: Row[] = await this.dataSource.query(
      `SELECT venta_id, total_final, fecha, comentario
       FROM ventas
       WHERE venta_referencia_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       ORDER BY creado_el ASC`,
      [ventaId, tenantId],
    );
    const descuentos: Row[] = await this.dataSource.query(
      `SELECT venta_descuento_id, descuento_id, valor_aplicado, porcentaje_aplicado, aplicado_en
       FROM ventas_descuentos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const recargos: Row[] = await this.dataSource.query(
      `SELECT venta_recargo_id, recargo_id, valor_aplicado, porcentaje_aplicado, aplicado_en
       FROM ventas_recargos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const impuestos: Row[] = await this.dataSource.query(
      `SELECT venta_impuesto_id, impuesto_id, valor_aplicado, porcentaje_aplicado, aplicado_en
       FROM ventas_impuestos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const customerRows: Row[] = await this.dataSource.query(
      `SELECT customer_id, tercero_id, nombre, rut, direccion, telefono, email
       FROM venta_customer WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const pagos: Row[] = await this.dataSource.query(
      `SELECT pago_id, metodo_pago_id, moneda_oficial_id, caja_id, monto, vuelto, fecha, referencia
       FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL ORDER BY creado_el ASC`,
      [ventaId],
    );

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
      ventaReferenciaId: v.venta_referencia_id,
      canal: v.canal,
      estado: v.estado,
      totalBruto: v.total_bruto,
      totalDescuentos: v.total_descuentos,
      totalRecargos: v.total_recargos,
      totalImpuestos: v.total_impuestos,
      totalFinal: v.total_final,
      comentario: v.comentario,
      fecha: v.fecha,
      creadoEl: v.creado_el,
      detalles: detalles.map((d) => ({
        id: d['detalle_id'],
        itemId: d['item_id'],
        descripcion: d['descripcion'],
        cantidad: d['cantidad'],
        precioUnitario: d['precio_unitario'],
        precioUnitarioOrigen: d['precio_unitario_origen'],
        tasaCambio: d['tasa_cambio'],
        monedaIdOrigen: d['moneda_id_origen'],
        subtotal: d['subtotal'],
        descuentoAplicado: d['descuento_aplicado'],
        recargoAplicado: d['recargo_aplicado'],
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
        valorAplicado: d['valor_aplicado'],
        porcentajeAplicado: d['porcentaje_aplicado'],
        aplicadoEn: d['aplicado_en'],
      })),
      recargos: recargos.map((r) => ({
        id: r['venta_recargo_id'],
        recargoId: r['recargo_id'],
        valorAplicado: r['valor_aplicado'],
        porcentajeAplicado: r['porcentaje_aplicado'],
        aplicadoEn: r['aplicado_en'],
      })),
      impuestos: impuestos.map((imp) => ({
        id: imp['venta_impuesto_id'],
        impuestoId: imp['impuesto_id'],
        valorAplicado: imp['valor_aplicado'],
        porcentajeAplicado: imp['porcentaje_aplicado'],
        aplicadoEn: imp['aplicado_en'],
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
      pagos: pagos.map((p) => ({
        id: p['pago_id'],
        metodoPagoId: p['metodo_pago_id'],
        monedaOficialId: p['moneda_oficial_id'],
        cajaId: p['caja_id'],
        monto: p['monto'],
        vuelto: p['vuelto'],
        fecha: p['fecha'],
        referencia: p['referencia'],
      })),
    };
  }
}
