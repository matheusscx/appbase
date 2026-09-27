import { BadRequestException, Injectable } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { TIPOS_CON_STOCK } from './presentaciones-compra.service';
import type { LecturaDteDto } from './dto/lectura-dte.dto';

/**
 * RUT chileno normalizado: sin puntos ni espacios, `K` mayúscula, guion antes
 * del DV. `'76.543.210-3'` → `'76543210-3'`; `'765432103'` → `'76543210-3'`
 * (spec compras-xml-dte § 3.1).
 */
export function normalizarRut(rut: string): string {
  const limpio = rut
    .trim()
    .toUpperCase()
    .replace(/[.\s]/g, '')
    .replace(/-/g, '');
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  return `${cuerpo}-${dv}`;
}

/** `trim`, mayúsculas, espacios internos colapsados (spec § 3.2). */
export function normalizarClave(clave: string): string {
  return clave.trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Lo que el sistema sabe de una clave de la factura: dónde destinarla, o por qué no. */
export type DestinoCodigo =
  | { itemId: string; presentacionId: string }
  | { itemId: string; unidadCodigo: string }
  | 'no_mercaderia';

export interface AsociacionDte {
  clave: string;
  destino: DestinoCodigo | null;
  /** Solo cuando `destino` es `null` por una razón que vale explicar. */
  nota?: string;
}

/** Lo que `POST /compras/dte/lectura` devuelve (spec compras-xml-dte § 7). */
export interface LecturaDteRespuesta {
  receptorEsDelTenant: boolean;
  proveedor: { id: string; nombre: string } | null;
  /** Más de un proveedor con ese RUT: el encargado elige. */
  candidatos: { id: string; nombre: string }[];
  /** `null` → no se carga acá (incluye notas de crédito/débito y un código sin fila). */
  tipoDocumento: { id: string; nombre: string } | null;
  compraExistente: {
    id: string;
    estado: 'borrador' | 'confirmada';
    confirmadoEl: string | null;
  } | null;
  asociaciones: AsociacionDte[];
}

/** Códigos de tipo de documento que son notas de crédito o débito: nunca se cargan acá. */
const CODIGOS_NOTA = ['56', '61'];

interface FilaAsociacion {
  clave: string;
  no_mercaderia: boolean;
  item_id: string | null;
  presentacion_compra_id: string | null;
  unidad_codigo: string | null;
  item_vivo: boolean;
  presentacion_viva: boolean;
}

/**
 * Lee una factura ya parseada en el navegador y dice qué sabe el sistema de
 * ella: quién la emitió, con qué documento, si ya está cargada y qué
 * asociaciones aprendidas calzan (spec compras-xml-dte § 5.3 y § 7). No
 * escribe nada — todas las consultas son de lectura, fijas (ninguna por
 * clave).
 */
@Injectable()
export class LecturaDteService {
  constructor(private readonly db: Db) {}

  async leer(
    tenantId: string,
    dto: LecturaDteDto,
  ): Promise<LecturaDteRespuesta> {
    const receptorEsDelTenant = await this.esReceptorDelTenant(
      tenantId,
      dto.receptorRut,
    );

    const { proveedor, candidatos } = await this.resolverProveedor(
      tenantId,
      dto,
    );

    const tipoDocumento = CODIGOS_NOTA.includes(dto.tipoDte)
      ? null
      : await this.buscarTipoDocumento(tenantId, dto.tipoDte);

    const compraExistente =
      proveedor && tipoDocumento
        ? await this.buscarCompraExistente(
            tenantId,
            proveedor.id,
            tipoDocumento.id,
            dto.folio,
          )
        : null;

    const asociaciones = proveedor
      ? await this.resolverAsociaciones(tenantId, proveedor.id, dto.claves)
      : [];

    return {
      receptorEsDelTenant,
      proveedor,
      candidatos,
      tipoDocumento,
      compraExistente,
      asociaciones,
    };
  }

  /**
   * 400 si el proveedor tiene un RUT propio y ninguno de sus dos campos
   * normaliza igual al del emisor. Con los dos vacíos, pasa: la tarea 2 lo
   * completa al guardar. La reusa `ComprasService` al guardar el borrador.
   *
   * ⚠️ El `SELECT` filtra `tipo = 'proveedor' AND activo`, no solo
   * `tenant_id`/`eliminado_el`: sin eso, un `proveedorId` que apunta a un
   * tercero del mismo tenant que no es un proveedor activo (una empresa, un
   * proveedor pausado) caía en la rama de RUT-no-calza y el 400 filtraba su
   * nombre y su RUT en el mensaje. Con el filtro, ese caso cae en el genérico
   * "Proveedor no encontrado" — mismo criterio que la segunda consulta de
   * `resolverProveedor`, más abajo.
   */
  async assertRutDelProveedor(
    tenantId: string,
    proveedorId: string,
    rutEmisor: string,
  ): Promise<void> {
    const rows: {
      nombre: string;
      rut: string | null;
      rut_fiscal: string | null;
    }[] = await this.db.query(
      `SELECT nombre, rut, rut_fiscal FROM terceros
          WHERE tenant_id = $1 AND tercero_id = $2
            AND tipo = 'proveedor' AND activo AND eliminado_el IS NULL`,
      [tenantId, proveedorId],
    );
    if (!rows.length) {
      throw new BadRequestException('Proveedor no encontrado');
    }
    const { nombre, rut, rut_fiscal: rutFiscal } = rows[0];
    const guardados = [rut, rutFiscal].filter(
      (r): r is string => !!r && r.trim() !== '',
    );
    if (!guardados.length) return;

    const emisorNormalizado = normalizarRut(rutEmisor);
    const calza = guardados.some((r) => normalizarRut(r) === emisorNormalizado);
    if (!calza) {
      throw new BadRequestException(
        `"${nombre}" tiene el RUT ${guardados[0]}; esta factura es del RUT ${rutEmisor}`,
      );
    }
  }

  private async esReceptorDelTenant(
    tenantId: string,
    receptorRut: string,
  ): Promise<boolean> {
    // `razones_sociales.rut` es texto libre, igual que `terceros.rut`: mismo
    // fallback "sin guion" que `resolverProveedor`, por la misma razón (un
    // RUT guardado sin guion no calzaría contra el normalizado, que siempre
    // lo lleva).
    const rows: unknown[] = await this.db.query(
      `SELECT 1 FROM razones_sociales
        WHERE tenant_id = $1 AND eliminado_el IS NULL
          AND upper(replace(replace(coalesce(rut, ''), '.', ''), ' ', ''))
            IN ($2, replace($2, '-', ''))
        LIMIT 1`,
      [tenantId, normalizarRut(receptorRut)],
    );
    return rows.length > 0;
  }

  private async resolverProveedor(
    tenantId: string,
    dto: LecturaDteDto,
  ): Promise<{
    proveedor: { id: string; nombre: string } | null;
    candidatos: { id: string; nombre: string }[];
  }> {
    if (dto.proveedorId) {
      await this.assertRutDelProveedor(
        tenantId,
        dto.proveedorId,
        dto.emisorRut,
      );
      const rows: { tercero_id: string; nombre: string }[] =
        await this.db.query(
          `SELECT tercero_id, nombre FROM terceros
          WHERE tercero_id = $1 AND tenant_id = $2
            AND tipo = 'proveedor' AND activo AND eliminado_el IS NULL`,
          [dto.proveedorId, tenantId],
        );
      if (!rows.length) {
        throw new BadRequestException('Proveedor no encontrado');
      }
      return {
        proveedor: { id: rows[0].tercero_id, nombre: rows[0].nombre },
        candidatos: [],
      };
    }

    const rutNormalizado = normalizarRut(dto.emisorRut);
    const rows: { tercero_id: string; nombre: string }[] = await this.db.query(
      `SELECT tercero_id, nombre FROM terceros
        WHERE tenant_id = $1 AND tipo = 'proveedor' AND activo AND eliminado_el IS NULL
          AND (
            upper(replace(replace(coalesce(rut, ''), '.', ''), ' ', ''))
              IN ($2, replace($2, '-', ''))
            OR upper(replace(replace(coalesce(rut_fiscal, ''), '.', ''), ' ', ''))
              IN ($2, replace($2, '-', ''))
          )
        ORDER BY nombre`,
      [tenantId, rutNormalizado],
    );
    if (rows.length === 1) {
      return {
        proveedor: { id: rows[0].tercero_id, nombre: rows[0].nombre },
        candidatos: [],
      };
    }
    return {
      proveedor: null,
      candidatos: rows.map((r) => ({ id: r.tercero_id, nombre: r.nombre })),
    };
  }

  private async buscarTipoDocumento(
    tenantId: string,
    codigo: string,
  ): Promise<{ id: string; nombre: string } | null> {
    const rows: { tipo_documento_compra_id: string; nombre: string }[] =
      await this.db.query(
        `SELECT td.tipo_documento_compra_id, td.nombre
           FROM tenants t
           JOIN provincia prov ON prov.provincia_id = t.provincia_id
                AND prov.eliminado_el IS NULL
           JOIN tipos_documento_compra td ON td.pais_id = prov.pais_id
                AND td.activo AND td.eliminado_el IS NULL
          WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL AND td.codigo = $2`,
        [tenantId, codigo],
      );
    if (!rows.length) return null;
    return { id: rows[0].tipo_documento_compra_id, nombre: rows[0].nombre };
  }

  private async buscarCompraExistente(
    tenantId: string,
    proveedorId: string,
    tipoDocumentoCompraId: string,
    folio: string,
  ): Promise<{
    id: string;
    estado: 'borrador' | 'confirmada';
    confirmadoEl: string | null;
  } | null> {
    const rows: {
      compra_id: string;
      estado: 'borrador' | 'confirmada';
      confirmado_el: Date | null;
    }[] = await this.db.query(
      `SELECT compra_id, estado, confirmado_el
         FROM compras
        WHERE tenant_id = $1 AND proveedor_id = $2
          AND tipo_documento_compra_id = $3 AND folio = $4
          AND estado <> 'anulada' AND eliminado_el IS NULL
        LIMIT 1`,
      [tenantId, proveedorId, tipoDocumentoCompraId, folio],
    );
    if (!rows.length) return null;
    const fila = rows[0];
    return {
      id: fila.compra_id,
      estado: fila.estado,
      confirmadoEl: fila.confirmado_el
        ? new Date(fila.confirmado_el).toISOString()
        : null,
    };
  }

  /**
   * Una consulta con `ANY`, nunca una por clave (invariante N+1). Toda clave
   * pedida sin fila viva sale con `destino: null` — hoy son todas: sin
   * escritura todavía (tarea 2), `codigos_proveedor` está siempre vacía.
   */
  private async resolverAsociaciones(
    tenantId: string,
    proveedorId: string,
    claves: string[],
  ): Promise<AsociacionDte[]> {
    const normalizadas = [...new Set(claves.map(normalizarClave))];
    if (!normalizadas.length) return [];

    const rows: FilaAsociacion[] = await this.db.query(
      `SELECT cp.clave, cp.no_mercaderia, cp.item_id, cp.presentacion_compra_id, cp.unidad_codigo,
              (i.item_id IS NOT NULL) AS item_vivo,
              (cp.presentacion_compra_id IS NULL OR pc.presentacion_compra_id IS NOT NULL) AS presentacion_viva
         FROM codigos_proveedor cp
         LEFT JOIN items i ON i.item_id = cp.item_id AND i.tenant_id = cp.tenant_id
              AND i.tipo = ANY($4::text[]) AND i.eliminado_el IS NULL
         LEFT JOIN presentaciones_compra pc ON pc.presentacion_compra_id = cp.presentacion_compra_id
              AND pc.tenant_id = cp.tenant_id AND pc.eliminado_el IS NULL
        WHERE cp.tenant_id = $1 AND cp.proveedor_id = $2 AND cp.clave = ANY($3::text[])
          AND cp.eliminado_el IS NULL`,
      [tenantId, proveedorId, normalizadas, TIPOS_CON_STOCK],
    );
    const porClave = new Map(rows.map((r) => [r.clave, r]));

    return normalizadas.map((clave) => {
      const fila = porClave.get(clave);
      if (!fila) return { clave, destino: null };
      if (fila.no_mercaderia) return { clave, destino: 'no_mercaderia' };
      if (!fila.item_vivo) {
        return {
          clave,
          destino: null,
          nota: 'el producto al que apuntaba ya no está',
        };
      }
      if (!fila.presentacion_viva) {
        return {
          clave,
          destino: null,
          nota: 'la presentación a la que apuntaba fue retirada',
        };
      }
      if (fila.presentacion_compra_id) {
        return {
          clave,
          destino: {
            itemId: fila.item_id!,
            presentacionId: fila.presentacion_compra_id,
          },
        };
      }
      return {
        clave,
        destino: { itemId: fila.item_id!, unidadCodigo: fila.unidad_codigo! },
      };
    });
  }
}
