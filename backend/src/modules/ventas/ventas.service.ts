import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { CajaService } from '../caja/caja.service';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService } from '../items/items.service';
import type { CreateVentaDto } from './dto/create-venta.dto';
import { Venta, EstadoVenta } from './entities/venta.entity';
import { VentaDetalle } from './entities/venta-detalle.entity';
import { VentaDescuento } from './entities/venta-descuento.entity';
import { VentaRecargo } from './entities/venta-recargo.entity';
import { VentaImpuesto } from './entities/venta-impuesto.entity';
import { VentaCustomer } from './entities/venta-customer.entity';
import { Pago } from './entities/pago.entity';

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
  ) {}

  async crear(tenantId: string, usuarioId: string, dto: CreateVentaDto) {
    // 1. Verificar caja abierta
    const caja = await this.cajaService.findActiva(tenantId, usuarioId);
    if (!caja) {
      throw new BadRequestException('No tienes una caja abierta');
    }

    // 2. Cargar todos los items para obtener monedaId, tipo, nombre
    const items = await Promise.all(
      dto.lineas.map((l) => this.itemsService.findOne(tenantId, l.itemId)),
    );

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

    // 4. Construir DTO para el motor de precios con precios ya convertidos a moneda oficial
    const lineasConversion = dto.lineas.map((linea, i) => {
      const item = items[i];
      const tasa = new Decimal(tasaMap.get(item.monedaId) ?? '1');
      const precioOrigen = linea.precioUnitario ?? item.precioBase;
      const precioConvertido = new Decimal(precioOrigen).times(tasa).toFixed(4);
      return {
        linea,
        item,
        precioOrigen,
        tasa: tasa.toFixed(6),
        precioConvertido,
      };
    });

    const calcularDto = {
      lineas: lineasConversion.map(({ linea, precioConvertido }) => ({
        itemId: linea.itemId,
        cantidad: linea.cantidad,
        precioUnitario: precioConvertido,
        descuentoIds: linea.descuentoIds,
        recargoIds: linea.recargoIds,
        impuestoIds: linea.impuestoIds,
      })),
      metodoPagoId: dto.metodoPagoId,
      descuentosVentaIds: dto.descuentosVentaIds,
      recargosVentaIds: dto.recargosVentaIds,
    };

    // 5. Calcular importes (sin persistencia)
    const resultado = await this.calculoPreciosService.calcular(
      tenantId,
      calcularDto,
    );
    const totalFinal = new Decimal(resultado.totales.totalFinal);

    // 6. Resolver info de métodos de pago (nombre + permite_vuelto)
    const metodoPagoRows: {
      metodo_pago_id: string;
      nombre: string;
      permite_vuelto: boolean;
    }[] = await this.dataSource.query(
      `SELECT tmp.metodo_pago_id, mp.nombre, tmp.permite_vuelto
       FROM tenant_metodo_pago tmp
       JOIN metodos_pago mp ON mp.metodo_pago_id = tmp.metodo_pago_id
                            AND mp.eliminado_el IS NULL
       WHERE tmp.tenant_id = $1
         AND tmp.metodo_pago_id = ANY($2::uuid[])
         AND tmp.eliminado_el IS NULL`,
      [tenantId, dto.pagos.map((p) => p.metodoPagoId)],
    );
    const metodoPagoMap = new Map(
      metodoPagoRows.map((r) => [
        r.metodo_pago_id,
        { nombre: r.nombre, permiteVuelto: r.permite_vuelto },
      ]),
    );

    // 7. Resolver vuelto y estado
    const sumaPagos = dto.pagos.reduce(
      (acc, p) => acc.plus(p.monto),
      new Decimal(0),
    );
    const excedente = Decimal.max(0, sumaPagos.minus(totalFinal));

    let pagoConVueltoIdx = -1;
    if (excedente.gt(0)) {
      pagoConVueltoIdx = dto.pagos.findIndex(
        (p) => metodoPagoMap.get(p.metodoPagoId)?.permiteVuelto === true,
      );
      if (pagoConVueltoIdx === -1) {
        throw new BadRequestException(
          'El pago supera el total pero ningún método de pago permite vuelto',
        );
      }
    }

    const montoAplicado = sumaPagos.minus(excedente);
    const estado = montoAplicado.gte(totalFinal)
      ? EstadoVenta.PAGADA
      : EstadoVenta.PENDIENTE;

    // 8. Transacción atómica
    return this.dataSource.transaction(async (manager) => {
      // 8a. Cabecera de venta
      const venta = await manager.save(
        Venta,
        manager.create(Venta, {
          tenantId,
          cajaId: caja.id,
          monedaId: monedaOficialId,
          tipoDocumentoId: dto.tipoDocumentoId ?? null,
          canal: 'fisico',
          estado,
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
          const { item, precioOrigen, tasa, precioConvertido } =
            lineasConversion[i];
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
              subtotal: rLinea.subtotalNeto,
              descuentoAplicado: rLinea.descuentoAplicado,
              recargoAplicado: rLinea.recargoAplicado,
              impuestoAplicado: rLinea.impuestoAplicado,
              totalLinea: rLinea.totalLinea,
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

      // 7f. Movimientos de inventario (solo productos)
      for (let i = 0; i < lineasConversion.length; i++) {
        const { item, linea } = lineasConversion[i];
        if (item.tipo !== 'producto') continue;
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId,
          itemId: item.id,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: linea.cantidad,
          usuarioId,
          ventaId: venta.id,
          unidadIds: linea.unidadIds,
          loteId: linea.loteId,
        });
      }

      // 7g. Pagos + movimientos de caja para métodos con vuelto (efectivo)
      const pagosGuardados: Pago[] = [];
      for (let i = 0; i < dto.pagos.length; i++) {
        const p = dto.pagos[i];
        const vuelto = i === pagoConVueltoIdx ? excedente.toFixed(4) : '0.0000';
        const pago = await manager.save(
          Pago,
          manager.create(Pago, {
            tenantId,
            ventaId: venta.id,
            metodoPagoId: p.metodoPagoId,
            monedaOficialId,
            cajaId: caja.id,
            monto: p.monto,
            vuelto,
            referencia: p.referencia ?? null,
          }),
        );
        pagosGuardados.push(pago);
      }

      // Movimiento de caja: una entrada por cada pago (todos los métodos)
      for (let i = 0; i < dto.pagos.length; i++) {
        const p = dto.pagos[i];
        const vuelto = new Decimal(pagosGuardados[i].vuelto ?? '0');
        const montoNeto = new Decimal(p.monto).minus(vuelto).toFixed(4);
        await this.cajaService.registrarMovimientoEnTransaccion(manager, {
          cajaId: caja.id,
          tipo: 'entrada',
          concepto: `Venta · ${metodoPagoMap.get(p.metodoPagoId)?.nombre ?? 'Pago'}`,
          monto: montoNeto,
          ventaId: venta.id,
          pagoId: pagosGuardados[i].id,
          metodoPagoId: p.metodoPagoId,
        });
      }

      return { ...venta, detalles };
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

  async listar(tenantId: string) {
    const rows: {
      venta_id: string;
      canal: string;
      estado: string;
      total_final: string;
      fecha: Date;
      creado_el: Date;
    }[] = await this.dataSource.query(
      `SELECT venta_id, canal, estado, total_final, fecha, creado_el
       FROM ventas
       WHERE tenant_id = $1 AND eliminado_el IS NULL
       ORDER BY creado_el DESC`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.venta_id,
      canal: r.canal,
      estado: r.estado,
      totalFinal: r.total_final,
      fecha: r.fecha,
      creadoEl: r.creado_el,
    }));
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
    }[] = await this.dataSource.query(
      `SELECT venta_id, caja_id, moneda_id, tipo_documento_id, canal, estado,
              total_bruto, total_descuentos, total_recargos, total_impuestos, total_final,
              comentario, fecha, creado_el
       FROM ventas
       WHERE venta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [ventaId, tenantId],
    );

    if (!rows.length) throw new NotFoundException('Venta no encontrada');
    const v = rows[0];

    type Row = Record<string, unknown>;
    const detalles: Row[] = await this.dataSource.query(
      `SELECT detalle_id, item_id, descripcion, cantidad, precio_unitario,
              precio_unitario_origen, tasa_cambio, moneda_id_origen,
              subtotal, descuento_aplicado, recargo_aplicado, impuesto_aplicado, total_linea
       FROM venta_detalles
       WHERE venta_id = $1 AND eliminado_el IS NULL ORDER BY creado_el ASC`,
      [ventaId],
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
