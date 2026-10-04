import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import type { ReglasCongeladas } from '../../common/dto/reglas-congeladas.dto';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import {
  MAX_REINTENTOS_DEADLOCK,
  esDeadlock,
} from '../../common/db/reintento-deadlock';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import type {
  ConfigCalculo,
  Cuantizador,
  TrazaRegla,
} from '../calculo-precios/calculo-precios.engine';
import {
  cuantizar,
  repartirProporcional,
} from '../calculo-precios/calculo-precios.engine';
import {
  CFG_SIN_CONGELAR,
  descomponer,
  escalarDevoluciones,
  repartirAjuste,
  tasaEfectiva,
} from './nota-credito-composicion';
import { CajaService, IntentoRechazadoError } from '../caja/caja.service';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService, type ConvertirUnidad } from '../items/items.service';
import { PagosService } from '../pagos/pagos.service';
import {
  aplicadoDeVentaSql,
  puedeAbonar,
  recalcularEstadoDeLaVenta,
  saldoDeVentaSql,
} from './saldo-venta';
import {
  VentaDocumentosService,
  type DocumentoDetalle,
  type ViaCorreccion,
} from '../venta-documentos/venta-documentos.service';
import type {
  ClaseDocumentoMaquina,
  EmisorDocumento,
} from '../venta-documentos/entities/venta-documento.entity';
import type { Facturador } from '../tenants/entities/tenant.entity';
import { VentaPropinaService } from '../propinas/venta-propina.service';
import { EstrategiaAsignacionPropina } from '../propinas/enums/estrategia-asignacion-propina.enum';
import { PropinaConfiguracion } from '../propinas/entities/propina-configuracion.entity';
import { CatalogService } from '../catalog/catalog.service';
import { GarzonesService } from '../garzones/garzones.service';
import { UbicacionesService } from '../ubicaciones/ubicaciones.service';
import {
  assertPresentacionPareada,
  resolverCantidadDesdePresentacion,
  resolverUnidadBaseDeItem,
} from '../../common/utils/cantidad-presentacion.util';
import type { CreateVentaDto, CustomerVentaDto } from './dto/create-venta.dto';
import type { ReceptorNotaCreditoDto } from './dto/create-nota-credito.dto';
import type { FiltroDocumento, QueryVentasDto } from './dto/query-ventas.dto';
import { Venta, EstadoVenta } from './entities/venta.entity';
import { VentaDetalle } from './entities/venta-detalle.entity';
import { VentaDescuento } from './entities/venta-descuento.entity';
import { VentaRecargo } from './entities/venta-recargo.entity';
import { VentaImpuesto } from './entities/venta-impuesto.entity';
import { VentaPromocion } from './entities/venta-promocion.entity';
import { VentaCustomer } from './entities/venta-customer.entity';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import {
  detallePersonalizacion,
  type PersonalizacionRecetaSnapshot,
} from '../../common/utils/personalizacion-receta.util';
import {
  IdempotenciaService,
  type SolicitudIdempotenteInput,
} from '../idempotencia/idempotencia.service';
import { huellaDe } from '../idempotencia/huella';
import { normalizarRut, rutValido } from '../../common/utils/rut.util';

/**
 * El país cuyas reglas del receptor están escritas: el receptor completo de la
 * Factura y el RUT con DV módulo 11 (`receptorDeLaVenta`). Los demás países
 * están en pausa hasta terminar Chile.
 */
const CODIGO_ISO_CHILE = 'CL';

/**
 * El umbral de la Res. Ex. SII 44/2025 que rige hoy para el país `p` (alias de
 * `pais`), con el año en la zona de la provincia `prov` (el mismo criterio que
 * `diaNegocioTenant`, sin hora de corte: es año calendario). Sin fila del año,
 * rige la del último anterior: la ley dice que el monto *"se mantendrá"*
 * mientras no se dicte otro. Un país sin filas da `NULL`: no tiene la regla.
 * Subconsulta escalar para sumarla a la lectura que ya pasa por el país, sin
 * una consulta más.
 */
const UMBRAL_IDENTIDAD_SQL = `(SELECT u.monto
     FROM umbral_identidad_pagador u
    WHERE u.pais_id = p.pais_id AND u.eliminado_el IS NULL
      AND u.anio <= EXTRACT(YEAR FROM now() AT TIME ZONE prov.zona_horaria)
    ORDER BY u.anio DESC
    LIMIT 1)`;

/** El umbral en pesos como lo lee el cajero: `$5.363.274,60`. Sin `number`: es plata. */
function montoUmbral(umbral: string): string {
  const [entero, decimales] = new Decimal(umbral).toFixed(2).split('.');
  return `$${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimales}`;
}

/**
 * Por qué una boleta no puede salir sin quien paga, o `null` si puede (Res. Ex.
 * SII 44/2025, art. 92 ter del Código Tributario; spec
 * `2026-10-04-identidad-del-pagador-sobre-135-uf`). Sobre el umbral —estricto:
 * la norma dice *"exceda"*— la boleta lleva nombre y RUT de quien paga. Mide la
 * operación entera (`total_final`, ya en moneda oficial, sin propina ni
 * vuelto): el 92 ter prohíbe fraccionar, así que nunca se mide por pago. La
 * Factura no pasa por acá: lleva su receptor completo y el 92 ter la acepta.
 * El RUT ya llega validado y normalizado por `receptorDeLaVenta`.
 *
 * No obliga a emitir nada —eso sigue siendo del comercio (PRODUCTO § 10)—:
 * captura un dato que después no se recupera (ADR-010; owner, 2026-10-04).
 */
export function faltaIdentidadDelPagador(args: {
  esBoleta: boolean;
  umbral: string | null;
  totalFinal: string;
  customer: { nombre?: string; rut?: string } | undefined;
}): string | null {
  if (!args.esBoleta || args.umbral === null) return null;
  if (!new Decimal(args.totalFinal).gt(args.umbral)) return null;
  if (args.customer?.nombre?.trim() && args.customer.rut?.trim()) return null;
  return (
    `Una boleta de más de ${montoUmbral(args.umbral)} lleva el nombre y el ` +
    'RUT de quien paga (Res. Ex. SII 44/2025)'
  );
}

/**
 * Ítem/cantidad que se acredita en una nota de crédito. Ya NO es "ítem a
 * devolver a stock": desde el 2026-09-04 cualquier ítem vendido se acredita por
 * línea y la reposición es una propiedad de la línea, no un requisito para
 * nombrarla.
 */
export interface DevolucionReembolso {
  itemId: string;
  cantidad: string;
  /** Ausente = repone si el ítem puede. Ver `DevolucionNotaCreditoDto`. */
  reponerStock?: boolean;
}

/**
 * Una corrección es lo que apunta a la venta que corrige (`venta_referencia_id`,
 * E7). `esNotaCredito` es una corrección **con tipo NC**: falso en la
 * devolución interna, que no es un documento tributario y lleva el tipo nulo.
 * Un solo lugar para el listado y el detalle: que los dos digan lo mismo.
 */
function flagsDeCorreccion(r: {
  venta_referencia_id: string | null;
  tipo_documento_id: string | null;
}): { esCorreccion: boolean; esNotaCredito: boolean } {
  const esCorreccion = r.venta_referencia_id !== null;
  return {
    esCorreccion,
    esNotaCredito: esCorreccion && r.tipo_documento_id !== null,
  };
}

/**
 * Los documentos que valen de la venta `v`. Los descartados (la venta se anuló,
 * E8/E10) y los dados de baja no cuentan: ni para filtrar ni para resumir. Es
 * el único lugar que lo dice, así el filtro y el resumen no se separan.
 */
const DOCUMENTO_VIGENTE = `d.venta_id = v.venta_id AND d.tenant_id = v.tenant_id
                  AND d.descarte IS NULL AND d.eliminado_el IS NULL`;

/**
 * Qué pide cada valor de `?documento=` sobre un documento vigente `d`. "Sin
 * número" mira solo a la máquina y al facturador de afuera: el sistema todavía
 * no folia (ADR-010) y una fila `nadie` no lleva número. El voucher duplicado
 * no vuelve a una venta "de la máquina" por sí solo, pero sí cuenta sin número:
 * también se completa (`PATCH /documentos/:id`). El valor ya pasó por el DTO:
 * ningún texto del cliente llega al SQL.
 */
const CONDICION_DOCUMENTO: Record<FiltroDocumento, string> = {
  sistema: `d.emisor = 'sistema'`,
  maquina: `d.emisor = 'maquina' AND NOT d.es_duplicado`,
  externo: `d.emisor = 'externo'`,
  sin_numero: `d.emisor IN ('maquina', 'externo') AND NULLIF(btrim(d.numero), '') IS NULL`,
  sin_documento: `d.emisor = 'nadie'`,
  duplicado: `d.es_duplicado`,
};

/** Lo que la agregación de documentos devuelve por fila (`jsonb`, ya parseado por el driver). */
interface DocumentosResumenRow {
  emisores: EmisorDocumento[];
  tieneDuplicado: boolean;
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
  /** Es una corrección (`venta_referencia_id`): una NC o una devolución interna. */
  esCorreccion: boolean;
  /** Corrección que lleva el tipo NC: falso en la devolución interna (tipo nulo). */
  esNotaCredito: boolean;
  /**
   * Quién emitió lo vigente de esta fila (sin los descartados), sin repetir y
   * ordenado. El voucher duplicado de un abono (E1b) no cuenta como emisor:
   * se avisa aparte en `tieneDuplicado`, así el resumen dice lo mismo que el
   * filtro `documento=maquina`.
   */
  emisores: EmisorDocumento[];
  /** Tiene un voucher duplicado vigente (la deuda ya estaba documentada). */
  tieneDuplicado: boolean;
}

export interface VentasResumen {
  /** Ventas, sin las correcciones ni las canceladas. */
  totalVentas: number;
  /** `totalBruto − totalNotasCredito`. */
  totalFacturado: string;
  totalBruto: string;
  totalNotasCredito: string;
  /** Σ del saldo de cada venta (descuenta sus correcciones, piso 0). */
  saldoPendiente: string;
}

/**
 * Params de la NC. Con nombre (y no inline en la firma) desde que el cuerpo se
 * partió en dos: `crearNotaCredito` envuelve y `crearNotaCreditoEnTransaccion`
 * ejecuta, y repetir el literal en las dos firmas las deja derivar en silencio.
 */
export interface CrearNotaCreditoParams {
  tenantId: string;
  /**
   * `null` solo en el reembolso por la API externa (llave de API, sin usuario).
   * Sirve para el movimiento de stock (`usuario_id` nulo); mover caja exige
   * usuario y esa rama nunca corre para la vía `pasarela`.
   */
  usuarioId: string | null;
  ventaOriginalId: string;
  monto: string;
  devoluciones?: DevolucionReembolso[];
  comentario?: string;
  /**
   * Quién recibe la nota cuando la venta no tiene customer (lo capturó el cajero).
   * Con customer en la venta la nota lleva ese y mandar otro es 400; sin ninguno
   * de los dos, la nota con tipo va a nombre del emisor (`receptorEsEmisor`).
   */
  receptor?: ReceptorNotaCreditoDto;
  /**
   * Por dónde vuelve la plata; de acá sale el documento que corrige la nota
   * (`VentaDocumentosService.documentoQueCorrige`). Con un pago en efectivo hay
   * un movimiento 'salida' en la caja física abierta del usuario.
   */
  via: ViaCorreccion;
  /** Solo el endpoint manual: exige venta pagada/pagada_parcial, o pendiente con la vía `sin_plata`. */
  validarVentaElegible?: boolean;
  /**
   * Lo último que corre dentro de la transacción de la nota, antes del commit,
   * con su `manager` y su id. Si lanza, la nota se revierte. Lo usa el reembolso
   * de la pasarela para ligar el REFUND (`ReembolsoAprobadoEvento.ligarCorreccion`).
   */
  enLaTransaccion?: (
    manager: EntityManager,
    correccionVentaId: string,
  ) => Promise<void>;
  /**
   * La `Idempotency-Key` de la nota manual, ya con su huella: el reintento
   * reproduce la nota que entró en vez de emitir otra (ADR-026). El reembolso
   * de la pasarela no la pasa: no hay operador que reintente, y su nota ya es
   * una sola por REFUND (`correccion_venta_id`).
   */
  idempotencia?: SolicitudIdempotenteInput;
}

/** El 422 de la nota reintentada con otro monto, otro medio u otras devoluciones. */
export const MENSAJE_NOTA_CREDITO_OTROS_DATOS =
  'Esta nota de crédito ya se había emitido con otros datos. Revisá la venta antes de emitir otra.';

export interface NotaCreditoCreada {
  id: string;
  totalFinal: string;
  movimientoCajaId: string | null;
  fecha: Date;
  comentario: string | null;
  devoluciones: DevolucionReembolso[];
}

export interface TipoDocumentoResponse {
  id: string;
  nombre: string;
  codigo: string | null;
  customerRequerido: boolean;
  /** La boleta del país: lo que la pantalla elige por defecto. Ver `resolverTipoDocumento`. */
  esBoleta: boolean;
  /**
   * Exige el receptor tributario completo (RUT, razón social, giro, dirección y
   * comuna). La pantalla no conoce el país: el servidor le dice qué regla de
   * `receptorDeLaVenta` aplica a este tipo.
   */
  receptorCompleto: boolean;
  /** El RUT del customer se valida con DV módulo 11. Ver `receptorDeLaVenta`. */
  rutChileno: boolean;
  /**
   * Sobre este total la boleta lleva nombre y RUT de quien paga
   * (`faltaIdentidadDelPagador`). Solo en la boleta de un país con la regla;
   * `null` en los demás tipos.
   */
  umbralIdentidad: string | null;
}

/**
 * Lo que una línea de cuenta de salón congeló al pedirse. Ver el parámetro
 * `lineasCongeladas` de `crearEnTransaccion`: es un canal **interno**, nunca un
 * campo de DTO, porque lleva plata ya resuelta.
 */
export interface LineaCongelada {
  personalizacion: PersonalizacionRecetaSnapshot | null;
  /** Ya en moneda oficial y ya redondeado con el `modo_redondeo` del tenant. */
  precioUnitario: string;
  /** El mismo precio en la moneda del ítem, y la tasa que los une. Van los tres
   *  o `venta_detalles` guarda una trazabilidad que se contradice. */
  precioUnitarioOrigen: string;
  tasaCambio: string;
  reglasCongeladas: ReglasCongeladas;
}

/**
 * Payload de la boleta, armado desde la venta YA PERSISTIDA — nunca desde el
 * motor de cálculo. Un solo tipo para los dos caminos que la producen: el
 * cierre (`SalonesService.cerrarCuenta`, dentro de la misma transacción) y la
 * reimpresión (`GET /ventas/:id/boleta`, fuera de transacción).
 *
 * Los nombres de `totales` son los de `TicketTotales` del frontend
 * (`frontend/app/utils/ticket-builder.ts:151-157`), no los de la fila de
 * `ventas` (`total_bruto`, `total_descuentos`…): el mapeo lo hace
 * `armarBoleta`, una sola vez, y no cada pantalla que imprime.
 *
 * Ver `docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md`.
 */
export interface BoletaVenta {
  ventaId: string;
  fecha: Date;
  canal: string;
  /**
   * Lo lee la reimpresión: una venta `cancelada` sale marcada `ANULADA`, y
   * `reimprimirBoleta` rechaza la que todavía no se cobró del todo.
   */
  estado: EstadoVenta;
  mesa: string | null;
  cuentaNumero: number | null;
  cajero: string | null;
  items: {
    descripcion: string;
    cantidad: string;
    cantidadPresentacion: string | null;
    unidadCodigoPresentacion: string | null;
    unidadCodigoBase: string;
    precioUnitario: string;
    totalLinea: string;
    /**
     * Gemelo deliberado de `PersonalizacionDetalleLinea`
     * (`frontend/app/utils/ticket-builder.ts:110-115`): misma forma, sin
     * fraseo. El texto ("Sin X" / "Extra X xN", con los prefijos `- `/`+ ` y
     * el monto alineado) lo arma `lineasPersonalizacionPreciada` allá
     * (`:122-138`), que es quien ya lo hace para la precuenta — mandarlo
     * fraseado desde acá le daría dos dueños al mismo renglón.
     */
    personalizacionDetalle?: {
      nombre: string;
      tipo: 'omitido' | 'extra';
      unidades?: number;
      monto: string;
    }[];
    comentario?: string;
  }[];
  totales: {
    subtotalNeto: string;
    totalDescuentos: string;
    totalRecargos: string;
    totalImpuestos: string;
    totalFinal: string;
  };
  impuestos: { nombre: string; tasa: string; monto: string }[];
  promociones: { id: string; nombre: string; monto: string }[];
  customer: {
    nombre: string;
    rut: string | null;
    direccion: string | null;
  } | null;
  propina: { monto: string } | null;
  pagos: { nombre: string; monto: string }[];
  vuelto: string | null;
}

@Injectable()
export class VentasService {
  private readonly logger = new Logger(VentasService.name);

  constructor(
    private readonly db: Db,
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly cajaService: CajaService,
    private readonly inventarioService: InventarioService,
    private readonly itemsService: ItemsService,
    private readonly pagosService: PagosService,
    private readonly ventaDocumentosService: VentaDocumentosService,
    private readonly ventaPropinaService: VentaPropinaService,
    private readonly catalogService: CatalogService,
    private readonly garzonesService: GarzonesService,
    private readonly ubicacionesService: UbicacionesService,
    private readonly idempotencia: IdempotenciaService,
  ) {}

  /**
   * Reintenta la venta completa ante un deadlock de Postgres (`40P01`).
   *
   * Los `FOR UPDATE` de inventario se toman en un orden que depende de la
   * expansión de cada línea (ingredientes de una receta, componentes de un
   * combo, opciones de grupo). Cada expansión ordena por id, pero el orden
   * GLOBAL de una venta es *(orden de línea) × (orden dentro de la línea)*, y
   * eso no es un orden ascendente global: A vendiendo `RecetaX(ing3, ing5)`
   * bloquea 3→5, mientras que B vendiendo `[RecetaY(ing5), RecetaZ(ing3)]`
   * bloquea 5→3. Ciclo, y Postgres aborta una de las dos.
   *
   * Reintentar es seguro **porque el deadlock aborta la transacción entera**:
   * Postgres revierte todo lo escrito antes de devolver el error, así que no
   * hay venta, ni movimientos, ni pagos, ni movimiento de caja a medio hacer.
   * No es idempotencia: acá no hay nada que deduplicar porque no quedó nada.
   * La idempotencia es `clave` (abajo), y convive con este loop: el rollback de
   * un intento con deadlock suelta también el reclamo de la clave, así que el
   * siguiente intento la vuelve a reclamar como si fuera el primero.
   *
   * Cubre además los ciclos que no vienen de la expansión (series, lotes,
   * caja). Solo `40P01`: cualquier otro error se propaga sin reintentar, para
   * no convertir un fallo de negocio en tres intentos silenciosos.
   *
   * ⚠️ Precondición: **nunca llamar a `crear()` desde dentro de una
   * transacción ya abierta.** `Db.transaccion` reusa el manager si ya hay uno
   * en contexto (ver `db.service.ts`), así que un `crear()` anidado NO abre
   * una transacción nueva que reintentar — reintentaría sobre la MISMA
   * transacción externa, y si esa transacción abortó (deadlock), los tres
   * intentos fallarían igual con `25P02` ("current transaction is aborted")
   * en vez de un reintento útil. Verificado 2026-08-18: los únicos
   * llamadores son `VentasController` y `OnlineCallbackHandler`, ninguno con
   * transacción envolvente. Un caller que SÍ corre dentro de una transacción
   * (p.ej. `SalonesService`/`SuscripcionesService` al cerrar una cuenta) debe
   * llamar a `crearEnTransaccion(manager, …)` directamente, saltándose este
   * loop — exactamente lo que hacen hoy.
   */
  async crear(
    tenantId: string,
    usuarioId: string,
    dto: CreateVentaDto,
    /**
     * La `Idempotency-Key` del intento de cobro: con la misma clave, el
     * reintento reproduce la venta ya creada en vez de crear otra
     * (`IdempotenciaService.ejecutar`). La ruta HTTP la exige siempre; es
     * opcional acá solo por `OnlineCallbackHandler` (Webpay), que no pasa por
     * HTTP y ya es idempotente por orden (ADR-009).
     */
    clave?: string,
  ) {
    for (let intento = 0; ; intento++) {
      try {
        return await this.db.transaccion(async (manager) => {
          const cobrar = async () => {
            const venta = await this.crearEnTransaccion(
              manager,
              tenantId,
              usuarioId,
              dto,
            );
            // `verTodas: true`, mismo porqué que `SalonesService.cerrarCuenta`:
            // el alcance por caja de `armarBoleta` (`filtroDeMisCajas`) existe
            // para que nadie navegue ventas de una caja ajena, no para
            // esconderle a quien la creó la venta que esta misma request acaba
            // de cobrar. Se arma con el `manager` de la transacción para leer
            // la venta recién insertada, todavía sin commitear.
            const boleta = await this.armarBoleta(
              manager,
              tenantId,
              venta.id,
              usuarioId,
              true,
            );
            return { ...venta, boleta };
          };
          return clave
            ? this.idempotencia.ejecutar(
                {
                  tenantId,
                  usuarioId,
                  clave,
                  operacion: 'venta.crear',
                  huella: huellaDe('venta.crear', dto),
                },
                cobrar,
                (r) => r.id,
              )
            : cobrar();
        });
      } catch (error) {
        if (intento >= MAX_REINTENTOS_DEADLOCK || !esDeadlock(error))
          throw error;
      }
    }
  }

  async crearEnTransaccion(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    dto: CreateVentaDto,
    // La cuenta cuyo instante de apertura decide la vigencia. Va como parámetro
    // y NO en `CreateVentaDto` a propósito: en el body, un cliente podría dejar
    // una cuenta abierta en diciembre y mandar su id en marzo para cobrar con
    // la promo de verano. Solo `salones.cerrarCuenta` lo pasa.
    cuentaId?: string,
    /**
     * **Lo que cada línea de la cuenta congeló al pedirse**: su personalización
     * ya resuelta, su precio unitario (en moneda oficial) y las reglas de
     * catálogo que regían en ese momento. Posicional, 1:1 con `dto.lineas` y en
     * el mismo orden — que es el mismo contrato de orden del que ya depende
     * `instantesDeLineas`.
     *
     * Va como parámetro y **no** en el DTO por la misma razón que `cuentaId`,
     * pero más fuerte: lleva plata. Un cliente que pudiera mandar esto se
     * cobraría lo que quisiera. Solo `salones.cerrarCuenta` lo pasa, leyendo lo
     * que el servidor congeló.
     *
     * Cuando viene, esta venta **no re-resuelve la personalización** (que es lo
     * que rompía la mesa cuando la carta cambiaba), **ni re-precia, ni re-lee
     * los descuentos y recargos**.
     *
     * ⚠️ Lo que **sí** sigue saliendo del catálogo vivo, medido: los impuestos y
     * `precio_incluye_impuesto` del ítem. Los primeros porque son fiscales
     * (ADR-010); el segundo porque decide cómo se interpreta el precio frente al
     * impuesto y linda con lo mismo. Togglear `precio_incluye_impuesto` con la
     * mesa sentada **sí** mueve lo que paga, sin mover el precio congelado. Es
     * defendible, pero no es "no vuelve al catálogo para nada".
     */
    lineasCongeladas?: (LineaCongelada | undefined)[],
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
    if (caja.estado !== 'abierta') {
      throw new BadRequestException(
        'La caja está en conciliación y no admite ventas',
      );
    }
    // Lock pesimista sostenido hasta el commit. `findActiva` lee por repositorio
    // —desde ADR-020 eso ES el manager de esta transacción— pero SIN lock, y
    // bajo READ COMMITTED un cierre que commitea después no se ve: el chequeo de
    // arriba no garantiza nada. Un cierre puede commitear mientras se procesan ítems,
    // precios e inventario, y el INSERT en `movimientos_caja` del final no
    // revalida el estado — el movimiento caería en una caja ya cerrada cuyo
    // arqueo ya quedó congelado. La caja virtual NO se bloquea: nunca se cierra
    // (una por tenant, siempre abierta) y el lock serializaría todas las ventas
    // online del tenant sin proteger de nada.
    if (canal !== 'online') {
      await this.cajaService.bloquearCajaAbierta(manager, caja.id, tenantId);
    }

    // 1b. El tipo de documento de la venta lo decide el servidor, y se resuelve
    //     acá —antes de cargar ítems y calcular— para que un tipo inválido falle
    //     sin haber hecho trabajo. `esBoleta` lo consume la emisión.
    //     También valida el receptor, y lo que se guarda en `venta_customer`
    //     es el customer que devuelve, normalizado, no el del body.
    const tipoDocumento = await this.resolverTipoDocumento(
      manager,
      tenantId,
      dto.tipoDocumentoId,
      canal,
      dto.customer,
    );

    // 2. Cargar todos los items para obtener monedaId, tipo, nombre.
    // UNA query para todo el carrito: `findOne` por línea disparaba 4+ queries
    // por ítem construyendo impuestos, recargos, descuentos, ingredientes y
    // grupos que la venta nunca lee. Ver `cargarBasePorIds`.
    const itemsPorId = await this.itemsService.cargarBasePorIds(
      tenantId,
      dto.lineas.map((l) => l.itemId),
    );
    const items = dto.lineas.map((l) => itemsPorId.get(l.itemId)!);

    for (const item of items) {
      if (item.tipo === 'ingrediente') {
        throw new BadRequestException(
          'Los ingredientes no se pueden vender directamente',
        );
      }
      // `clasificacion_tributaria` es nullable desde ADR-018 (los ingredientes
      // van NULL: no se venden, no tienen tratamiento fiscal). Rellenar el
      // snapshot con 'afecto' haría que `venta_detalles` mienta: el motor ya
      // decidió el IVA con la condición positiva `=== 'afecto'`, así que un
      // NULL cobró IVA cero mientras la línea guardada diría "afecto" — sin
      // excepción ni log, indetectable por auditoría. Se rechaza en vez de
      // inventar el dato, y acá arriba para no escribir nada antes de fallar.
      if (item.clasificacionTributaria === null) {
        throw new BadRequestException(
          `El ítem "${item.nombre}" no tiene clasificación tributaria: no se puede vender`,
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

      // Se resuelve para TODA línea, no solo las que vienen por presentación:
      // es la unidad en la que queda `cantidad`, y se congela en el detalle.
      const { unidadBaseCodigo, forzarConteo } = resolverUnidadBaseDeItem(item);

      if (!linea.cantidadPresentacion || !linea.unidadCodigoPresentacion) {
        return {
          cantidadCanonica: linea.cantidad,
          cantidadPresentacion: null as string | null,
          unidadCodigoPresentacion: null as string | null,
          unidadBaseCodigo,
        };
      }

      const res = resolverCantidadDesdePresentacion({
        cantidadPresentacion: linea.cantidadPresentacion,
        unidadCodigoPresentacion: linea.unidadCodigoPresentacion,
        unidadBaseCodigo,
        catalogo,
        forzarConteo,
      });

      return {
        cantidadCanonica: res.cantidadCanonica,
        cantidadPresentacion: res.cantidadPresentacion,
        unidadCodigoPresentacion: res.unidadCodigoPresentacion,
        unidadBaseCodigo,
      };
    });

    // 2b. Unidades con número de serie: quien vende elige cuáles salen. Se
    //     valida acá, con el `modo_inventario` que ya trajo `cargarBasePorIds`
    //     (cero consultas) y antes de cualquier escritura, para que un carrito
    //     mal armado no llegue a tocar stock. El chokepoint de inventario vuelve
    //     a validar pertenencia, estado, ubicación y apartado bajo lock.
    const unidadesVistas = new Set<string>();
    for (const [i, linea] of dto.lineas.entries()) {
      const item = items[i];
      const unidadIds = linea.unidadIds ?? [];
      if (item.modoInventario !== 'serie') {
        if (unidadIds.length > 0) {
          throw new BadRequestException(
            `«${item.nombre}» no tiene número de serie: no lleva unidades`,
          );
        }
        continue;
      }
      if (unidadIds.length === 0) {
        throw new BadRequestException(
          `Elegí qué unidades salen: «${item.nombre}» tiene número de serie`,
        );
      }
      // Misma regla y texto que la merma: una unidad serializada no se parte ni
      // se vende por presentación.
      if (
        linea.unidadCodigoPresentacion &&
        linea.unidadCodigoPresentacion !==
          cantidadesResueltas[i].unidadBaseCodigo
      ) {
        throw new BadRequestException(
          'Los productos por serie o lote solo admiten su unidad base',
        );
      }
      const cantidad = new Decimal(cantidadesResueltas[i].cantidadCanonica);
      if (!cantidad.isInteger() || !cantidad.equals(unidadIds.length)) {
        throw new BadRequestException(
          `«${item.nombre}»: la cantidad (${cantidad.toString()}) no coincide con las unidades elegidas (${unidadIds.length})`,
        );
      }
      for (const uid of unidadIds) {
        // En minúsculas: un UUID en mayúsculas es la misma unidad.
        const clave = uid.toLowerCase();
        if (unidadesVistas.has(clave)) {
          throw new BadRequestException(
            'Una unidad viene repetida en la venta',
          );
        }
        unidadesVistas.add(clave);
      }
    }

    // 3. Resolver la moneda oficial del tenant: la de su PAÍS (ADR-005). Se
    //    trae junto con las demás para armar el mapa de tasas de una sola
    //    consulta.
    //
    //    ⚠️ **La consulta arranca en `tenants`, no en `tenant_moneda`**, y es la
    //    misma forma que `MonedasService.findMonedas`. Con un `INNER JOIN` sobre
    //    `tenant_moneda` la venta dependía de que existiera una fila para la
    //    oficial —que hoy siembra el alta del tenant— mientras que los otros dos
    //    caminos que resuelven "oficial" (`decimalesOficiales` y el reparto de
    //    propinas) no la necesitan. Esa asimetría es una versión chica del
    //    problema que ADR-021 vino a eliminar, así que no se deja.
    const monedaRows: {
      moneda_id: string;
      valor_del_dia: string | null;
      es_oficial: boolean;
      decimales: number | string;
      facturador: Facturador;
    }[] = await this.db.query(
      // `t.facturador` viaja en esta misma consulta (que ya arranca en
      // `tenants`) para que la emisión no cueste una lectura más. Es del
      // tenant: sale repetido en cada fila de moneda.
      `SELECT m.moneda_id, tm.valor_del_dia, m.decimales, t.facturador,
              (m.moneda_id = p.moneda_oficial_id) AS es_oficial
         FROM tenants t
         JOIN provincia prov ON prov.provincia_id = t.provincia_id
              AND prov.eliminado_el IS NULL
         JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
         JOIN pais_moneda pm ON pm.pais_id = p.pais_id AND pm.eliminado_el IS NULL
         JOIN moneda m ON m.moneda_id = pm.moneda_id AND m.eliminado_el IS NULL
         LEFT JOIN tenant_moneda tm ON tm.tenant_id = t.tenant_id
              AND tm.moneda_id = m.moneda_id AND tm.eliminado_el IS NULL
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId],
    );
    const monedaOficial = monedaRows.find((r) => r.es_oficial);
    if (!monedaOficial) {
      throw new BadRequestException(
        'El tenant no tiene moneda oficial configurada',
      );
    }
    const monedaOficialId = monedaOficial.moneda_id;

    // Mapa de monedaId → valor_del_dia para conversión
    const tasaMap = new Map(
      // La tasa de la oficial se pisa con 1, igual que en `findMonedas`: es la
      // moneda a la que se convierte, así que su tasa contra sí misma no puede
      // ser otra cosa. Leerla cruda de la fila hacía que este camino y el del
      // motor pudieran armar mapas distintos para la misma venta.
      monedaRows.map((r) => [
        r.moneda_id,
        r.es_oficial ? '1' : (r.valor_del_dia ?? '1'),
      ]),
    );

    /**
     * **Secuencial a propósito.** Los dos `resolver…` consultan con el `manager`
     * de la transacción, o sea un único `pg.Client`: con dos o más líneas de
     * receta o combo, un `Promise.all` dispara consultas concurrentes sobre ese
     * cliente y node-postgres las encola igual. En `pg@9` la segunda **tira** en
     * vez de esperar.
     *
     * **Costo cero, y está medido por este mismo proyecto** al cerrar el N+1 de
     * la personalización el 2026-08-20: *"el `Promise.all` corre sobre el manager
     * de la transacción, o sea una sola conexión, y `pg` las encola. Son viajes
     * en serie."* Ya corrían en serie; lo único que cambia es la vía, de una
     * anunciada como removida a una soportada. Ninguna consulta se agrega: el
     * conteo por venta es el mismo que dejó aquella tanda.
     *
     * Gemelo del arreglo de `calculo-precios.service.ts` del 2026-08-21, en el
     * mismo `POST /ventas` — ver `docs/agent/resueltos.md`.
     */
    const personalizaciones: (
      | Awaited<ReturnType<ItemsService['resolverPersonalizacionReceta']>>
      | Awaited<ReturnType<ItemsService['resolverPersonalizacionCombo']>>
      | null
    )[] = [];
    for (const [i, linea] of dto.lineas.entries()) {
      const item = items[i];
      const congelada = lineasCongeladas?.[i];
      if (congelada) {
        // Lo pedido se cobra como se pidió: la personalización ya la resolvió y
        // la validó `agregarLinea`, y el precio ya está calculado y convertido.
        // Volver a resolverla acá es lo que rompía la mesa cuando el catálogo
        // cambiaba —el extra que se sacó, el grupo que se hizo obligatorio— y lo
        // que le movía el precio sin avisarle a nadie.
        personalizaciones.push(
          congelada.personalizacion
            ? { snapshot: congelada.personalizacion, precioExtraTotal: '0' }
            : null,
        );
      } else if (item.tipo === 'receta') {
        personalizaciones.push(
          await this.itemsService.resolverPersonalizacionReceta(
            manager,
            tenantId,
            item.id,
            linea.personalizacion,
          ),
        );
      } else if (item.tipo === 'combo') {
        personalizaciones.push(
          await this.itemsService.resolverPersonalizacionCombo(
            manager,
            tenantId,
            item.id,
            linea.personalizacion,
          ),
        );
      } else {
        personalizaciones.push(null);
      }
    }

    // 4. Construir DTO para el motor de precios con precios ya convertidos a moneda oficial
    //
    // La config del tenant se carga ACÁ y no dentro de `calcular` porque la
    // conversión de abajo también redondea, y tiene que hacerlo con el mismo
    // `modo_redondeo` que el motor. Se le pasa después por `configPrecargada`:
    // son las mismas dos consultas de siempre, movidas unas líneas más arriba, no
    // dos consultas nuevas. `decimalesMoneda` sale del `JOIN` de arriba —tampoco
    // es una consulta nueva—, así que `cargarConfig` no vuelve a resolver la
    // moneda oficial por su cuenta.
    const configCalculo = await this.calculoPreciosService.cargarConfig(
      tenantId,
      Number(monedaOficial.decimales),
    );

    const lineasConversion = dto.lineas.map((linea, i) => {
      const item = items[i];
      const pers = personalizaciones[i];
      const {
        cantidadCanonica,
        cantidadPresentacion,
        unidadCodigoPresentacion,
        unidadBaseCodigo,
      } = cantidadesResueltas[i];
      const tasa = new Decimal(tasaMap.get(item.monedaId) ?? '1');
      // Este `.toFixed(4)` NO redondea nunca, y por eso no toma `modo_redondeo`:
      // suma dos strings que ya vienen con 4 decimales exactos. `precio_base` es
      // `NUMERIC(18,4)`, y `precioExtraTotal` sale ya redondeado de
      // `items.service.ts` (`resolverPersonalizacionReceta`, `resolverGruposDeItem`
      // y `resolverPersonalizacionCombo`, los tres con su propio `toFixed(4)`).
      // Acá solo se formatea.
      //
      // Si algún día las unidades de un extra admiten fracción —hoy se rechazan—,
      // el redondeo real va a ocurrir **en esos tres `toFixed` de
      // `items.service.ts`**, no acá: esta línea va a seguir sin redondear. El
      // modo hay que dárselo allá.
      // Sin `??`: desde el 2026-08-30 no hay override que preferirle al catálogo.
      // `LineaVentaDto` tenía un `precioUnitario` opcional que esta línea
      // honraba, pero no lo alimentaba ningún cliente —`toVentaLineasBody` del
      // POS no lo incluye, la tienda lo evita a propósito (`online.service.ts`)
      // y `cerrarCuenta` arma el body en el servidor— y era el segundo canal por
      // el que un precio podía entrar desde afuera. El primero era el
      // `precioUnitario` de `LineaDto`, que salió en el mismo commit.
      const precioOrigen =
        lineasCongeladas?.[i]?.precioUnitarioOrigen ??
        (pers != null
          ? new Decimal(item.precioBase).plus(pers.precioExtraTotal).toFixed(4)
          : item.precioBase);
      // La conversión sí redondea, y es la que se persiste en
      // `venta_detalles.precio_unitario`. Comparte función con la
      // previsualización: si las dos no redondean igual, el POS muestra un precio
      // y la venta guarda otro.
      // El congelado gana: ya está en moneda oficial y ya se redondeó con el
      // `modo_redondeo` del tenant cuando se pidió la línea.
      const precioConvertido =
        lineasCongeladas?.[i]?.precioUnitario ??
        this.calculoPreciosService.convertirAMonedaOficial(
          precioOrigen,
          item.monedaId,
          tasaMap,
          configCalculo.modoRedondeo,
        );
      return {
        linea,
        item,
        cantidadCanonica,
        cantidadPresentacion,
        unidadCodigoPresentacion,
        unidadBaseCodigo,
        precioOrigen,
        tasa: lineasCongeladas?.[i]?.tasaCambio ?? tasa.toFixed(6),
        precioConvertido,
        personalizacion: pers?.snapshot ?? null,
      };
    });

    const calcularDto = {
      lineas: lineasConversion.map(
        ({ linea, precioConvertido, cantidadCanonica }, i) => ({
          itemId: linea.itemId,
          cantidad: cantidadCanonica,
          // Canal interno del motor, no un override del cliente: el precio ya
          // está convertido a moneda oficial y la personalización ya está
          // resuelta acá arriba (para el snapshot y el stock). Sin esto
          // `calcular` la resolvería de nuevo y esta venta pagaría las
          // consultas dos veces. Ver `LineaCalculo` en `calcular.dto.ts`.
          precioUnitarioResuelto: precioConvertido,
          reglasCongeladas: lineasCongeladas?.[i]?.reglasCongeladas,
          descuentoIds: linea.descuentoIds,
          recargoIds: linea.recargoIds,
          impuestoIds: linea.impuestoIds,
        }),
      ),
      metodoPagoId: dto.metodoPagoId,
      descuentosVentaIds: dto.descuentosVentaIds,
      recargosVentaIds: dto.recargosVentaIds,
      cuentaId,
      // El canal REAL de la venta, no el que pudo venir en una
      // previsualización: es lo que filtra las promos que rigen en un solo
      // canal. Mismo criterio que `cuentaId` — lo pone el servidor.
      canal,
    };

    // 5. Calcular importes (sin persistencia)
    const resultado = await this.calculoPreciosService.calcular(
      tenantId,
      calcularDto,
      configCalculo,
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

    // 6b. Sobre el umbral de la Res. Ex. SII 44/2025 la boleta lleva quién
    //     paga. Recién acá se conoce el total, y todavía no se escribió nada.
    //     Online y suscripción lo chequean además ANTES de cobrar
    //     (`exigirCompraOnlineBajoUmbral`): acá serían plata cobrada sin venta.
    const faltaIdentidad = faltaIdentidadDelPagador({
      esBoleta: tipoDocumento.esBoleta,
      umbral: tipoDocumento.umbralIdentidad,
      totalFinal: resultado.totales.totalFinal,
      customer: tipoDocumento.customer,
    });
    if (faltaIdentidad) throw new BadRequestException(faltaIdentidad);

    // 7. Transacción atómica (manager recibido por parámetro)
    // 7a. Cabecera de venta (estado inicial PENDIENTE; se actualiza tras registrar pagos)
    const totalFinal = resultado.totales.totalFinal;
    const totalImpuestos = resultado.totales.totalImpuestos;
    const baseVentasSinImpuestos = new Decimal(totalFinal)
      .minus(totalImpuestos)
      .toFixed(4);

    const venta = await manager.save(
      Venta,
      manager.create(Venta, {
        tenantId,
        cajaId: caja.id,
        monedaId: monedaOficialId,
        tipoDocumentoId: tipoDocumento.id,
        canal,
        estado: EstadoVenta.PENDIENTE,
        totalBruto: resultado.totales.subtotalNeto,
        totalDescuentos: resultado.totales.totalDescuentos,
        totalRecargos: resultado.totales.totalRecargos,
        totalImpuestos,
        totalFinal,
        baseVentasTotalFinal: totalFinal,
        baseVentasSinImpuestos,
        comentario: dto.comentario ?? null,
        // La config con la que se calculó, congelada: sin ella las reglas
        // congeladas más abajo no son interpretables.
        configCalculo: resultado.config,
      }),
    );

    // 7b. Líneas / detalles — un `save` con el array entero, no uno por línea.
    // TypeORM devuelve las mismas instancias en el mismo orden, que es lo que
    // permite cruzar `detalles[i]` con `resultado.lineas[i]` más abajo.
    const detalles = await manager.save(
      VentaDetalle,
      resultado.lineas.map((rLinea, i) => {
        const {
          item,
          precioOrigen,
          tasa,
          precioConvertido,
          personalizacion,
          cantidadPresentacion,
          unidadCodigoPresentacion,
          unidadBaseCodigo,
        } = lineasConversion[i];
        return manager.create(VentaDetalle, {
          ventaId: venta.id,
          itemId: rLinea.itemId,
          monedaIdOrigen: item.monedaId,
          precioUnitarioOrigen: precioOrigen,
          tasaCambio: tasa,
          precioUnitario: precioConvertido,
          descripcion: item.nombre,
          // Non-null garantizado por el guard del paso 2, que rechaza la venta
          // antes de escribir si algún ítem no tiene clasificación.
          clasificacionTributaria: item.clasificacionTributaria!,
          cantidad: rLinea.cantidad,
          cantidadPresentacion,
          unidadCodigoPresentacion,
          // La unidad en la que quedó `cantidad`: sin ella el número no tiene
          // magnitud y leerla del ítem daría la de hoy, no la de la venta.
          unidadCodigoBase: unidadBaseCodigo,
          subtotal: rLinea.subtotalNeto,
          descuentoAplicado: rLinea.descuentoAplicado,
          recargoAplicado: rLinea.recargoAplicado,
          ajusteVenta: rLinea.ajusteVenta,
          impuestoAplicado: rLinea.impuestoAplicado,
          totalLinea: rLinea.totalLinea,
          personalizacion,
        });
      }),
    );

    // 7c/7d. Reglas aplicadas. Se arman todas las filas en memoria y se
    // escriben con un `save` por familia: eran N round-trips EN SERIE, uno por
    // traza, sobre un resultado que ya estaba entero en memoria. El orden de
    // armado es el de antes (por línea, y las de venta al final) porque es el
    // orden en que quedan las filas.
    const filasDescuento: VentaDescuento[] = [];
    const filasRecargo: VentaRecargo[] = [];
    const filasImpuesto: VentaImpuesto[] = [];
    const filasPromocion: VentaPromocion[] = [];

    // Un `porcentaje_aplicado` solo tiene sentido si la regla ERA un
    // porcentaje. En una de monto fijo va `null` explícito: un `0` se leería
    // después como "valía 0%", que es una regla distinta.
    const porcentajeDe = (traza: TrazaRegla) =>
      traza.modo === 'porcentaje' ? traza.valorEfectivo : null;

    resultado.lineas.forEach((rLinea, i) => {
      // Por índice, nunca por `itemId`: el mismo ítem puede aparecer en dos
      // líneas con personalizaciones distintas, y buscarlo por ítem atribuiría
      // las dos reglas a la misma.
      const detalleId = detalles[i].id;

      for (const traza of rLinea.trazas.descuentos) {
        filasDescuento.push(
          manager.create(VentaDescuento, {
            ventaId: venta.id,
            descuentoId: traza.id,
            detalleId,
            nombreRegla: traza.nombre,
            modo: traza.modo,
            valorAplicado: traza.monto,
            valorSolicitado: traza.valorSolicitado,
            porcentajeAplicado: porcentajeDe(traza),
            aplicadoEn: 'detalle',
          }),
        );
      }
      for (const traza of rLinea.trazas.recargos) {
        filasRecargo.push(
          manager.create(VentaRecargo, {
            ventaId: venta.id,
            recargoId: traza.id,
            detalleId,
            nombreRegla: traza.nombre,
            modo: traza.modo,
            valorAplicado: traza.monto,
            porcentajeAplicado: porcentajeDe(traza),
            aplicadoEn: 'detalle',
          }),
        );
      }
      for (const traza of rLinea.trazas.impuestos) {
        filasImpuesto.push(
          manager.create(VentaImpuesto, {
            ventaId: venta.id,
            impuestoId: traza.id,
            detalleId,
            nombreRegla: traza.nombre,
            valorAplicado: traza.monto,
            porcentajeAplicado: traza.tasa,
            aplicadoEn: 'detalle',
          }),
        );
      }
      // Siempre por línea, nunca a nivel venta: el beneficio de una promo
      // aterriza en líneas (ver `TrazaPromo`), así que no hay un
      // `resultado.trazasVenta.promociones` equivalente al de descuentos/recargos.
      for (const traza of rLinea.trazas.promociones) {
        filasPromocion.push(
          manager.create(VentaPromocion, {
            ventaId: venta.id,
            detalleId,
            aplicacion: traza.aplicacion,
            promocionId: traza.id,
            nombrePromocion: traza.nombre,
            tipo: traza.tipo,
            valorEfectivo: traza.valorEfectivo,
            monto: traza.monto,
          }),
        );
      }
    });

    // Las de nivel venta no pertenecen a ninguna línea: `detalleId` queda null.
    for (const traza of resultado.trazasVenta.descuentos) {
      filasDescuento.push(
        manager.create(VentaDescuento, {
          ventaId: venta.id,
          descuentoId: traza.id,
          detalleId: null,
          nombreRegla: traza.nombre,
          modo: traza.modo,
          valorAplicado: traza.monto,
          valorSolicitado: traza.valorSolicitado,
          porcentajeAplicado: porcentajeDe(traza),
          aplicadoEn: 'venta',
        }),
      );
    }
    for (const traza of resultado.trazasVenta.recargos) {
      filasRecargo.push(
        manager.create(VentaRecargo, {
          ventaId: venta.id,
          recargoId: traza.id,
          detalleId: null,
          nombreRegla: traza.nombre,
          modo: traza.modo,
          valorAplicado: traza.monto,
          porcentajeAplicado: porcentajeDe(traza),
          aplicadoEn: 'venta',
        }),
      );
    }

    // TypeORM ya cortocircuita un array vacío, pero el guard queda explícito:
    // que una venta sin reglas no escriba nada no debería depender de un
    // detalle interno de la librería.
    if (filasDescuento.length > 0) {
      await manager.save(VentaDescuento, filasDescuento);
    }
    if (filasRecargo.length > 0) {
      await manager.save(VentaRecargo, filasRecargo);
    }
    if (filasImpuesto.length > 0) {
      await manager.save(VentaImpuesto, filasImpuesto);
    }
    if (filasPromocion.length > 0) {
      await manager.save(VentaPromocion, filasPromocion);
    }

    // 7e. Customer (opcional). El customer ya validado por `resolverTipoDocumento`.
    const customer = tipoDocumento.customer;
    if (customer) {
      if (customer.terceroId) {
        await this.validarTercero(manager, tenantId, customer.terceroId);
      }
      await manager.save(
        VentaCustomer,
        manager.create(VentaCustomer, {
          ventaId: venta.id,
          terceroId: customer.terceroId ?? null,
          nombre: customer.nombre,
          rut: customer.rut ?? null,
          direccion: customer.direccion ?? null,
          giro: customer.giro ?? null,
          comuna: customer.comuna ?? null,
          telefono: customer.telefono ?? null,
          email: customer.email ?? null,
        }),
      );
    }

    // 7f. Movimientos de inventario (productos y recetas)
    //
    // Orden determinista por `itemId`, NO el del carrito: `registrarMovimiento`
    // toma `SELECT … FOR UPDATE` sobre `item_producto` por línea, así que el
    // orden de bloqueo lo decidía el cliente. Dos ventas simultáneas con los
    // mismos dos productos en orden inverso se bloqueaban en cruz y Postgres
    // abortaba una — venta caída con un error opaco, sin corrupción pero sin
    // explicación. Un orden global fijo hace el deadlock imposible.
    // Arranca con lo que avisó el motor de precios (descuento topeado por el piso
    // en cero, regla pausada, impuesto pausado, ítem pausado) y se le suma lo de
    // recetas/combos más abajo. Se renderizan
    // como toasts sueltos, cada mensaje se explica solo — en el POS
    // (`ventas/pos.vue`) y, desde el 2026-08-11, en el alta de suscripciones de
    // la tienda, que devuelve estas mismas advertencias al cliente.
    const advertencias: string[] = resultado.advertencias.map(
      (a) => `${a.titulo}: ${a.detalle}`,
    );
    const ordenLocks = lineasConversion
      .map((_, idx) => idx)
      .sort((a, b) => {
        const cmp = lineasConversion[a].item.id.localeCompare(
          lineasConversion[b].item.id,
        );
        return cmp !== 0 ? cmp : a - b;
      });
    // Conversor de unidades compartido por TODAS las líneas del carrito.
    // `??=`: se carga en la primera línea que expanda una receta o un combo y
    // se reusa en las siguientes; un carrito de puros productos no paga la
    // query. Sin esto, cada línea cargaba el catálogo de nuevo — adentro de la
    // línea ya se leía una sola vez, pero un pedido de dos platos distintos lo
    // leía dos veces.
    let convertir: ConvertirUnidad | undefined;
    // Resuelto UNA vez antes del loop: `localDe` adentro de cada iteración
    // sería una consulta por línea de venta, N+1 en el camino más caliente
    // del sistema.
    const ubicacionLocalId = await this.ubicacionesService.localDe(tenantId);
    for (const i of ordenLocks) {
      const { item, linea, personalizacion, cantidadCanonica } =
        lineasConversion[i];
      if (item.tipo === 'producto') {
        try {
          await this.inventarioService.registrarMovimiento(manager, {
            tenantId,
            itemId: item.id,
            ubicacionId: ubicacionLocalId,
            tipo: 'salida',
            motivo: 'venta',
            cantidad: cantidadCanonica,
            usuarioId,
            ventaId: venta.id,
            unidadIds: linea.unidadIds,
            // La cuenta del salón que se está cobrando: las unidades que ella
            // tiene apartadas pueden salir por acá, las de otra no.
            cuentaId,
            loteId: linea.loteId,
          });
        } catch (e) {
          // Frente de bodegas y traslados: el chokepoint de inventario
          // (`moverCantidad`) rechaza con un mensaje genérico —"Stock
          // insuficiente para la salida", sin nombrar el ítem ni el lugar—
          // porque no sabe qué línea de qué venta lo llamó. Acá SÍ se sabe
          // (`item.nombre`, `cantidadCanonica`), así que el 400 se reemplaza
          // por el mismo enriquecido de `validarStockAlPedir` (mismo texto,
          // mismo `itemNombre`/`faltante`/`ubicaciones`): el garzón/cajero ve
          // "dónde está" tanto si el rechazo llega al PEDIR (salón) como al
          // COBRAR directo (POS). Solo se re-arma cuando el motivo es justo ESE
          // —modo cantidad, sin unidades ni lote— para no pisar el mensaje
          // propio de series/lotes, que hablan de unidades concretas y no de
          // "cuánto queda".
          if (
            e instanceof BadRequestException &&
            e.message === 'Stock insuficiente para la salida'
          ) {
            throw await this.itemsService.errorStockInsuficienteEnLocal(
              tenantId,
              item.id,
              item.nombre,
              new Decimal(cantidadCanonica),
              item.unidadMedida ?? '',
            );
          }
          throw e;
        }
      } else if (item.tipo === 'receta') {
        convertir ??= await this.catalogService.crearConversor();
        const advertenciasIngrediente =
          await this.itemsService.venderIngredientesReceta(manager, {
            tenantId,
            usuarioId,
            ventaId: venta.id,
            recetaItemId: item.id,
            recetaNombre: item.nombre,
            cantidadVendida: cantidadCanonica,
            snapshot: personalizacion ?? undefined,
            convertir,
            ubicacionLocalId,
          });
        advertencias.push(...advertenciasIngrediente);
      } else if (item.tipo === 'combo') {
        convertir ??= await this.catalogService.crearConversor();
        const advertenciasComponente =
          await this.itemsService.venderComponentesCombo(manager, {
            tenantId,
            usuarioId,
            ventaId: venta.id,
            comboItemId: item.id,
            comboNombre: item.nombre,
            cantidadVendida: cantidadCanonica,
            snapshot: personalizacion ?? undefined,
            convertir,
            ubicacionLocalId,
          });
        advertencias.push(...advertenciasComponente);
      }
    }

    // 7g. Propina (cierre de mesa o directa del POS) — antes de pagos, para referencia_id
    if (dto.propinaCierreMesa && dto.propinaDirecta) {
      throw new BadRequestException(
        'No se puede combinar propina de cierre de mesa con propina directa',
      );
    }
    // Flags de canal: propina de un canal deshabilitado se ignora (la venta se
    // crea sin propina). La config solo se consulta si la venta trae propina,
    // para no pegarle a la BD en cada venta sin propina (camino caliente del
    // POS). Ver docs/features/liquidacion-propinas-config.md.
    // Ambas propinas son del canal presencial —el POS y el cierre de mesa de
    // salones—, así que una venta `online` que las mande se trata igual que un
    // canal apagado: se ignora, no se rechaza.
    const traePropina =
      canal !== 'online' && !!(dto.propinaCierreMesa || dto.propinaDirecta);
    const propinaConfig = traePropina
      ? await manager.findOne(PropinaConfiguracion, {
          where: { tenantId, eliminadoEl: IsNull() },
        })
      : null;
    const habilitadoPos = traePropina && (propinaConfig?.habilitadoPos ?? true);
    const habilitadoSalones =
      traePropina && (propinaConfig?.habilitadoSalones ?? true);
    let ventaPropinaId: string | null = null;
    let propinaMonto = '0';
    let estrategiaPropina = EstrategiaAsignacionPropina.NO_VUELTO;
    if (dto.propinaCierreMesa && habilitadoSalones) {
      const tip = dto.propinaCierreMesa;
      propinaMonto = tip.montoPagado;
      estrategiaPropina =
        tip.estrategia ?? EstrategiaAsignacionPropina.NO_VUELTO;
      // `garzonId` viene del body: sin este chequeo se persiste tal cual y la
      // propina se acredita a un garzón de otro tenant, que después la cobra en
      // su liquidación. Lanza si no existe, no es del tenant o está inactivo.
      // (`propinaDirecta` no lo necesita: `asegurarMostrador` ya es tenant-scoped.)
      await this.garzonesService.obtenerActivoPorId(tenantId, tip.garzonId);
      const ventaPropina = await this.ventaPropinaService.crearEnTransaccion(
        manager,
        {
          tenantId,
          ventaId: venta.id,
          garzonId: tip.garzonId,
          porcentajeSugerido: tip.porcentajeSugerido ?? '0.10',
          montoSugerido: tip.montoSugerido ?? tip.montoPagado,
          montoPagado: tip.montoPagado,
          sesionGarzonId: tip.sesionGarzonId ?? null,
          turnoId: tip.turnoId ?? null,
          tipoGarzon: tip.tipoGarzon ?? null,
        },
      );
      ventaPropinaId = ventaPropina.id;
    } else if (dto.propinaDirecta && habilitadoPos) {
      const tip = dto.propinaDirecta;
      propinaMonto = tip.montoPagado;
      const mostrador = await this.garzonesService.asegurarMostrador(
        manager,
        tenantId,
      );
      const ventaPropina = await this.ventaPropinaService.crearEnTransaccion(
        manager,
        {
          tenantId,
          ventaId: venta.id,
          garzonId: mostrador.id,
          porcentajeSugerido: tip.porcentajeSugerido ?? '0.10',
          montoSugerido: tip.montoSugerido ?? tip.montoPagado,
          montoPagado: tip.montoPagado,
          sesionGarzonId: null,
          turnoId: null,
          tipoGarzon: null,
        },
      );
      ventaPropinaId = ventaPropina.id;
    }

    const targetCobro = new Decimal(resultado.totales.totalFinal)
      .plus(propinaMonto)
      .toFixed(4);

    // 7h. Pagos — delegado a PagosService (incluye vuelto + aplicaciones + caja)
    const saved = await this.pagosService.registrar(manager, {
      tenantId,
      ventaId: venta.id,
      pagos: pagosDto,
      cajaId: caja.id,
      monedaOficialId,
      target: targetCobro,
      propinaMonto,
      ventaPropinaId,
      estrategia: estrategiaPropina,
    });

    // 7i. El estado de la venta sale de su saldo, con la misma regla que todas las
    //     operaciones que mueven lo que se debe (`recalcularEstadoDeLaVenta`).
    //
    // Se corre SIEMPRE, sin condicionarlo a que existan pagos: una venta de total
    // $0 —una promoción que descuenta el 100%— es una venta **pagada**, y no lleva
    // línea de pago porque no hay nada que cobrar. Condicionarlo la dejaba
    // `pendiente` con saldo $0, arrastrándose en los listados de deuda.
    //
    // Para el resto no cambia nada: sin pagos y con total > 0 sigue `pendiente`, el
    // estado con el que la venta ya nacía.
    const { estado: estadoFinal } = await recalcularEstadoDeLaVenta(
      manager,
      tenantId,
      venta.id,
    );
    venta.estado = estadoFinal;

    // 7j. Los documentos de la venta. Se resuelven ACÁ, una sola vez, dentro de
    //     la transacción: en POS y salones crear la venta es la entrega, y lo
    //     entregado se documenta al entregarlo, se haya pagado o no (E1).
    //     Todo lo que necesita ya está en memoria: las porciones salen de
    //     `detalles` y el emisor de cada pago, de `registrar`.
    const porciones = new Map<string, { total: Decimal; impuesto: Decimal }>();
    for (const d of detalles) {
      const acum = porciones.get(d.clasificacionTributaria) ?? {
        total: new Decimal(0),
        impuesto: new Decimal(0),
      };
      porciones.set(d.clasificacionTributaria, {
        total: acum.total.plus(d.totalLinea),
        impuesto: acum.impuesto.plus(d.impuestoAplicado),
      });
    }
    await this.ventaDocumentosService.documentarVenta(manager, {
      tenantId,
      venta: {
        id: venta.id,
        tipoDocumentoId: tipoDocumento.id,
        esBoleta: tipoDocumento.esBoleta,
        canal,
        totalFinal: resultado.totales.totalFinal,
        totalBruto: resultado.totales.subtotalNeto,
        configCalculo: resultado.config,
      },
      facturador: monedaOficial.facturador,
      porciones: [...porciones].map(([clasificacion, p]) => ({
        clasificacion,
        total: p.total.toFixed(4),
        impuesto: p.impuesto.toFixed(4),
      })),
      // `porPago[i]` es el pago de `pagosDto[i]`: el número y la clase que tipeó
      // el cajero viajan por posición.
      pagos: saved.porPago.map((p, i) => ({
        pagoId: p.pagoId,
        metodoPagoId: p.metodoPagoId,
        emisor: p.emisor,
        aplicadoVenta: p.aplicadoVenta,
        numeroDocumento: pagosDto[i].numeroDocumento,
        claseDocumento: pagosDto[i].claseDocumento,
      })),
    });

    // Detalle priceado de la personalización, con cada extra YA convertido a
    // moneda oficial. Es el ÚNICO productor: el POS lo imprime desde acá en vez
    // de recalcularlo en el cliente, que era donde el monto salía en la moneda
    // del ítem y después se formateaba con la oficial.
    //
    // Cada extra se convierte POR SU CUENTA, sin reparto por mayores restos: el
    // ticket no imprime `precioBase`, así que este desglose es transparencia
    // sobre el P.UNIT que ya está arriba, no un sumando que alguien pueda cerrar
    // contra el papel. Si algún día se imprime la base, esto se reabre.
    const nombresPersonalizacion =
      await this.nombresIngredientesPersonalizacion(
        manager,
        tenantId,
        detalles,
      );
    const detallesRespuesta = detalles.map((detalle, i) => {
      const lineasDetalle = detallePersonalizacion(
        detalle.personalizacion,
        nombresPersonalizacion,
      );
      if (lineasDetalle.length === 0) return detalle;
      const monedaOrigen = lineasConversion[i].item.monedaId;
      return {
        ...detalle,
        personalizacionDetalle: lineasDetalle.map((linea) => ({
          ...linea,
          monto: this.calculoPreciosService.convertirAMonedaOficial(
            linea.monto,
            monedaOrigen,
            tasaMap,
            configCalculo.modoRedondeo,
          ),
        })),
      };
    });

    return { ...venta, detalles: detallesRespuesta, advertencias };
  }

  /**
   * Nombres de los ingredientes que aparecen en las personalizaciones de estas
   * líneas, en UNA query. El snapshot guarda ids, no nombres, y el detalle
   * priceado que se imprime en el ticket los necesita.
   *
   * Gemelo deliberado de `SalonesService.nombresIngredientesPersonalizacion`:
   * son los dos caminos que producen ticket, y comparten la regla de que el
   * nombre se resuelve en batch, nunca uno por línea. Si aparece un tercero,
   * se extrae.
   */
  private async nombresIngredientesPersonalizacion(
    manager: EntityManager,
    tenantId: string,
    filas: { personalizacion: PersonalizacionRecetaSnapshot | null }[],
  ): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const fila of filas) {
      const p = fila.personalizacion;
      if (!p) continue;
      for (const id of p.omitidos ?? []) ids.add(id);
      for (const e of p.extras ?? []) ids.add(e.ingredienteItemId);
    }
    if (ids.size === 0) return new Map();
    const filasNombre: { item_id: string; nombre: string }[] =
      await manager.query(
        `SELECT item_id, nombre FROM items
          WHERE item_id = ANY($1) AND tenant_id = $2 AND eliminado_el IS NULL`,
        [[...ids], tenantId],
      );
    return new Map(filasNombre.map((r) => [r.item_id, r.nombre]));
  }

  /**
   * Costo con el que cada ítem SALIÓ en una venta, leído del kardex.
   *
   * Es el dato que hace que revertir mercadería no infle el inventario: la
   * unidad vuelve al costo con el que se fue, no al promedio vigente el día de
   * la reversión (decisión del owner, 2026-08-15). Ya estaba congelado en
   * `movimientos_inventario` ligado a la venta, y hasta el 2026-08-22 no se
   * leía.
   *
   * `MIN(costo_unitario)` y no un promedio: dentro de UNA venta todas las
   * salidas de un mismo ítem congelan el mismo costo. `costo_actual` solo
   * cambia dentro de `InventarioService.registrarMovimiento`, que toma
   * `FOR UPDATE` sobre el ítem, y nada puede cambiarlo en el medio — la venta
   * toma ese mismo lock en su primera salida y no lo suelta hasta commitear. Por eso una devolución **parcial** puede usar el
   * mismo costo que una total sin prorratear nada.
   *
   * Una sola query por venta: el llamador resuelve por ítem contra el Map, sin
   * una consulta por línea.
   */
  private async costosDeSalidaPorItem(
    manager: EntityManager,
    ventaId: string,
  ): Promise<Map<string, string | null>> {
    const filas: { item_id: string; costo_unitario: string | null }[] =
      await manager.query(
        `SELECT m.item_id, MIN(m.costo_unitario)::text AS costo_unitario
           FROM movimientos_inventario m
          WHERE m.venta_id = $1 AND m.tipo = 'salida' AND m.motivo = 'venta'
            AND m.eliminado_el IS NULL
          GROUP BY m.item_id`,
        [ventaId],
      );
    return new Map(filas.map((f) => [f.item_id, f.costo_unitario]));
  }

  /**
   * Anula una venta — el `void` del dominio, distinto de la devolución.
   *
   * Acotada al subconjunto que es seguro **hoy y después de integrar el SII**:
   * venta `pendiente`, **sin pagos** y **sin documento tributario**. Ahí no hay
   * hecho fiscal que compensar ni dinero que devolver, así que se puede deshacer
   * de verdad. Todo lo demás se revierte con nota de crédito, como exige el SII:
   * emitida y aceptada la boleta, el documento no se anula, se compensa.
   *
   * Decidido 2026-07-27 tras investigación de mercado — ver
   * `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`.
   */
  async cancelar(params: {
    tenantId: string;
    usuarioId: string;
    /** El alcance de caja de `findOne` (`exigirVentaVisible`). */
    verTodas: boolean;
    ventaId: string;
    motivo: string;
    reponerStock: boolean;
    /**
     * La respuesta a "¿ya hiciste esta factura en tu facturador?" (E10).
     * `undefined` y `false` son conductas distintas: no se normaliza.
     */
    externoHecho?: boolean;
  }): Promise<{
    id: string;
    estado: EstadoVenta;
    stockRepuesto: boolean;
    motivo: string;
  }> {
    // Mismo loop que `crear()`, por la misma razón y con la misma
    // precondición: reponer toma un `FOR UPDATE` por ítem, así que una
    // anulación puede cruzarse con una venta concurrente sobre los mismos
    // productos. El único llamador es `VentasController.anular`, sin
    // transacción envolvente — ver la precondición documentada en `crear()`.
    for (let intento = 0; ; intento++) {
      try {
        return await this.cancelarUnaVez(params);
      } catch (error) {
        if (intento >= MAX_REINTENTOS_DEADLOCK || !esDeadlock(error))
          throw error;
      }
    }
  }

  /**
   * Completa el número de un documento de la venta (`PATCH /ventas/:id/documentos/:documentoId`,
   * spec § 3.4). Lo que hace este método es lo que `VentaDocumentosService.completarNumero`
   * no sabe: **a quién pertenece** el documento y **quién puede tocarlo**
   * (`tomarDocumentoDeLaVenta`: alcance de caja, lock de la venta, documento de
   * esta venta).
   *
   * Todo en una transacción. La escritura y sus reglas (solo `maquina`/`externo`
   * vigentes, la `clase` solo con la máquina) son del servicio de documentos.
   */
  async completarNumeroDocumento(params: {
    tenantId: string;
    usuarioId: string;
    verTodas: boolean;
    ventaId: string;
    documentoId: string;
    numero: string;
    clase?: ClaseDocumentoMaquina;
  }): Promise<DocumentoDetalle> {
    return this.db.transaccion(async (manager) => {
      await this.tomarDocumentoDeLaVenta(manager, params);
      return this.ventaDocumentosService.completarNumero(manager, {
        tenantId: params.tenantId,
        documentoId: params.documentoId,
        numero: params.numero,
        clase: params.clase,
      });
    });
  }

  /**
   * Borra el número de un documento hecho por fuera (`POST
   * /ventas/:id/documentos/:documentoId/borrar-numero`, PRODUCTO § 10). Mismo
   * andamio que `completarNumeroDocumento` —alcance de caja, lock de la venta,
   * que el documento sea de esta venta—, y la escritura y su registro (quién,
   * cuándo y qué decía) son de `VentaDocumentosService.borrarNumero`.
   */
  async borrarNumeroDocumento(params: {
    tenantId: string;
    usuarioId: string;
    verTodas: boolean;
    ventaId: string;
    documentoId: string;
  }): Promise<DocumentoDetalle> {
    return this.db.transaccion(async (manager) => {
      await this.tomarDocumentoDeLaVenta(manager, params);
      return this.ventaDocumentosService.borrarNumero(manager, {
        tenantId: params.tenantId,
        usuarioId: params.usuarioId,
        documentoId: params.documentoId,
      });
    });
  }

  /**
   * El alcance de caja de `findOne` (`filtroDeMisCajas`) para una escritura sobre
   * la venta: una venta que no es suya es 404, igual que en el detalle, para no
   * confirmar que existe. Va **antes** del lock de la venta, para que quien no la
   * ve no pueda retenerla.
   *
   * Lo usan las escrituras de la API que operan sobre una venta por su id: los
   * documentos (`tomarDocumentoDeLaVenta`), la anulación (`cancelarUnaVez`) y la
   * nota de crédito manual (`crearNotaCreditoDesdeVenta`). Sin esto, quien tiene
   * el permiso de la escritura pero no `Cajas:Leer` operaba sobre ventas de otras
   * cajas que no puede ni ver (invariante 6).
   */
  private async exigirVentaVisible(
    lector: EntityManager | Db,
    params: {
      tenantId: string;
      usuarioId: string;
      verTodas: boolean;
      ventaId: string;
    },
  ): Promise<void> {
    const binds: unknown[] = [params.ventaId, params.tenantId];
    let filtroPropio = '';
    if (!params.verTodas) {
      binds.push(params.usuarioId);
      filtroPropio = this.filtroDeMisCajas(binds.length);
    }
    const visible: unknown[] = await lector.query(
      `SELECT 1 FROM ventas v
        WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL
          ${filtroPropio}`,
      binds,
    );
    if (!visible.length) throw new NotFoundException('Venta no encontrada');
  }

  /**
   * Lo que comparten las dos escrituras sobre un documento de la venta
   * (`completarNumeroDocumento`, `borrarNumeroDocumento`), en este orden y dentro
   * de la transacción del llamador:
   *
   * 1. El alcance de caja (`exigirVentaVisible`), antes del lock.
   * 2. El `FOR UPDATE` de la venta, el mismo de `cancelarUnaVez`: sin él, tocar
   *    el número de un `externo` correría contra una anulación que lo declara no
   *    hecho (E10), y el documento quedaría descartado **con** número.
   * 3. Que el documento sea de esta venta. El `externo` o la máquina de otra
   *    venta (del mismo tenant) es 404.
   */
  private async tomarDocumentoDeLaVenta(
    manager: EntityManager,
    params: {
      tenantId: string;
      usuarioId: string;
      verTodas: boolean;
      ventaId: string;
      documentoId: string;
    },
  ): Promise<void> {
    await this.exigirVentaVisible(manager, params);

    await this.lockVentaOriginal(manager, params.tenantId, params.ventaId);

    const delaVenta: unknown[] = await manager.query(
      `SELECT 1 FROM venta_documentos
        WHERE documento_id = $1 AND venta_id = $2 AND tenant_id = $3
          AND eliminado_el IS NULL`,
      [params.documentoId, params.ventaId, params.tenantId],
    );
    if (!delaVenta.length)
      throw new NotFoundException('Documento no encontrado');
  }

  /**
   * Un intento de anulación. Nombre aparte del sufijo `EnTransaccion`, que en
   * este código significa "recibe el `manager` de una transacción ya abierta"
   * (`crearEnTransaccion`): éste abre la suya, que es justo lo que el loop de
   * reintento necesita para que el segundo intento entre limpio.
   */
  private async cancelarUnaVez(params: {
    tenantId: string;
    usuarioId: string;
    verTodas: boolean;
    ventaId: string;
    motivo: string;
    reponerStock: boolean;
    /**
     * La respuesta a "¿ya hiciste esta factura en tu facturador?" (E10).
     * `undefined` y `false` son conductas distintas: no se normaliza.
     */
    externoHecho?: boolean;
  }): Promise<{
    id: string;
    estado: EstadoVenta;
    stockRepuesto: boolean;
    motivo: string;
  }> {
    return this.db.transaccion(async (manager) => {
      await this.exigirVentaVisible(manager, params);
      const venta = await this.lockVentaOriginal(
        manager,
        params.tenantId,
        params.ventaId,
      );

      // La etiqueta `tipo_documento_id` NO impide anular: toda venta nace con la
      // boleta del país, y rechazar por ella dejaría a ninguna anulable. Lo que
      // cuenta es lo **emitido**, y eso lo dice `venta_documentos` (E8, E10), más
      // abajo. Acá impiden anular el estado, los pagos y las correcciones: la misma regla que
      // el `anulable` del detalle (`motivoQueImpideAnular`).
      const motivo = await this.motivoQueImpideAnular(manager, {
        ventaId: params.ventaId,
        estado: venta.estado,
      });
      if (motivo) throw new BadRequestException(motivo);

      // Lo emitido (E8, E10): una máquina o un envío bloquean; un `externo` se
      // pregunta; lo que solo está armado se descarta en esta misma transacción.
      // Después del lock de la venta (`lockVentaOriginal`) y antes de tocar stock:
      // si bloquea, la respuesta es el 400 y nada se movió.
      await this.ventaDocumentosService.descartarAlAnular(manager, {
        tenantId: params.tenantId,
        ventaId: params.ventaId,
        usuarioId: params.usuarioId,
        externoHecho: params.externoHecho,
      });

      let repuesto = false;
      if (params.reponerStock) {
        // Lo que hay que devolver es lo que el kardex dice que SALIÓ, no lo
        // que dicen las líneas de la venta. Reconstruirlo desde
        // `venta_detalles JOIN item_producto` perdía en silencio toda línea
        // de receta o de combo —esas no tienen fila en `item_producto`, la
        // tienen sus ingredientes/componentes— y la anulación igual respondía
        // que había repuesto. El kardex, además, es exacto donde la receta no
        // lo es: un ingrediente no bloqueante que se vendió sin stock nunca
        // salió, así que tampoco vuelve; y una receta editada después de la
        // venta no cambia lo que hay que devolver.
        //
        // Sin filtrar `eliminado_el` de `items` ni de `item_producto`, y por
        // la misma regla explícita que `InventarioService.registrarMovimiento`:
        // filtrarlo haría que anular una venta de un producto discontinuado
        // después dejara de reponer. El motivo `anulacion` está en la
        // allowlist de movimientos sobre un ítem eliminado.
        const salidas: {
          item_id: string;
          cantidad: string;
          descripcion: string | null;
          modo_inventario: string | null;
        }[] = await manager.query(
          `SELECT m.item_id,
                  SUM(m.cantidad)::text AS cantidad,
                  i.nombre AS descripcion,
                  ip.modo_inventario
             FROM movimientos_inventario m
             JOIN items i ON i.item_id = m.item_id
             JOIN item_producto ip ON ip.item_id = m.item_id
            WHERE m.venta_id = $1 AND m.tipo = 'salida' AND m.motivo = 'venta'
              AND m.eliminado_el IS NULL
            GROUP BY m.item_id, i.nombre, ip.modo_inventario`,
          [params.ventaId],
        );
        // Solo `cantidad`: reponer serie o lote exige saber qué unidades/lotes
        // salieron y recrearlos. Misma frontera —y mismo mensaje— que la
        // devolución de una nota de crédito, para no inventar un segundo camino.
        for (const s of salidas) {
          if (s.modo_inventario !== 'cantidad')
            throw new BadRequestException(
              `"${s.descripcion ?? s.item_id}" usa inventario por ${s.modo_inventario}: anulá sin reponer stock y registrá el ingreso manualmente desde Inventario.`,
            );
        }
        // Orden determinista por `itemId`, y con el MISMO comparador que
        // `crear()` (`localeCompare`, no el `ORDER BY` de Postgres, cuya
        // collation puede ordenar distinto): si los dos caminos ordenaran
        // distinto, una venta y una anulación simultáneas sobre los mismos
        // ítems se seguirían bloqueando en cruz.
        salidas.sort((a, b) => a.item_id.localeCompare(b.item_id));
        // Sin salidas no hay costos que buscar: una venta de puros servicios
        // no paga la query.
        const costos = salidas.length
          ? await this.costosDeSalidaPorItem(manager, params.ventaId)
          : new Map<string, string | null>();
        // Resuelto UNA vez antes del loop: `localDe` por línea repuesta sería
        // una consulta por ítem de la venta anulada, N+1.
        const ubicacionLocalId = salidas.length
          ? await this.ubicacionesService.localDe(params.tenantId)
          : null;
        for (const s of salidas) {
          await this.inventarioService.registrarMovimiento(manager, {
            tenantId: params.tenantId,
            itemId: s.item_id,
            ubicacionId: ubicacionLocalId!,
            tipo: 'entrada',
            motivo: 'anulacion',
            cantidad: s.cantidad,
            // Vuelve al costo con el que salió, y el CPP se recalcula
            // incluyéndola (decisión del owner, 2026-08-15). Sin costo
            // congelado —un producto que nunca tuvo costo— no se inventa uno:
            // `registrarMovimiento` deja el promedio como estaba.
            costoUnitario: costos.get(s.item_id) ?? null,
            usuarioId: params.usuarioId,
            ventaId: params.ventaId,
            comentario: params.motivo,
          });
        }
        repuesto = salidas.length > 0;
      }

      await manager.query(
        `UPDATE ventas
            SET estado = $1, cancelada_el = NOW(), cancelada_por_usuario_id = $2,
                motivo_cancelacion = $3, actualizado_el = NOW()
          WHERE venta_id = $4`,
        [
          EstadoVenta.CANCELADA,
          params.usuarioId,
          params.motivo,
          params.ventaId,
        ],
      );

      return {
        id: params.ventaId,
        estado: EstadoVenta.CANCELADA,
        // Lo que de verdad pasó, no lo que se pidió: una venta de puros
        // servicios no tiene nada que devolver, y decir que repuso hace que
        // la pantalla afirme sobre un inventario que nadie tocó.
        stockRepuesto: repuesto,
        motivo: params.motivo,
      };
    });
  }

  /**
   * El tipo de documento de una venta, resuelto por el servidor (spec
   * `emision-por-venta` § 3.3). Antes `crearEnTransaccion` copiaba el
   * `tipoDocumentoId` del body sin mirarlo: un tipo de otro país, la nota de
   * crédito o un id al azar quedaban congelados en la venta (ADR-010).
   *
   * - **`online`**: siempre la boleta del país. El `canal` que se va a guardar en
   *   la venta decide, y el id del body ni se consulta: una venta online no tiene
   *   a nadie que elija entre boleta y factura.
   * - **Con id** (físico): tiene que ser del país del tenant, activo y no NC; si
   *   no, 400. No se distingue "no existe" de "es de otro país": para el cliente
   *   es lo mismo y no se confirma qué ids existen en el catálogo.
   * - **Sin id**: la boleta del país. Un país sin boleta sembrada (AR/CO/MX)
   *   devuelve `null`, como hasta hoy: su frente fiscal es otro.
   * - **`customer_requerido`** (la Factura): sin customer, 400. Hasta acá lo
   *   exigía solo la pantalla, y un POST directo creaba una Factura sin receptor.
   *   Se mira el tipo **resuelto**, no el pedido: online pide lo que quiera y
   *   termina en la boleta. Un nombre en blanco no es un customer, como en la
   *   pantalla (`puedeCobrar`, que hace `trim`); el DTO solo exige longitud 1.
   *   Por acá pasan todos los caminos que crean una venta desde un pedido: POS,
   *   el cierre de cuenta de salones, la tienda online y las suscripciones. La
   *   nota de crédito no: su tipo lo fija el sistema y no es `customer_requerido`.
   * - **El receptor, según el país** (2026-10-03, ver `receptorDeLaVenta`): en
   *   Chile, `customer_requerido` exige el receptor tributario completo y todo
   *   RUT que venga se valida. Por eso la lectura trae el país aunque no haya
   *   tipo (`LEFT JOIN`).
   *
   * **Una sola lectura**: trae, del país del tenant, el tipo pedido y la boleta
   * activa, y el resto se decide en memoria. La boleta es única por país
   * (`uq_tipo_documento_boleta_pais`), así que no hay empate que ordenar.
   * `esBoleta` es lo que la emisión usa para separar "sigue la regla del medio"
   * de "la hace el sistema".
   *
   * ⚠️ `{ id: null, esBoleta: false }` significa **que la venta no tiene tipo de
   * documento** (un país sin boleta sembrada). **No** significa que sea una
   * factura: `esBoleta: false` solo se lee con un `id` presente. Quien consuma
   * esto tiene que mirar `id` antes de `esBoleta`.
   */
  private async resolverTipoDocumento(
    manager: EntityManager,
    tenantId: string,
    tipoDocumentoId: string | undefined,
    canal: string,
    customer: CustomerVentaDto | undefined,
  ): Promise<{
    id: string | null;
    esBoleta: boolean;
    customer: CustomerVentaDto | undefined;
    /** Ver `faltaIdentidadDelPagador`. `null` si el tipo no es la boleta. */
    umbralIdentidad: string | null;
  }> {
    const pedido = canal === 'online' ? null : (tipoDocumentoId ?? null);
    const leidas: {
      codigo_iso: string;
      tipo_documento_id: string | null;
      es_boleta: boolean;
      es_nota_credito: boolean;
      activo: boolean;
      customer_requerido: boolean;
      umbral_identidad: string | null;
    }[] = await manager.query(
      `SELECT p.codigo_iso, td.tipo_documento_id, td.es_boleta,
              td.es_nota_credito, td.activo, td.customer_requerido,
              ${UMBRAL_IDENTIDAD_SQL} AS umbral_identidad
         FROM tenants t
         JOIN provincia prov ON prov.provincia_id = t.provincia_id
              AND prov.eliminado_el IS NULL
         JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
         LEFT JOIN tipos_documento_tributario td ON td.pais_id = p.pais_id
              AND td.eliminado_el IS NULL
              AND (td.tipo_documento_id = $2::uuid
                   OR (td.es_boleta = true AND td.activo = true
                       AND td.es_nota_credito = false))
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId, pedido],
    );
    const esChile = leidas[0]?.codigo_iso === CODIGO_ISO_CHILE;
    const filas = leidas.filter(
      (f): f is (typeof leidas)[number] & { tipo_documento_id: string } =>
        f.tipo_documento_id !== null,
    );

    let tipo: (typeof filas)[number] | undefined;
    if (pedido !== null) {
      tipo = filas.find((f) => f.tipo_documento_id === pedido);
      if (!tipo) {
        throw new BadRequestException(
          'El tipo de documento no corresponde al país del comercio',
        );
      }
      if (tipo.es_nota_credito) {
        throw new BadRequestException(
          'La nota de crédito no se elige: la genera el sistema al reembolsar',
        );
      }
      if (!tipo.activo) {
        throw new BadRequestException('El tipo de documento no está activo');
      }
    } else {
      tipo = filas.find((f) => f.es_boleta && f.activo && !f.es_nota_credito);
      if (!tipo) {
        return {
          id: null,
          esBoleta: false,
          customer: this.receptorDeLaVenta(customer, esChile, false),
          umbralIdentidad: null,
        };
      }
    }

    // Online hoy no llega al 400 de `customer_requerido`: resuelve siempre la
    // boleta, que no lo es en ningún país sembrado, y la tienda y las
    // suscripciones mandan el customer igual (solo con nombre). Ningún
    // endpoint edita el catálogo de tipos, así que su e2e cubre solo el caso
    // que deja pasar.
    return {
      id: tipo.tipo_documento_id,
      esBoleta: tipo.es_boleta,
      customer: this.receptorDeLaVenta(
        customer,
        esChile,
        tipo.customer_requerido,
      ),
      umbralIdentidad: tipo.es_boleta ? (tipo.umbral_identidad ?? null) : null,
    };
  }

  /**
   * El receptor que se congela en la venta, validado y normalizado. Las reglas
   * salen de la norma (SII, Formato DTE v2.5, zona Receptor) y las decidió el
   * owner el 2026-10-03 (`docs/agent/pendientes.md`, "Cómo arrancarlo" del
   * frente del receptor):
   *
   * - **Chile, tipo `customer_requerido`** (la Factura): RUT, razón social
   *   (`nombre`), giro, dirección y comuna, sin blancos. Es el receptor completo
   *   que la Factura exige; la nota de crédito exigiría menos, pero no pasa por
   *   acá.
   * - **Chile, cualquier tipo**: un RUT que venga tiene que ser un RUT (rango y
   *   DV, `rutValido`) y se guarda normalizado. También en una boleta: un RUT con
   *   DV malo congelado ensucia el documento aunque el receptor sea opcional.
   * - **Otro país** (en pausa hasta terminar Chile): `customer_requerido` exige
   *   solo el nombre, como antes, y el RUT no se mira (un CUIT usa otro DV).
   *
   * Los largos los pone el DTO, para todo país. Los textos fiscales se guardan
   * sin blancos en los bordes y, si quedan vacíos, como `null`.
   */
  private receptorDeLaVenta(
    customer: CustomerVentaDto | undefined,
    esChile: boolean,
    requerido: boolean,
  ): CustomerVentaDto | undefined {
    const sinBordes = (v: string | undefined) => v?.trim() || undefined;
    const receptor: CustomerVentaDto | undefined = customer && {
      ...customer,
      nombre: customer.nombre.trim(),
      rut: sinBordes(customer.rut),
      direccion: sinBordes(customer.direccion),
      giro: sinBordes(customer.giro),
      comuna: sinBordes(customer.comuna),
    };
    // Un nombre en blanco no es un customer para el tipo que lo exige; para el
    // que no, el customer se guarda igual que antes (con el nombre vacío), pero
    // su RUT se valida igual: no hay camino que congele un RUT sin mirarlo.
    if (requerido && !receptor?.nombre) {
      throw new BadRequestException(
        'Este tipo de documento requiere los datos del cliente',
      );
    }
    if (!receptor || !esChile) return receptor;

    if (requerido) {
      const faltan = [
        ['RUT', receptor.rut],
        ['giro', receptor.giro],
        ['dirección', receptor.direccion],
        ['comuna', receptor.comuna],
      ]
        .filter(([, valor]) => !valor)
        .map(([campo]) => campo);
      if (faltan.length) {
        throw new BadRequestException(
          `Este tipo de documento requiere del cliente: ${faltan.join(', ')}`,
        );
      }
    }
    if (receptor.rut) {
      if (!rutValido(receptor.rut)) {
        throw new BadRequestException('El RUT del cliente no es válido');
      }
      receptor.rut = normalizarRut(receptor.rut);
    }
    return receptor;
  }

  /**
   * El tipo de documento "nota de crédito" del país del tenant.
   *
   * Hasta el 2026-09-03 esto era una constante con la fila **chilena** código 61,
   * usada sin mirar el país: un reembolso en un tenant argentino congelaba un
   * documento chileno (ADR-010: lo que se congela en la transacción es justo lo
   * que no se corrige después). Ahora sale del catálogo, por `es_nota_credito`.
   *
   * `null` cuando el país todavía no la tiene sembrada. **Ya no sirve para
   * reconocer** una corrección (E7: eso es `venta_referencia_id`): queda para
   * **escribir** el tipo de una NC con documento y para decidir, en el detalle,
   * si hay NC que ofrecer.
   */
  private async tipoNotaCreditoDelTenant(
    tenantId: string,
  ): Promise<string | null> {
    const rows: { tipo_documento_id: string }[] = await this.db.query(
      `SELECT td.tipo_documento_id
       FROM tenants t
       JOIN provincia prov ON prov.provincia_id = t.provincia_id
            AND prov.eliminado_el IS NULL
       JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
       JOIN tipos_documento_tributario td ON td.pais_id = p.pais_id
            AND td.eliminado_el IS NULL AND td.es_nota_credito = true
       WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
       LIMIT 1`,
      [tenantId],
    );
    return rows[0]?.tipo_documento_id ?? null;
  }

  /**
   * Igual, para el flujo que la va a **escribir**. Acá el null no se puede
   * tragar: sin tipo de documento la NC quedaría sin su marca de nota de
   * crédito y su documento fiscal sin tipo (los topes de reembolso ya no la
   * buscan por este id: desde E7 van por `venta_referencia_id`).
   */
  private async exigirTipoNotaCredito(tenantId: string): Promise<string> {
    const id = await this.tipoNotaCreditoDelTenant(tenantId);
    if (!id)
      throw new BadRequestException(
        'El país de este tenant no tiene un tipo de documento de nota de ' +
          'crédito configurado: no se puede emitir el reembolso.',
      );
    return id;
  }

  async crearNotaCredito(
    params: CrearNotaCreditoParams,
  ): Promise<NotaCreditoCreada & { repetida?: true }> {
    if (new Decimal(params.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');

    // Los dos rechazos por falta de plata de acá abajo son oráculos sobre el
    // efectivo del turno (fuga 5 del modo ciego). `conRastroDeRechazo` escribe
    // el intento FUERA de esta transacción, para que el rollback del 422 no se
    // lo lleve — ver `CajaService.conRastroDeRechazo`.
    return this.cajaService.conRastroDeRechazo(params.tenantId, async () => {
      // Mismo loop que `crear()` y `cancelar()`: reponer toma un `FOR UPDATE`
      // por ítem, así que una NC puede cruzarse con una venta o una anulación
      // sobre los mismos productos. Va ADENTRO de `conRastroDeRechazo`: el 422
      // por falta de plata no es deadlock, no se reintenta y su rastro se
      // escribe una sola vez. La precondición es la de `crear()` —sin
      // transacción envolvente—: el controller no abre ninguna, y el hook de
      // reembolso corre después del commit del REFUND
      // (`CobrosService.aplicarPostReembolso`).
      //
      // La clave se reclama ADENTRO del loop (como `compras.confirmar`): un
      // `40P01` aborta la transacción de `ejecutar` con el reclamo incluido, y
      // el intento siguiente vuelve a reclamar como si fuera el primero.
      const emitir = () => this.crearNotaCreditoEnTransaccion(params);
      for (let intento = 0; ; intento++) {
        try {
          return await (params.idempotencia
            ? this.idempotencia.ejecutar(
                params.idempotencia,
                emitir,
                (r) => r.id,
              )
            : emitir());
        } catch (error) {
          if (intento >= MAX_REINTENTOS_DEADLOCK || !esDeadlock(error))
            throw error;
        }
      }
    });
  }

  /**
   * El tope por pago de una corrección: `devolvible` es lo que ese pago aplicó a
   * la venta menos lo ya devuelto por él (`devolucion_pago_id`), calculado bajo el
   * lock de la venta. `null` con las vías que no devuelven por un pago.
   *
   * ⚠️ El mensaje NO interpola el tope: dejaría adivinar, con un solo request
   * rechazado, lo que cobró cada pago (el mismo oráculo de la fuga 5, que ya se
   * cerró para el efectivo).
   */
  private exigirTopeDelPago(
    devolvible: string | null,
    monto: string,
    mensaje = 'El monto supera lo que queda por devolver por ese pago. Elegí otro pago o, si la venta todavía tiene saldo, emití la nota sin devolución de dinero.',
  ): void {
    if (devolvible !== null && new Decimal(monto).gt(devolvible))
      throw new BadRequestException(mensaje);
  }

  /**
   * El tope por pago de un REFUND de la pasarela, **antes** de llamar al proveedor
   * (el otro extremo del tope de la nota manual: el modal del POS ofrece el pago de
   * Webpay de una venta online "por la tarjeta", y lo que esa nota devolvió no puede
   * volver a salir por el proveedor). Lo llama `CobrosService.reembolsar` dentro de su
   * transacción, con el `FOR UPDATE` de la orden ya tomado: acá se toma el de la
   * venta, el mismo que toma la nota (`lockVentaOriginal`), y el cálculo es el de la
   * nota (`devolvibleDelPagoUnico`).
   *
   * Orden de bloqueo: orden → venta. La nota del POS toma solo la venta, así que
   * no cruza. Ver el comentario de `CobrosService.reembolsar`.
   *
   * Una venta que ya no existe no frena el reembolso (la plata de una orden ligada a
   * una venta rota igual tiene que poder volver; el hook lo avisa después), ni una
   * con más de un pago (no hay a cuál atribuirlo). El mensaje no lleva cifras.
   *
   * `excluirReembolsoId`: el REFUND en `iniciada` del propio reembolso, en su
   * re-verificación (tx1). Los demás sin confirmar gastan el tope (ADR-029).
   */
  async exigirTopeDelReembolsoPasarela(
    manager: EntityManager,
    params: {
      tenantId: string;
      ventaId: string;
      monto: string;
      excluirReembolsoId: string | null;
    },
  ): Promise<void> {
    try {
      await this.lockVentaOriginal(manager, params.tenantId, params.ventaId);
    } catch (e) {
      if (e instanceof NotFoundException) return;
      throw e;
    }
    const devolvible = await this.ventaDocumentosService.devolvibleDelPagoUnico(
      manager,
      {
        tenantId: params.tenantId,
        ventaId: params.ventaId,
        excluirReembolsoId: params.excluirReembolsoId,
      },
    );
    this.exigirTopeDelPago(
      devolvible,
      params.monto,
      'El monto supera lo que queda por devolver del pago de esa venta: parte de ese dinero ya se devolvió, por una nota de crédito o por un reembolso anterior.',
    );
  }

  private async crearNotaCreditoEnTransaccion(
    params: CrearNotaCreditoParams,
  ): Promise<NotaCreditoCreada> {
    return this.db.transaccion(async (manager) => {
      const original = await this.lockVentaOriginal(
        manager,
        params.tenantId,
        params.ventaOriginalId,
      );

      // Una corrección no se corrige (E7): se reconoce por `venta_referencia_id`
      // y no por el tipo de documento, porque una devolución interna no lo lleva.
      if (original.venta_referencia_id !== null)
        throw new BadRequestException(
          'No se puede emitir una nota de crédito sobre otra nota de crédito',
        );

      if (params.validarVentaElegible) {
        // Una venta PENDIENTE (nada pagado todavía) admite una sola nota: la que
        // no devuelve plata. No hay pago por el que vuelva dinero, pero sí una
        // deuda que el comercio ya corrigió en su facturador (la distribuidora
        // que vende a 30 días y el cliente devuelve todo). La cancelada sigue
        // afuera: se anuló, no se corrige.
        if (original.estado === 'pendiente' && params.via.tipo !== 'sin_plata')
          throw new BadRequestException(
            'Esta venta todavía no tiene pagos: la nota de crédito se emite sin devolución de dinero ("No vuelve plata").',
          );
        if (
          !['pendiente', 'pagada', 'pagada_parcial'].includes(original.estado)
        )
          throw new BadRequestException(
            'Solo se puede emitir nota de crédito de ventas pagadas, pagadas parcialmente o pendientes (estas últimas sin devolución de dinero)',
          );
        // La NC corrige aquel documento: hereda su criterio, no el vigente
        // (decisión g). Un null acá no es un caso histórico —después del
        // reset toda venta tiene config— sino que algo se rompió aguas
        // arriba: se falla ruidoso (decisión P5). Pero SOLO en el camino
        // manual: el webhook de reembolso (P3) no puede perder un hecho ya
        // consumado por un dato de configuración faltante, así que no pasa
        // por acá —no manda `validarVentaElegible`— y cuantiza más abajo
        // con su propio fallback documentado.
        if (!original.config_calculo) {
          throw new BadRequestException(
            `La venta ${params.ventaOriginalId} no tiene config_calculo congelada: no se ` +
              `puede emitir una nota de crédito heredando su criterio de redondeo.`,
          );
        }
      }
      const cfgOriginal = original.config_calculo;

      // Qué documento corrige, según por dónde vuelve la plata (spec § 3.6).
      // El servidor lo resuelve: el `pagoId` del body se valida contra ESTA
      // venta y ESTE tenant, y un `pagoId` ajeno es un 400 sin más.
      const destino = await this.ventaDocumentosService.documentoQueCorrige(
        manager,
        {
          tenantId: params.tenantId,
          ventaId: params.ventaOriginalId,
          via: params.via,
        },
      );
      // La corrección de un documento de `nadie` es una devolución interna: no
      // es un documento tributario, no lleva tipo y un país sin nota de crédito
      // sembrada no la frena. Todo lo demás exige el tipo NC del país.
      const esInterna = destino.documento?.emisor === 'nadie';
      const tipoNotaCredito = esInterna
        ? null
        : await this.exigirTipoNotaCredito(params.tenantId);

      // El receptor de la nota (`pendientes.md` → `resueltos.md`, "La nota de
      // crédito lleva el receptor de la venta que corrige"): el SII exige RUT y
      // razón social en TODA nota de crédito (Formato DTE v2.5). La nota va al
      // mismo cliente que la venta, así que se copia el suyo —todas las columnas,
      // para que la nota se lea sola, como su `config_calculo`—. Sin customer en
      // la venta, el que capturó el cajero; sin ninguno, la nota con tipo va a
      // nombre del emisor (FAQ SII 001.380.6571.003). La devolución interna no es
      // documento tributario: copia si hay, y nunca lleva la marca.
      const customerDeLaVenta: {
        tercero_id: string | null;
        nombre: string;
        rut: string | null;
        direccion: string | null;
        giro: string | null;
        comuna: string | null;
        telefono: string | null;
        email: string | null;
      }[] = await manager.query(
        `SELECT tercero_id, nombre, rut, direccion, giro, comuna, telefono, email
           FROM venta_customer
          WHERE venta_id = $1 AND eliminado_el IS NULL
          ORDER BY creado_el, customer_id`,
        [params.ventaOriginalId],
      );
      const receptores: Partial<VentaCustomer>[] = customerDeLaVenta.map(
        (c) => ({
          terceroId: c.tercero_id,
          nombre: c.nombre,
          rut: c.rut,
          direccion: c.direccion,
          giro: c.giro,
          comuna: c.comuna,
          telefono: c.telefono,
          email: c.email,
        }),
      );
      if (params.receptor) {
        if (receptores.length)
          throw new BadRequestException(
            'La nota de crédito va al mismo cliente que la venta: no se le cambia el receptor.',
          );
        const nombre = params.receptor.nombre.trim();
        if (!nombre)
          throw new BadRequestException(
            'El nombre del cliente no puede quedar en blanco',
          );
        // El RUT, como el de la venta (`receptorDeLaVenta`): en Chile se valida
        // y se guarda normalizado; en otro país, en pausa, como vino.
        let rut = params.receptor.rut.trim();
        const pais: { codigo_iso: string }[] = await manager.query(
          `SELECT p.codigo_iso
             FROM tenants t
             JOIN provincia prov ON prov.provincia_id = t.provincia_id
                  AND prov.eliminado_el IS NULL
             JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
            WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
          [params.tenantId],
        );
        if (pais[0]?.codigo_iso === CODIGO_ISO_CHILE) {
          if (!rutValido(rut))
            throw new BadRequestException('El RUT del cliente no es válido');
          rut = normalizarRut(rut);
        } else if (!rut) {
          throw new BadRequestException('Falta el RUT del cliente');
        }
        receptores.push({ terceroId: null, nombre, rut });
      }
      const receptorEsEmisor = tipoNotaCredito !== null && !receptores.length;

      // Σ correcciones previas bajo el lock: dos NCs concurrentes sobre la misma
      // venta se serializan y no pueden exceder el total juntas. Por
      // `venta_referencia_id` y no por el tipo: la devolución interna cuenta.
      const previasRows: { total: string }[] = await manager.query(
        `SELECT COALESCE(SUM(total_final), 0) AS total
         FROM ventas
         WHERE venta_referencia_id = $1
           AND eliminado_el IS NULL`,
        [params.ventaOriginalId],
      );
      const previas = new Decimal(previasRows[0]?.total ?? '0');
      const disponible = new Decimal(original.total_final).minus(previas);
      if (new Decimal(params.monto).gt(disponible))
        throw new BadRequestException(
          `El monto excede lo disponible para nota de crédito (${disponible.toString()})`,
        );
      // "No vuelve plata" rebaja lo que la venta todavía debe (spec § 3.6): no
      // puede pasar de ese saldo, que ya descuenta los abonos Y lo rebajado sin
      // plata por correcciones anteriores (una serie), y puede ser menor que el
      // documento de lo debido. Bajo el mismo lock. El mensaje no dice ningún monto.
      if (destino.saldo !== null && new Decimal(params.monto).gt(destino.saldo))
        throw new BadRequestException(
          'El monto supera lo que la venta todavía debe: "no vuelve plata" solo rebaja el saldo pendiente.',
        );
      // Y el tope por documento, bajo el mismo lock: lo corregido de un
      // documento no pasa su monto.
      if (destino.documento)
        await this.ventaDocumentosService.exigirTopeDelDocumento(manager, {
          tenantId: params.tenantId,
          documento: destino.documento,
          monto: params.monto,
        });
      // Y el tope por pago: una corrección que devuelve la plata por un pago no
      // pasa de lo que ese pago trajo a la venta (menos lo ya devuelto por él).
      // Ninguna máquina ni banco reversa más de lo que cobró, y el tope por
      // documento no lo acota cuando el medio emite `sistema` (la boleta es de
      // toda la venta). El efectivo lo chequea más abajo, DESPUÉS del tope del
      // efectivo de la venta: así el 422 con su rastro sigue siendo el que ve el
      // cajero que prueba cuánto efectivo hay (fuga 5), y este 400 no lo esquiva.
      if (!destino.mueveCaja)
        this.exigirTopeDelPago(destino.devolvibleDelPago, params.monto);

      const devueltas = await this.validarDevolucionesReembolso(
        manager,
        params.ventaOriginalId,
        params.devoluciones ?? [],
        // `validarVentaElegible` es hoy el único discriminante entre el camino
        // manual y el del webhook, y son exactamente las dos políticas.
        params.validarVentaElegible === true ? 'rechazar-imposible' : 'ignorar',
      );

      // El cuantizador de la nota. **Ignora `nivelRedondeo` a propósito**: sus
      // líneas son plata efectivamente devuelta y tienen que sumar un `monto`
      // que ya viene en escala de moneda. Es el mismo criterio que ya usaba el
      // valor de línea de la NC, ahora explícito en vez de heredado.
      //
      // Sin `config_calculo` congelada —solo alcanzable por el webhook de
      // reembolso, ver el guard de arriba— se cae al fallback documentado
      // (decisión P3): no se pierde un evento ya consumado.
      const q: Cuantizador = cfgOriginal
        ? (d) => cuantizar(d, cfgOriginal)
        : (d) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      const cfgReparto = cfgOriginal ?? CFG_SIN_CONGELAR;

      // 1. Lo que vale la mercadería devuelta EN ESTA BOLETA.
      const devoluciones = devueltas.map((l) => ({
        ...l,
        bruto: q(new Decimal(l.valorUnitarioBruto).times(l.cantidad)),
      }));
      const valorDevuelto = devoluciones.reduce(
        (a, l) => a.plus(l.bruto),
        new Decimal(0),
      );

      // 2. La composición del documento que se corrige y la de sus NCs previas,
      // en UNA sola consulta agregada: de acá salen las dos cosas que hacen
      // falta —la TASA de cada porción (de las filas del original) y el
      // REMANENTE por porción (original − NCs previas)—.
      const composicion: {
        es_nc: boolean;
        clasificacion: string;
        total: string;
        impuesto: string;
      }[] = await manager.query(
        `SELECT (d.venta_id <> $1) AS es_nc,
                d.clasificacion_tributaria AS clasificacion,
                COALESCE(SUM(d.total_linea), 0)::text AS total,
                COALESCE(SUM(d.impuesto_aplicado), 0)::text AS impuesto
           FROM venta_detalles d
          WHERE d.eliminado_el IS NULL
            -- Una sola lista y no \`= $1 OR IN (...)\`: ver el gemelo de
            -- \`unidadesComprometidasPorItem\`. Acá pesa el doble, porque esto
            -- corre **adentro de la transacción** que emite la nota de crédito.
            AND d.venta_id IN (
              SELECT venta_id FROM ventas
               WHERE venta_referencia_id = $1
                 AND eliminado_el IS NULL
              UNION ALL
              SELECT $1::uuid
            )
          GROUP BY 1, 2`,
        [params.ventaOriginalId],
      );
      const porcionesOriginal = composicion.filter((r) => !r.es_nc);
      const yaAcreditado = new Map<string, Decimal>();
      for (const r of composicion) {
        if (!r.es_nc) continue;
        yaAcreditado.set(
          r.clasificacion,
          (yaAcreditado.get(r.clasificacion) ?? new Decimal(0)).plus(r.total),
        );
      }
      // Lo que queda por acreditar de cada porción, ANTES de esta nota. Es el
      // tope por porción y la base del reparto.
      const remanentesPrevios = porcionesOriginal.map((r) => ({
        clasificacion: r.clasificacion,
        peso: new Decimal(r.total).minus(
          yaAcreditado.get(r.clasificacion) ?? new Decimal(0),
        ),
      }));
      // 3. Las líneas se escalan para sumar, como máximo, el monto de la nota.
      // Acreditar menos de lo que vale la mercadería es un caso real —cargo por
      // reposición, producto que vuelve dañado, un monto acordado en el
      // mostrador— y desde el 2026-09-04 se acepta en vez de rechazarse: ni el
      // SII lo prohíbe (cantidad y precio unitario son CONDICIONALES en la Zona
      // Detalle de una nota de crédito) ni el mercado lo rechaza (de 11
      // productos relevados, uno solo).
      const brutosEscalados = escalarDevoluciones(
        devoluciones.map((l) => l.bruto),
        new Decimal(params.monto),
        cfgReparto,
        q,
      );
      const escaladas = devoluciones.map((l, i) => ({
        ...l,
        bruto: brutosEscalados[i],
      }));
      const seEscalo = new Decimal(params.monto).lt(valorDevuelto);

      // El motivo pasa a ser obligatorio cuando la línea vale menos que la
      // mercadería: es lo único que va a explicar, en el documento, por qué. Es
      // el patrón de Square y Toast —donde el monto es libre, el motivo es
      // obligatorio— y reemplaza a la confirmación modal, que ninguno de los 11
      // productos relevados usa.
      //
      // La glosa va a la cabecera Y pegada al nombre del ítem en cada línea
      // escalada (ver el armado de `lineasNC`): pegada y no en su lugar, porque
      // la línea tiene que seguir diciendo QUÉ volvió.
      //
      // Guardado con `validarVentaElegible` por lo mismo de siempre: por el
      // webhook un throw pierde el evento. Hoy el handler siempre manda glosa
      // (`NC por reembolso orden X`), así que el guard no cambia nada — está
      // para que un llamador futuro sin glosa no pierda una nota.
      if (seEscalo && !params.comentario?.trim() && params.validarVentaElegible)
        throw new BadRequestException(
          `La mercadería a devolver vale ${valorDevuelto.toString()} y la nota acredita ` +
            `${new Decimal(params.monto).toString()}: indicá el motivo, que queda escrito en el documento.`,
        );

      // Lo que ESTA nota acredita por mercadería cuenta igual que una NC
      // previa: si no se descontara, el ajuste podría acreditar de una porción
      // más de lo que esa porción tenía, y la nota siguiente arrancaría con un
      // remanente NEGATIVO — una línea en negativo, con impuesto negativo.
      // Medido con el reparto real, no supuesto.
      //
      // ⚠️ Sobre las líneas YA ESCALADAS, y por eso este bloque va DESPUÉS del
      // escalado: sobre los valores crudos el tope de abajo rechazaría casos
      // que el escalado deja perfectamente adentro —devolver 2.380 acreditando
      // 500 asigna 500 a la porción afecta, no 2.380—.
      const devueltoAhora = new Map<string, Decimal>();
      for (const l of escaladas)
        devueltoAhora.set(
          l.clasificacionTributaria,
          (devueltoAhora.get(l.clasificacionTributaria) ?? new Decimal(0)).plus(
            l.bruto,
          ),
        );
      // 4. El único rechazo que sobrevive: la porción fiscal ya acreditada por
      // notas anteriores. Queda —y el de "vale más que el monto" se fue— porque
      // este es INVARIANTE FISCAL y no preferencia de producto: sin él, una
      // nota por monto libre se come capacidad AFECTA que la devolución
      // siguiente necesita, y la SERIE termina acreditando más IVA del que la
      // venta cobró, con cada documento cerrando bien por separado. Medido:
      // venta de 8.330 afecto (IVA 1.330) + 3.000 exento, una nota libre de
      // 1.000 y otra que devuelve las 7 unidades ⇒ 1.447 de IVA acreditado
      // contra 1.330 cobrado. El tope global contra `disponible` no lo ve
      // porque mira el bruto, no la porción.
      const acreditablePorPorcion = new Map(
        remanentesPrevios.map((r) => [r.clasificacion, r.peso]),
      );
      const porcionAgotada = [...devueltoAhora.entries()].find(
        ([clasificacion, monto]) =>
          monto.gt(acreditablePorPorcion.get(clasificacion) ?? new Decimal(0)),
      );
      const noEntraEnElDocumento = porcionAgotada !== undefined;

      if (porcionAgotada && params.validarVentaElegible)
        // El mensaje NO dice "ya se acreditó casi todo": la causa puede ser
        // esa, o puede ser el redondeo de partir el mismo ítem en varias
        // notas —con `total_linea` 1.001 en 3 unidades, cada una vale 334
        // cuantizado y la tercera pide 334 contra 333 que quedan—. Atribuirlo
        // a notas anteriores mandaría al operador a buscar algo que no está.
        throw new BadRequestException(
          `La mercadería a devolver vale ${porcionAgotada[1].toString()} en lo ` +
            `${porcionAgotada[0]} de esta venta, y solo quedan ` +
            `${(acreditablePorPorcion.get(porcionAgotada[0]) ?? new Decimal(0)).toString()} por ` +
            `acreditar —por notas anteriores, o por el redondeo de partir el mismo ítem en varias ` +
            `notas—. Emití la nota por lo que queda, o registrá la vuelta a stock desde Inventario.`,
        );

      // El rechazo es del camino MANUAL, donde el operador está mirando y puede
      // corregir. Por el webhook de reembolso (decisión P3) la plata ya volvió
      // por el proveedor y el hook corre DESPUÉS del commit: un throw acá se
      // traga como warning (`cobros.service.ts`) y se pierden la nota Y el
      // movimiento de stock. Así que ahí el documento se emite igual, por el
      // monto que el proveedor devolvió, **con las líneas de devolución fuera
      // del documento** —incluirlas rompería `Σ líneas = total_final` o el IVA
      // de la serie— y el stock vuelve igual: el movimiento de inventario se
      // registra abajo sobre TODAS las devoluciones pedidas, no sobre las que
      // quedaron en el documento. Lo que se pierde es el detalle de qué volvió
      // EN LA NOTA, que igual queda en `movimientos_inventario`.
      //
      // ⚠️ Se vacía el bloque ENTERO, no solo la porción agotada: dejar adentro
      // la mitad exenta de una devolución mixta cuya mitad afecta no entra
      // partiría el documento a la mitad sin decírselo a nadie. El mensaje
      // nombra la porción que topeó; la operación se rechaza completa.
      // Las que el escalado dejó en CERO no van al documento. Es la misma regla
      // que `repartirAjuste` ya aplica a sus partes —"una línea de importe cero
      // es ruido en el documento y puede no ser válida al emitirlo"— y no puede
      // valer para un reparto y no para el otro. Pasa cuando el monto es chico
      // frente a lo devuelto y las líneas tienen tamaños dispares: devolver un
      // televisor y tres accesorios acreditando 10 dejaba dos líneas diciendo
      // "Accesorio, 1 unidad, $300 c/u, total $0".
      //
      // ⚠️ Sale del DOCUMENTO, no de la operación: la mercadería vuelve al
      // stock igual —el loop de inventario recorre `devoluciones`, no esto— y
      // qué volvió queda en `movimientos_inventario` con su costo congelado.
      const devolucionesDelDocumento = noEntraEnElDocumento
        ? []
        : escaladas.filter((l) => !l.bruto.isZero());
      // Una sola resta para los tres casos, sin ramas: con las líneas escaladas
      // da 0, con lugar de sobra da el resto, y con las líneas fuera del
      // documento da el monto entero.
      const ajusteTotal = new Decimal(params.monto).minus(
        devolucionesDelDocumento.reduce(
          (a, l) => a.plus(l.bruto),
          new Decimal(0),
        ),
      );

      const remanentes = remanentesPrevios
        .map((r) => ({
          clasificacion: r.clasificacion,
          // El piso en cero es red y no regla, pero **sí se alcanza**: con el
          // corte de arriba la porción no puede quedar negativa por una
          // devolución, y con el reparto tampoco debería, pero el residuo del
          // paso de unidad puede correr una porción un minor unit por debajo.
          // Preferible que deje de atraer ajuste a que el documento salga con
          // plata negativa.
          //
          // Descuenta lo que esta nota devuelve **solo si esas líneas entran en
          // el documento**: si quedaron afuera (camino del webhook), no
          // acreditan nada y la porción sigue entera para el ajuste.
          peso: Decimal.max(
            r.peso.minus(
              devolucionesDelDocumento.length
                ? (devueltoAhora.get(r.clasificacion) ?? new Decimal(0))
                : new Decimal(0),
            ),
            0,
          ),
        }))
        // Orden fijo por clasificación: el desempate del reparto es por
        // POSICIÓN, así que dejarlo al orden que devuelva el planner movería
        // plata de una porción a la otra sin que nadie tocara nada.
        .sort((a, b) => a.clasificacion.localeCompare(b.clasificacion));

      const tasas = new Map(
        porcionesOriginal.map((r) => [
          r.clasificacion,
          tasaEfectiva(porcionesOriginal, r.clasificacion),
        ]),
      );
      const partir = (bruto: Decimal, clasificacion: string) =>
        descomponer(bruto, tasas.get(clasificacion) ?? new Decimal(0), q);

      // 5. Las líneas de la nota, primero en memoria: la cabecera se guarda
      // DESPUÉS porque sus totales se derivan de acá.
      interface LineaNotaCredito {
        itemId: string;
        descripcion: string | null;
        clasificacion: string;
        cantidad: string;
        precioUnitario: string;
        precioUnitarioOrigen: string | null;
        tasaCambio: string | null;
        monedaIdOrigen: string;
        unidadCodigoBase: string;
        bruto: Decimal;
        subtotal: Decimal;
        impuesto: Decimal;
        /** `null` en la línea de ajuste: es lo que decide el inventario. */
        itemDevuelto: string | null;
      }
      const glosa = params.comentario?.trim();
      const lineasNC: LineaNotaCredito[] = devolucionesDelDocumento.map((l) => {
        const { subtotal, impuesto } = partir(
          l.bruto,
          l.clasificacionTributaria,
        );
        return {
          itemId: l.itemId,
          // Cuando la línea vale menos que la mercadería, la glosa va PEGADA al
          // nombre del ítem y no en su lugar: el documento tiene que decir las
          // dos cosas —qué volvió y por qué se acreditó menos— y el modelo
          // tiene una sola columna de texto por línea. Pisar el nombre
          // reabriría por la otra punta lo que se acaba de arreglar (la nota
          // decía "Ajuste" en vez del nombre del plato).
          //
          // Sin escalado no se toca: ahí el importe habla solo, y la glosa ya
          // viaja en las líneas de ajuste.
          // `l.descripcion` es nullable: sin el ternario, una línea sin nombre
          // saldría con un bullet huérfano ("· Volvieron abiertas"), que
          // `.trim()` no saca porque el espacio no es el problema.
          descripcion:
            seEscalo && glosa
              ? l.descripcion
                ? `${l.descripcion} · ${glosa}`
                : glosa
              : l.descripcion,
          clasificacion: l.clasificacionTributaria,
          cantidad: l.cantidad,
          // El valor EFECTIVO por unidad —lo que esa unidad costó en esta
          // boleta— y no el precio de lista, que es lo que el documento tiene
          // que mostrar al lado de la cantidad.
          //
          // ⚠️ NO promete `precio × cantidad = total_linea`: sale de una
          // división (`Σ total_linea / Σ cantidad`) recortada a 4 decimales,
          // así que con 3 unidades de 1.000 da 333,3333 × 3 = 999,9999. El que
          // cierra exacto es `total_linea`.
          //
          // **Solo la línea ESCALADA lo deriva de su propio importe**, y ahí no
          // hay alternativa: con el valor congelado la pantalla afirmaría
          // `7 × $1.190 = $368`. La línea no escalada sigue con el valor de la
          // boleta a propósito — derivarlo también ahí cambiaría el número
          // persistido en más de la mitad de las líneas (medido: 52,6 % en CLP,
          // por el recorte de `q`) y volvería el precio unitario una propiedad
          // de CADA NOTA en vez de una de la venta: dos notas parciales del
          // mismo ítem quedarían con precios distintos. Eso es materia del
          // owner (ADR-010), y este frente no lo necesita.
          precioUnitario: seEscalo
            ? l.bruto.dividedBy(l.cantidad).toFixed(4)
            : new Decimal(l.valorUnitarioBruto).toFixed(4),
          precioUnitarioOrigen: l.precioUnitarioOrigen,
          tasaCambio: l.tasaCambio,
          monedaIdOrigen: l.monedaIdOrigen,
          unidadCodigoBase: l.unidadCodigoBase,
          bruto: l.bruto,
          subtotal,
          impuesto,
          itemDevuelto: l.itemId,
        };
      });

      // Un ajuste NEGATIVO significaría que las líneas ya suman más que el
      // monto, o sea un documento que no cierra. Es inalcanzable mientras la
      // escala validada en el borde sea la misma que la congelada en la venta
      // —y hoy lo es— pero el `if` de abajo lo descartaba en silencio, que es
      // exactamente el modo de falla que este frente vino a cerrar.
      //
      // ⚠️ NO va detrás de `validarVentaElegible`: si alguna vez se vuelve
      // alcanzable será por el webhook, y ahí el throw pierde el evento (P3).
      // Se elige igual —un documento que no cierra es peor que un reembolso sin
      // nota— pero el día que dispare, el warning de `cobros.service.ts` es el
      // único rastro.
      if (ajusteTotal.isNegative())
        throw new BadRequestException(
          `La nota de crédito de la venta ${params.ventaOriginalId} salió con líneas por ` +
            `${new Decimal(params.monto).minus(ajusteTotal).toString()} contra un monto de ` +
            `${new Decimal(params.monto).toString()}: no se emite un documento que no cierra.`,
        );
      if (ajusteTotal.isPositive()) {
        // Sin porciones no hay dónde repartir y `repartirAjuste` devolvería
        // `[]`: el documento saldría con las líneas sin sumar su total, en
        // silencio. Hoy es inalcanzable —nadie borra líneas de una venta— y por
        // eso es un error ruidoso y no una rama de negocio.
        if (!remanentes.length)
          throw new BadRequestException(
            `La venta ${params.ventaOriginalId} no tiene líneas vivas: no hay porción fiscal ` +
              `sobre la que componer la nota de crédito.`,
          );
        const partes = repartirAjuste(ajusteTotal, remanentes, cfgReparto, q);
        // El ítem de sistema se pide solo si hay ajuste, y con find-or-create,
        // para que el webhook de reembolso no pierda un evento ya consumado
        // porque falte un dato de configuración.
        //
        // ⚠️ La cura no es absoluta y conviene no leerla así: si el ítem NO
        // existe y dos notas del mismo tenant sobre ventas DISTINTAS corren en
        // paralelo, cada una toma el lock de su propia venta y las dos intentan
        // crearlo — una choca contra `uq_item_ajuste_nc_tenant` y aborta. Hoy
        // hace falta que alguien lo haya borrado por SQL: se siembra al crear
        // el tenant y `ItemsService.remove` lo rechaza.
        const itemAjuste = await this.itemsService.asegurarItemAjuste(
          manager,
          params.tenantId,
        );
        const { unidadBaseCodigo } = resolverUnidadBaseDeItem({
          tipo: itemAjuste.tipo,
        });
        for (const parte of partes) {
          const { subtotal, impuesto } = partir(
            parte.bruto,
            parte.clasificacion,
          );
          lineasNC.push({
            itemId: itemAjuste.id,
            // La glosa que escribió el operador, que es lo que explica por qué
            // se acredita plata que no corresponde a mercadería.
            descripcion: params.comentario ?? 'Ajuste',
            clasificacion: parte.clasificacion,
            cantidad: '1',
            precioUnitario: parte.bruto.toFixed(4),
            precioUnitarioOrigen: null,
            tasaCambio: null,
            monedaIdOrigen: original.moneda_id,
            unidadCodigoBase: unidadBaseCodigo,
            bruto: parte.bruto,
            subtotal,
            impuesto,
            itemDevuelto: null,
          });
        }
      }

      // 6. Los totales de la cabecera se DERIVAN de las líneas. `total_bruto`
      // es el NETO, igual que en una venta normal (`crear`), no el cobrado.
      const sumaSubtotales = lineasNC.reduce(
        (a, l) => a.plus(l.subtotal),
        new Decimal(0),
      );
      const sumaImpuestos = lineasNC.reduce(
        (a, l) => a.plus(l.impuesto),
        new Decimal(0),
      );

      const nc = await manager.save(
        Venta,
        manager.create(Venta, {
          tenantId: params.tenantId,
          cajaId: original.caja_id,
          monedaId: original.moneda_id,
          canal: original.canal,
          // Nulo en la devolución interna (`nadie`): no es un documento tributario.
          tipoDocumentoId: tipoNotaCredito,
          ventaReferenciaId: params.ventaOriginalId,
          // Por dónde volvió la plata: la auditoría de ese dato y lo que hace que
          // "no vuelve plata" sea una serie (lo rebajado baja el saldo).
          devolucionVia:
            params.via.tipo === 'sin_plata'
              ? 'sin_plata'
              : params.via.tipo === 'pasarela'
                ? 'pasarela'
                : 'pago',
          // Con la pasarela solo si la venta tiene un único pago (`viaDeReembolsoPasarela`):
          // la vía sigue siendo 'pasarela', pero lo devuelto cuenta en el tope de ese pago.
          devolucionPagoId:
            params.via.tipo === 'sin_plata' ? null : params.via.pagoId,
          estado: EstadoVenta.PAGADA,
          totalBruto: sumaSubtotales.toFixed(4),
          totalDescuentos: '0',
          totalRecargos: '0',
          totalImpuestos: sumaImpuestos.toFixed(4),
          totalFinal: params.monto,
          // Mismo cálculo que en `crear`. La NC copia `moneda_id` de la venta
          // original, que ya es la oficial: no hay conversión que hacer.
          baseVentasTotalFinal: new Decimal(params.monto).toFixed(4),
          baseVentasSinImpuestos: new Decimal(params.monto)
            .minus(sumaImpuestos)
            .toFixed(4),
          comentario: params.comentario ?? null,
          // La NC congela lo que heredó (decisión P4): así puede leerse
          // sola, sin ir a buscar la venta que corrige.
          configCalculo: cfgOriginal,
          receptorEsEmisor,
        }),
      );
      if (receptores.length)
        await manager.save(
          VentaCustomer,
          receptores.map((r) =>
            manager.create(VentaCustomer, { ...r, ventaId: nc.id }),
          ),
        );

      // 7. Las líneas, en un solo `save` con el array entero: el orden del
      // resultado es el del array, así que `detalles[i]` cruza con
      // `lineasNC[i]` para las filas de impuesto de abajo.
      const detalles = await manager.save(
        VentaDetalle,
        lineasNC.map((l) =>
          manager.create(VentaDetalle, {
            ventaId: nc.id,
            itemId: l.itemId,
            monedaIdOrigen: l.monedaIdOrigen,
            precioUnitarioOrigen: l.precioUnitarioOrigen,
            tasaCambio: l.tasaCambio,
            precioUnitario: l.precioUnitario,
            descripcion: l.descripcion,
            clasificacionTributaria: l.clasificacion,
            unidadCodigoBase: l.unidadCodigoBase,
            cantidad: l.cantidad,
            subtotal: l.subtotal.toFixed(4),
            // Una NC no negocia: no hay descuento, recargo ni prorrateo que
            // aplicar sobre lo que se acredita.
            descuentoAplicado: '0',
            recargoAplicado: '0',
            ajusteVenta: '0',
            impuestoAplicado: l.impuesto.toFixed(4),
            totalLinea: l.bruto.toFixed(4),
          }),
        ),
      );

      // El documento de la corrección (spec § 3.6), con los baldes de sus propias
      // líneas, que acaban de guardarse. Sin documento corregido (venta sin
      // documentos, país sin boleta) la nota se emite como siempre.
      if (destino.documento)
        await this.ventaDocumentosService.documentarCorreccion(manager, {
          tenantId: params.tenantId,
          correccionVentaId: nc.id,
          corregido: destino.documento,
          monto: params.monto,
          tipoNotaCreditoId: tipoNotaCredito,
        });

      // "No vuelve plata" rebaja lo que la venta debe, así que puede dejarla sin
      // saldo: el estado se recalcula con la regla de siempre (bajo el lock de la
      // venta que tomó `lockVentaOriginal`) y una venta que ya no debe nada pasa a
      // `pagada`, sin "Registrar pago". Las demás vías devolvieron plata y no
      // mueven el saldo: no hay nada que recalcular.
      if (params.via.tipo === 'sin_plata')
        await recalcularEstadoDeLaVenta(
          manager,
          params.tenantId,
          params.ventaOriginalId,
        );

      // 8. Las filas de impuesto de la nota, derivadas de las del original.
      await this.escribirImpuestosNotaCredito(
        manager,
        params.ventaOriginalId,
        nc.id,
        lineasNC.map((l, i) => ({
          detalleId: detalles[i].id,
          itemDevuelto: l.itemDevuelto,
          clasificacion: l.clasificacion,
          impuesto: l.impuesto,
        })),
        cfgReparto,
        q,
      );

      // 9. Inventario: **solo las líneas de devolución**. La de ajuste cuelga
      // de un `servicio`, y `registrarMovimiento` rechaza con 400 todo lo que
      // no sea producto (`inventario.service.ts`): sin este corte, agregar la
      // línea de ajuste haría fallar el reembolso ENTERO.
      //
      // Una sola lectura de costos para todas: los costos congelados son de la
      // venta ORIGINAL, no de la NC que se está creando. La NC por monto libre
      // —sin devoluciones, el caso más común— no paga la query.
      //
      // Y **solo las que reponen**: desde el 2026-09-04 una línea puede
      // acreditarse sin volver al stock (producto que vuelve roto, receta que
      // no se puede rearmar), y `registrarMovimiento` rechazaría con 400 todo
      // lo que no sea producto.
      //
      // En orden por `itemId`, con el MISMO comparador que `crear()` y
      // `cancelar()` (`localeCompare`, no el `ORDER BY` de Postgres): llegaban
      // en el orden del array del cliente, y dos devoluciones cruzadas sobre
      // los mismos ítems podían bloquearse en cruz.
      const aReponer = devoluciones
        .filter((l) => l.reponeStock)
        .sort((a, b) => a.itemId.localeCompare(b.itemId));
      const costosOriginales = aReponer.length
        ? await this.costosDeSalidaPorItem(manager, params.ventaOriginalId)
        : new Map<string, string | null>();
      // Resuelto UNA vez antes del loop: `localDe` por línea sería una
      // consulta por línea devuelta, N+1.
      const ubicacionLocalId = aReponer.length
        ? await this.ubicacionesService.localDe(params.tenantId)
        : null;
      for (const linea of aReponer) {
        await this.inventarioService.registrarMovimiento(manager, {
          tenantId: params.tenantId,
          itemId: linea.itemId,
          ubicacionId: ubicacionLocalId!,
          tipo: 'entrada',
          motivo: 'devolucion',
          cantidad: linea.cantidad,
          // El costo sale de la venta ORIGINAL, no de esta NC: el movimiento
          // queda ligado a `nc.id`, pero la unidad que vuelve salió allá.
          costoUnitario: costosOriginales.get(linea.itemId) ?? null,
          usuarioId: params.usuarioId,
          ventaId: nc.id,
          comentario: params.comentario,
        });
      }

      let movimientoCajaId: string | null = null;
      // La plata sale de la caja solo si el pago elegido fue en efectivo. Con
      // otro medio la reversa se hace por fuera (la máquina, el banco) y no se
      // mueve caja.
      if (destino.mueveCaja) {
        // `mueveCaja` solo sale de la vía `pago` (efectivo), que trae el usuario
        // del token; la vía `pasarela` —la única que llega sin usuario— devuelve
        // siempre `mueveCaja: false` (`documentoQueCorrige`).
        const usuarioId = params.usuarioId;
        if (usuarioId === null)
          throw new UnprocessableEntityException(
            'Mover caja requiere un usuario autenticado',
          );
        const caja = await this.cajaService.findActiva(
          params.tenantId,
          usuarioId,
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
        // Tope de la devolución EN EFECTIVO: lo que esa venta cobró en efectivo,
        // menos lo ya devuelto en efectivo por NCs anteriores. El saldo global de
        // la caja (abajo) no alcanza como control: viene de otras ventas, así que
        // sin este tope se puede sacar plata que esta venta nunca ingresó, y dar
        // billetes por una compra con tarjeta — el vector de fraude interno que
        // Clover, Lightspeed y Toast bloquean por diseño.
        // OJO: acota el DINERO, no el documento. La NC puede seguir emitiéndose
        // por el total (tope `total_final − Σ NCs previas`, regla dura del SII):
        // anular una venta a crédito es legítimo, devolver efectivo que nunca
        // entró no lo es. Ver docs/agent/investigaciones/2026-07-27-…
        const efectivoRows: { cobrado: string; devuelto: string }[] =
          await manager.query(
            `SELECT
               COALESCE((
                 SELECT SUM(pa.monto)
                 FROM pagos p
                 JOIN pago_aplicaciones pa ON pa.pago_id = p.pago_id
                      AND pa.eliminado_el IS NULL AND pa.tipo = 'venta'
                 JOIN metodos_pago mp ON mp.metodo_pago_id = p.metodo_pago_id
                      AND mp.es_efectivo = true AND mp.eliminado_el IS NULL
                 WHERE p.venta_id = $1 AND p.eliminado_el IS NULL
               ), 0)::text AS cobrado,
               COALESCE((
                 SELECT SUM(mc.monto)
                 FROM ventas nc
                 JOIN movimientos_caja mc ON mc.venta_id = nc.venta_id
                      AND mc.tipo = 'salida' AND mc.eliminado_el IS NULL
                 WHERE nc.venta_referencia_id = $1
                   AND nc.eliminado_el IS NULL
               ), 0)::text AS devuelto`,
            [params.ventaOriginalId],
          );
        const devolvibleEfectivo = new Decimal(
          efectivoRows[0]?.cobrado ?? '0',
        ).minus(efectivoRows[0]?.devuelto ?? '0');
        // ⚠️ El mensaje NO interpola `devolvibleEfectivo`. Ese número era la
        // fuga 5 del modo ciego: un solo request rechazado con monto = techo + 1
        // entregaba el efectivo cobrado de la venta, sin emitir ninguna NC. El
        // tope sigue igual de duro; lo que se fue es el número, y en su lugar
        // queda el rastro del intento.
        if (new Decimal(params.monto).gt(devolvibleEfectivo))
          throw new IntentoRechazadoError(
            'No se puede devolver en efectivo más de lo que esta venta cobró en efectivo. Emití la nota de crédito sin devolución de dinero, o devolvé por el medio de pago original.',
            {
              cajaId: caja.id,
              usuarioId,
              tipo: 'devolucion_nc',
              motivo: 'supera_efectivo_de_la_venta',
              montoSolicitado: new Decimal(params.monto).toFixed(4),
              ventaId: params.ventaOriginalId,
            },
          );

        // El tope por pago también rige para el efectivo: dos pagos en efectivo
        // suman el tope de arriba, pero cada uno devuelve solo lo suyo.
        this.exigirTopeDelPago(destino.devolvibleDelPago, params.monto);

        const saldoEfectivo = await this.cajaService.calcularEsperadoEfectivo(
          caja.id,
          manager,
        );
        if (new Decimal(saldoEfectivo).minus(params.monto).lt(0))
          throw new IntentoRechazadoError('Saldo insuficiente en caja', {
            cajaId: caja.id,
            usuarioId,
            tipo: 'devolucion_nc',
            motivo: 'saldo_insuficiente',
            montoSolicitado: new Decimal(params.monto).toFixed(4),
            ventaId: params.ventaOriginalId,
          });
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

      await params.enLaTransaccion?.(manager, nc.id);

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
   * El documento que corrige un reembolso de pasarela. **Nunca lanza**: la plata
   * ya volvió por el proveedor y un hecho consumado se registra, no se rechaza
   * (P3). Hoy solo dos caminos ligan una orden a una venta, y los dos dejan una
   * venta online con **un** pago y **a lo sumo un** documento (cero en un país sin
   * boleta sembrada o con total $0): el callback online, que crea la
   * venta online (`online-callback.handler.ts`), y `CobrosService.vincularVenta`,
   * cuyo único llamador es la venta inicial de la suscripción
   * (`suscripciones.service.ts`). Por eso contar alcanza: se miran los documentos
   * válidos de la venta (vigentes y no duplicados) y sus pagos, y las ramas de
   * "más de uno" son la defensa para un ligador futuro, no un caso de hoy.
   * - uno solo (la boleta de la venta online, E5) → la corrección lo corrige;
   * - ninguno → corrección sin fila de documento, como siempre (tipo NC);
   * - más de uno (inalcanzable hoy: online y factura son un solo documento) →
   *   también sin fila de documento, y queda un `warn` con la venta y la orden:
   *   elegir uno sería adivinar.
   * - un único pago en la venta → la corrección lo anota (`devolucion_pago_id`) y gasta su
   *   tope por pago; con 0 queda sin pago (una venta $0 no es rara) y con más de uno
   *   también, con un `warn` igual al de los documentos.
   * Lo llama el hook de reembolso, que corre fuera de toda transacción.
   */
  async viaDeReembolsoPasarela(
    tenantId: string,
    ventaId: string,
    ordenId: string,
  ): Promise<ViaCorreccion> {
    const documentos: { documento_id: string }[] = await this.db.query(
      `SELECT documento_id
         FROM venta_documentos
        WHERE venta_id = $1
          AND tenant_id = $2
          AND descarte IS NULL
          AND es_duplicado = false
          AND eliminado_el IS NULL`,
      [ventaId, tenantId],
    );
    if (documentos.length > 1)
      this.logger.warn(
        `Reembolso de la orden ${ordenId}: la venta ${ventaId} tiene ${documentos.length} documentos válidos y la corrección no sabe cuál corregir; se emite sin documento.`,
      );
    // El pago por el que volvió la plata, solo si no hay duda: con un único pago la
    // venta online (o la que se ligó a la orden) devolvió por él, y esa devolución
    // tiene que contar en su tope por pago. Con 0 o más de uno se queda sin pago:
    // elegir uno sería adivinar. LIMIT 2: solo importa si hay uno o más.
    const pagos: { pago_id: string }[] = await this.db.query(
      `SELECT pago_id
         FROM pagos
        WHERE venta_id = $1
          AND tenant_id = $2
          AND eliminado_el IS NULL
        LIMIT 2`,
      [ventaId, tenantId],
    );
    if (pagos.length > 1)
      this.logger.warn(
        `Reembolso de la orden ${ordenId}: la venta ${ventaId} tiene más de un pago y la corrección no sabe por cuál volvió la plata; se emite sin pago.`,
      );
    return {
      tipo: 'pasarela',
      documentoId: documentos.length === 1 ? documentos[0].documento_id : null,
      pagoId: pagos.length === 1 ? pagos[0].pago_id : null,
    };
  }

  /**
   * NC creada manualmente desde el detalle de una venta (POS): exige venta
   * pagada/pagada_parcial que no sea otra NC, y permite el egreso de caja
   * elegible. El flujo de reembolsos de pasarela usa `crearNotaCredito`
   * directo y NO pasa por estas reglas.
   *
   * Tampoco pasa por el alcance de caja, que va acá y no en `crearNotaCredito`:
   * el reembolso de pasarela lo dispara el sistema, no un cajero. Acá se mira
   * antes de abrir la transacción —la caja de una venta no cambia, así que no
   * hay carrera— y sin `conRastroDeRechazo`: un 404 no es un rechazo por plata.
   */
  async crearNotaCreditoDesdeVenta(params: {
    tenantId: string;
    usuarioId: string;
    /** El alcance de caja de `findOne` (`exigirVentaVisible`). */
    verTodas: boolean;
    ventaOriginalId: string;
    monto: string;
    devoluciones?: DevolucionReembolso[];
    comentario?: string;
    receptor?: ReceptorNotaCreditoDto;
    via: ViaCorreccion;
    /** La `Idempotency-Key` del intento de emisión (ADR-026). */
    clave: string;
  }): Promise<NotaCreditoCreada & { repetida?: true }> {
    const { verTodas, clave, ...nota } = params;
    await this.exigirVentaVisible(this.db, {
      tenantId: nota.tenantId,
      usuarioId: nota.usuarioId,
      verTodas,
      ventaId: nota.ventaOriginalId,
    });
    return this.crearNotaCredito({
      ...nota,
      validarVentaElegible: true,
      idempotencia: {
        tenantId: nota.tenantId,
        usuarioId: nota.usuarioId,
        clave,
        operacion: 'notaCredito.emitir',
        // Todo lo que el request pidió, campo por campo: la venta de la ruta y
        // el cuerpo entero (no trae credenciales). Las devoluciones van
        // ordenadas: los mismos ítems marcados en otro orden son la misma
        // nota, y reproducirla devuelve la que ya entró.
        huella: huellaDe('notaCredito.emitir', {
          ventaId: nota.ventaOriginalId,
          monto: nota.monto,
          comentario: nota.comentario ?? null,
          devoluciones: [...(nota.devoluciones ?? [])]
            .map((d) => ({
              itemId: d.itemId,
              cantidad: d.cantidad,
              reponerStock: d.reponerStock ?? null,
            }))
            .sort((a, b) =>
              `${a.itemId}|${a.cantidad}|${String(a.reponerStock)}`.localeCompare(
                `${b.itemId}|${b.cantidad}|${String(b.reponerStock)}`,
              ),
            ),
          via: nota.via,
          // Otro receptor es otra nota: el documento va a otra persona. Sin
          // receptor va `undefined`, que `huellaDe` descarta: la huella de una
          // nota sin receptor es la misma que antes de que existiera el campo, y
          // una clave emitida antes del deploy no se vuelve 422 al reintentarla.
          receptor: nota.receptor
            ? { nombre: nota.receptor.nombre, rut: nota.receptor.rut }
            : undefined,
        }),
        mensajeOtrosDatos: MENSAJE_NOTA_CREDITO_OTROS_DATOS,
      },
    });
  }

  /**
   * El `terceroId` del customer de una venta no se validaba en absoluto: el DTO
   * solo exige formato UUID (`@IsUUID()`) y el service lo persistía tal cual. La
   * FK de `venta_customer.tercero_id` (`startup-pos.sql`) referencia `terceros`
   * sin tenant, así que garantizaba existencia y nada más.
   *
   * Dos cosas se cierran acá, y la primera vino con la segunda:
   * - **El tercero tiene que ser de este tenant.** Sin esto, un POST con el id
   *   de un tercero ajeno quedaba guardado en la venta. Hoy no filtra datos
   *   —`venta_customer` denormaliza nombre/RUT y ninguna lectura hace JOIN a
   *   `terceros`— pero es una FK cruzada entre tenants, que no es un estado que
   *   convenga tener escrito esperando al primer JOIN que alguien agregue.
   * - **Un tercero pausado no admite asignaciones nuevas** (decisión del owner,
   *   2026-08-11). Igual que en `validarCategoria`: hasta ahora lo sostenía solo
   *   `ClienteForm.vue`, que filtra por `activo`; el backend aceptaba el POST
   *   directo. Los vínculos ya existentes no se tocan.
   */
  private async validarTercero(
    manager: EntityManager,
    tenantId: string,
    terceroId: string,
  ): Promise<void> {
    const rows: { nombre: string; activo: boolean }[] = await manager.query(
      `SELECT nombre, activo FROM terceros
        WHERE tercero_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [terceroId, tenantId],
    );
    if (!rows.length) {
      throw new BadRequestException('El tercero no pertenece a este tenant');
    }
    if (!rows[0].activo) {
      throw new BadRequestException(
        `El tercero "${rows[0].nombre}" está pausado y no admite asignaciones nuevas`,
      );
    }
  }

  /**
   * Lo que impide anular una venta **antes de mirar sus documentos**: el estado,
   * los pagos y las correcciones. Devuelve el 400 que corresponde, o `null` si ninguno la impide.
   *
   * Es la regla **única** de las dos preguntas "¿se puede anular?": la responde
   * `cancelarUnaVez` (que lanza el motivo) y el `anulable` del detalle (que solo
   * mira si hay motivo). Lo emitido lo dice `VentaDocumentosService.evaluarAnulacion`
   * después. Mira el estado antes que los pagos: si el estado ya la impide, no
   * gasta la consulta (y el detalle, que ya cargó los pagos, ni siquiera la hace).
   *
   * `estado` es el de la fila cruda, un string: el literal y no `EstadoVenta.PENDIENTE`,
   * como en `crearNotaCredito`.
   */
  private async motivoQueImpideAnular(
    lector: EntityManager | Db,
    params: {
      ventaId: string;
      estado: string;
      /**
       * Si el llamador ya sabe si la venta tiene pagos (el detalle los cargó),
       * lo pasa y no se repite la consulta. `cancelarUnaVez` no lo pasa: lee
       * bajo el lock de la venta, que es lo que la hace confiable.
       */
      tienePagos?: boolean;
      /** Igual que `tienePagos`, para las correcciones (el detalle ya cargó sus notas). */
      tieneCorrecciones?: boolean;
    },
  ): Promise<string | null> {
    if (params.estado !== 'pendiente')
      return `Solo se anula una venta pendiente (esta está "${params.estado}"). Una venta cobrada se revierte con nota de crédito.`;
    let conPagos = params.tienePagos;
    if (conPagos === undefined) {
      const filas: unknown[] = await lector.query(
        `SELECT 1 FROM pagos
          WHERE venta_id = $1 AND eliminado_el IS NULL
          LIMIT 1`,
        [params.ventaId],
      );
      conPagos = filas.length > 0;
    }
    if (conPagos)
      return 'La venta tiene pagos registrados: se revierte con nota de crédito, no se anula.';
    // Una venta pendiente puede tener una corrección (la nota "no vuelve plata"
    // parcial la deja pendiente y sin pagos). Anularla repondría el stock otra vez
    // —la nota ya devolvió sus devoluciones— y dejaría una nota viva sobre una venta
    // cancelada, que el vendido neto resta de más. Lo que queda por rebajar se
    // rebaja con otra nota (owner, 2026-10-02). Cualquier corrección vigente cuenta,
    // sin mirar su tipo: es `venta_referencia_id`, como en todo lo demás.
    let conCorrecciones = params.tieneCorrecciones;
    if (conCorrecciones === undefined) {
      const filas: unknown[] = await lector.query(
        `SELECT 1 FROM ventas
          WHERE venta_referencia_id = $1 AND eliminado_el IS NULL
          LIMIT 1`,
        [params.ventaId],
      );
      conCorrecciones = filas.length > 0;
    }
    if (conCorrecciones)
      return 'La venta ya tiene una nota de crédito: lo que queda se rebaja con otra nota, no se anula.';
    return null;
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
    venta_referencia_id: string | null;
    config_calculo: ConfigCalculo | null;
  }> {
    const rows: {
      venta_id: string;
      caja_id: string | null;
      moneda_id: string;
      canal: string;
      total_final: string;
      estado: string;
      tipo_documento_id: string | null;
      venta_referencia_id: string | null;
      config_calculo: ConfigCalculo | null;
    }[] = await manager.query(
      `SELECT venta_id, caja_id, moneda_id, canal, total_final, estado, tipo_documento_id,
              venta_referencia_id, config_calculo
       FROM ventas
       WHERE venta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       FOR UPDATE`,
      [ventaOriginalId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Venta no encontrada');
    return rows[0];
  }

  /**
   * Cuántas unidades de cada ítem de una venta ya están comprometidas por
   * devoluciones previas — el tope de `cantidad` de la devolución siguiente.
   *
   * Hasta el 2026-09-04 alcanzaba con contar `movimientos_inventario`: toda
   * línea aceptada movía stock, así que el movimiento ERA el rastro de la
   * unidad. Desde que una línea se puede acreditar **sin** reponer, ese
   * contador se quedó ciego justo para las líneas nuevas: dos notas seguidas
   * podían acreditar la misma receta y el documento afirmaba que volvieron 2
   * unidades de una venta de 1. El tope por porción fiscal no lo tapa —mira
   * PLATA por porción, no cantidad por ítem— así que basta con que otra línea
   * afecta de la misma venta done capacidad.
   *
   * Por eso cuenta las dos cosas y se queda con la mayor **por documento**:
   * - las líneas de las notas de crédito hijas (lo acreditado), y
   * - los movimientos de devolución de esta venta o de sus notas (lo repuesto).
   *
   * `GREATEST` y no la suma porque la línea que repone deja las DOS huellas y
   * sumarlas contaría doble. El caso donde una sola huella existe es real: la
   * línea que se acredita sin reponer deja solo la del documento.
   *
   * Filtra por `venta_referencia_id` sin mirar el tipo de documento porque esa
   * columna la escribe un solo lugar —la creación de la nota de crédito—, mismo
   * criterio que la consulta de composición.
   */
  private async unidadesComprometidasPorItem(
    ventaOriginalId: string,
  ): Promise<Map<string, Decimal>> {
    // `this.db.query` resuelve el manager de la transacción activa (ADR-020):
    // los dos llamadores —uno adentro de la transacción de la nota, otro en la
    // lectura del detalle— comparten esta consulta sin enhebrar el manager.
    const filas: { item_id: string; devuelto: string }[] = await this.db.query(
      `WITH docs AS (
         SELECT venta_id FROM ventas
          WHERE venta_referencia_id = $1 AND eliminado_el IS NULL
       ),
       lineas AS (
         SELECT d.venta_id, d.item_id, SUM(d.cantidad) AS cant
           FROM venta_detalles d
           JOIN docs ON docs.venta_id = d.venta_id
          WHERE d.eliminado_el IS NULL
          GROUP BY 1, 2
       ),
       movs AS (
         SELECT m.venta_id, m.item_id, SUM(m.cantidad) AS cant
           FROM movimientos_inventario m
          WHERE m.motivo = 'devolucion' AND m.eliminado_el IS NULL
            -- El \`IN\` de una sola lista, y no \`= $1 OR venta_id IN (docs)\`:
            -- son equivalentes, pero con el \`OR\` el planner no usa el índice
            -- por \`venta_id\` y cae a seq scan de \`movimientos_inventario\`.
            -- Medido con 30.000 movimientos y un 20% de filas \`devolucion\`:
            -- este nodo pasa de 3,8 ms (seq scan) a 0,10 ms.
            -- La alternativa —un índice PARCIAL por \`motivo = 'devolucion'\`— se
            -- midió y es la salida chica: con el \`OR\` puesto baja a 1,4-1,9 ms, contra
            -- los 0,10 que da sacarlo. Ver \`docs/patterns/backend.md\` § 17.
            AND m.venta_id IN (
              SELECT venta_id FROM docs
              UNION ALL
              SELECT $1::uuid
            )
          GROUP BY 1, 2
       )
       SELECT COALESCE(l.item_id, mv.item_id) AS item_id,
              SUM(GREATEST(COALESCE(l.cant, 0), COALESCE(mv.cant, 0)))::text AS devuelto
         FROM lineas l
         FULL OUTER JOIN movs mv
           ON mv.venta_id = l.venta_id AND mv.item_id = l.item_id
        GROUP BY 1`,
      [ventaOriginalId],
    );
    return new Map(filas.map((f) => [f.item_id, new Decimal(f.devuelto)]));
  }

  /**
   * Valida las devoluciones contra el detalle de la venta original y devuelve
   * las líneas listas para acreditar y, las que corresponda, para mover stock.
   * Se valida TODO antes de tocar inventario para fallar con un mensaje de
   * negocio claro.
   *
   * Hasta el 2026-09-04 exigía `modo_inventario = 'cantidad'` para TODAS: el
   * ítem que no podía volver al stock tampoco podía nombrarse en la nota, y por
   * eso recetas, combos y servicios caían al balde de ajuste —la nota decía
   * "Ajuste" en vez del nombre del plato—. La razón de ese corte era el
   * INVENTARIO, así que hoy dispara solo cuando se pide reponer.
   */
  private async validarDevolucionesReembolso(
    manager: EntityManager,
    ventaOriginalId: string,
    devoluciones: DevolucionReembolso[],
    /**
     * Qué hacer con una línea que NO va a volver al stock. Son dos caminos con
     * dos políticas, y por eso no alcanza un booleano:
     *
     * - `'rechazar-imposible'` — nota de crédito manual. Solo rechaza si se
     *   PIDIÓ reponer algo que no puede; lo que no repone se acredita igual.
     * - `'ignorar'` — nota de crédito por el webhook de reembolso. Nunca
     *   rechaza: el hook corre después del commit y un throw pierde el evento
     *   (`cobros.service.ts` se lo traga como warning), así que se acredita y
     *   no se repone.
     */
    politicaReposicion: 'rechazar-imposible' | 'ignorar',
  ): Promise<
    {
      itemId: string;
      cantidad: string;
      precioUnitario: string;
      precioUnitarioOrigen: string | null;
      tasaCambio: string | null;
      monedaIdOrigen: string;
      descripcion: string | null;
      clasificacionTributaria: string;
      unidadCodigoBase: string;
      /**
       * Lo que UNA unidad de ese ítem costó EN ESTA BOLETA: `Σ total_linea / Σ
       * cantidad` sobre las filas del ítem. No el precio de lista: `total_linea`
       * ya lleva adentro el descuento de línea, el recargo y la parte
       * prorrateada del descuento de nivel venta (`venta-detalle.entity.ts`).
       * Valuar al precio de lista acreditaría de más en toda venta con
       * descuento — y desde que las líneas de la NC tienen que sumar su
       * `total_final`, eso ya no es un número que nadie mira: descuadra el
       * documento.
       */
      valorUnitarioBruto: string;
      /**
       * ¿Esta línea vuelve al inventario? Ya resuelto acá —lo pedido cruzado
       * con lo que el ítem puede— para que el loop de inventario no vuelva a
       * decidirlo. Una línea con `false` se acredita igual: es plata en el
       * documento, no una unidad en el stock.
       */
      reponeStock: boolean;
    }[]
  > {
    if (!devoluciones.length) return [];
    // Dos entradas del mismo ítem se validaban cada una contra el mismo
    // disponible, así que `[{a,2},{a,2}]` pasaba con 3 vendidas. Antes eso
    // "solo" duplicaba el movimiento de stock; ahora además duplica el valor
    // devuelto, que es plata en un documento fiscal. Se rechaza en vez de
    // sumarlas: si el operador quiere devolver 4, que pida 4.
    const itemsPedidos = new Set<string>();
    for (const dev of devoluciones) {
      if (itemsPedidos.has(dev.itemId))
        throw new BadRequestException(
          'El mismo ítem viene dos veces en la devolución: mandá una sola línea con la cantidad total',
        );
      itemsPedidos.add(dev.itemId);
    }

    const detalles: {
      item_id: string;
      cantidad: string;
      precio_unitario: string;
      precio_unitario_origen: string | null;
      tasa_cambio: string | null;
      moneda_id_origen: string;
      descripcion: string | null;
      clasificacion_tributaria: string;
      unidad_codigo_base: string;
      total_linea: string;
      modo_inventario: string | null;
    }[] = await manager.query(
      `SELECT d.item_id, d.cantidad, d.precio_unitario, d.precio_unitario_origen,
              d.tasa_cambio, d.moneda_id_origen, d.descripcion, d.clasificacion_tributaria,
              d.unidad_codigo_base, d.total_linea,
              ip.modo_inventario
       FROM venta_detalles d
       LEFT JOIN item_producto ip ON ip.item_id = d.item_id
       WHERE d.venta_id = $1 AND d.eliminado_el IS NULL`,
      [ventaOriginalId],
    );
    const devueltoPorItem =
      await this.unidadesComprometidasPorItem(ventaOriginalId);

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
      // Este corte disparaba por el solo hecho de nombrar el ítem. Su razón es
      // el INVENTARIO, así que hoy dispara según lo que el camino pida del
      // stock; lo que no puede reponer se acredita igual en la nota.
      const puedeReponer = detalle.modo_inventario === 'cantidad';
      const quiereReponer = dev.reponerStock ?? puedeReponer;
      const reponeStock = quiereReponer && puedeReponer;
      const noPuedeReponer = () =>
        new BadRequestException(
          detalle.modo_inventario === null
            ? `"${detalle.descripcion ?? dev.itemId}" no maneja stock (servicio): no admite devolución a inventario`
            : `"${detalle.descripcion ?? dev.itemId}" usa inventario por ${detalle.modo_inventario}: la devolución debe registrarse manualmente desde Inventario`,
        );
      // Con `'rechazar-imposible'`, lo que no puede reponer se acredita igual y
      // solo se corta si alguien PIDIÓ que repusiera.
      if (!reponeStock && politicaReposicion !== 'ignorar' && quiereReponer)
        throw noPuedeReponer();
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
        clasificacionTributaria: detalle.clasificacion_tributaria,
        // Se copia de la línea original: la NC devuelve lo mismo que se vendió,
        // en la misma unidad, aunque el ítem haya cambiado de unidad después.
        unidadCodigoBase: detalle.unidad_codigo_base,
        // Sobre las MISMAS filas que ya se leyeron para topear la cantidad: no
        // hay consulta de más.
        valorUnitarioBruto: vendida.isZero()
          ? '0'
          : filas
              .reduce((a, f) => a.plus(f.total_linea), new Decimal(0))
              .dividedBy(vendida)
              .toString(),
        reponeStock,
      };
    });
  }

  /**
   * Las filas de `ventas_impuestos` de una nota de crédito, derivadas de las del
   * documento que corrige. No se recalculan contra el catálogo: `item_impuestos`
   * pudo cambiar, y la NC corrige aquel documento con aquel criterio.
   *
   * De dónde sale la lista de impuestos de cada línea: para una **devolución**,
   * los del ítem devuelto; para una línea de **ajuste**, los de su porción
   * (afecta o exenta), que puede ser más de uno si distintos ítems afectos
   * llevaban impuestos distintos. El importe de la línea se reparte entre ellos
   * con `repartirProporcional`, en la proporción que tenían en el original, para
   * que la suma dé exacto.
   *
   * ⚠️ Con **dos impuestos** repartidos entre líneas que no los comparten, el
   * `porcentaje_aplicado` de la fila describe **la regla** y no reproduce su
   * propio `valor_aplicado`. Es el precio de derivar de hechos congelados en vez
   * de recalcular: con un solo impuesto —el caso normal— coinciden.
   */
  private async escribirImpuestosNotaCredito(
    manager: EntityManager,
    ventaOriginalId: string,
    notaCreditoId: string,
    lineas: {
      detalleId: string;
      itemDevuelto: string | null;
      clasificacion: string;
      impuesto: Decimal;
    }[],
    cfg: ConfigCalculo,
    q: Cuantizador,
  ): Promise<void> {
    const conImpuesto = lineas.filter((l) => l.impuesto.gt(0));
    if (!conImpuesto.length) return;

    const filas: {
      item_id: string;
      clasificacion: string;
      impuesto_id: string;
      nombre_regla: string;
      porcentaje_aplicado: string | null;
      valor: string;
    }[] = await manager.query(
      `SELECT d.item_id,
              d.clasificacion_tributaria AS clasificacion,
              vi.impuesto_id, vi.nombre_regla, vi.porcentaje_aplicado,
              COALESCE(SUM(vi.valor_aplicado), 0)::text AS valor
         FROM ventas_impuestos vi
         JOIN venta_detalles d ON d.detalle_id = vi.detalle_id
              AND d.eliminado_el IS NULL
        WHERE vi.venta_id = $1 AND vi.eliminado_el IS NULL
          AND vi.aplicado_en = 'detalle'
        GROUP BY 1, 2, 3, 4, 5
        ORDER BY 3, 4, 5`,
      [ventaOriginalId],
    );
    if (!filas.length) return;

    const nuevas: VentaImpuesto[] = [];
    for (const linea of conImpuesto) {
      // Las reglas candidatas, agregadas por impuesto: un mismo impuesto puede
      // venir de varias filas del original (dos ítems afectos, dos líneas).
      const candidatas = new Map<
        string,
        { nombreRegla: string; porcentaje: string | null; peso: Decimal }
      >();
      for (const f of filas) {
        const aplica =
          linea.itemDevuelto !== null
            ? f.item_id === linea.itemDevuelto
            : f.clasificacion === linea.clasificacion;
        if (!aplica) continue;
        const previa = candidatas.get(f.impuesto_id);
        candidatas.set(f.impuesto_id, {
          // La PRIMERA del orden fijo de la consulta, no la última leída: un
          // mismo `impuesto_id` puede venir con distinto nombre o porcentaje
          // (dos ítems, una regla por tramos, un renombre entre líneas), y sin
          // esto el par que se persiste en un documento fiscal dependería del
          // orden que eligiera el planner.
          nombreRegla: previa ? previa.nombreRegla : f.nombre_regla,
          porcentaje: previa ? previa.porcentaje : f.porcentaje_aplicado,
          peso: (previa?.peso ?? new Decimal(0)).plus(f.valor),
        });
      }
      // Sin candidatas no hay regla que nombrar. No debería pasar —la línea
      // solo lleva impuesto si su porción lo llevaba en el original— y por eso
      // el importe NO se inventa una fila: queda en `total_impuestos` de la
      // cabecera, que es lo que cierra contra las líneas.
      if (!candidatas.size) continue;

      const entradas = [...candidatas.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      const montos = repartirProporcional(
        linea.impuesto,
        entradas.map(([, v]) => v.peso),
        cfg,
        q,
      );
      entradas.forEach(([impuestoId, v], i) => {
        if (montos[i].isZero()) return;
        nuevas.push(
          manager.create(VentaImpuesto, {
            ventaId: notaCreditoId,
            detalleId: linea.detalleId,
            impuestoId,
            nombreRegla: v.nombreRegla,
            valorAplicado: montos[i].toFixed(4),
            porcentajeAplicado: v.porcentaje,
            aplicadoEn: 'detalle',
          }),
        );
      });
    }
    if (nuevas.length) await manager.save(VentaImpuesto, nuevas);
  }

  async findTiposDocumento(tenantId: string): Promise<TipoDocumentoResponse[]> {
    const rows: {
      tipo_documento_id: string;
      nombre: string;
      codigo: string | null;
      customer_requerido: boolean;
      es_boleta: boolean;
      codigo_iso: string;
      umbral_identidad: string | null;
    }[] = await this.db.query(
      `SELECT td.tipo_documento_id,
              td.nombre,
              td.codigo,
              td.customer_requerido,
              td.es_boleta,
              p.codigo_iso,
              ${UMBRAL_IDENTIDAD_SQL} AS umbral_identidad
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
      esBoleta: r.es_boleta === true,
      receptorCompleto:
        r.customer_requerido === true && r.codigo_iso === CODIGO_ISO_CHILE,
      rutChileno: r.codigo_iso === CODIGO_ISO_CHILE,
      umbralIdentidad: r.es_boleta ? (r.umbral_identidad ?? null) : null,
    }));
  }

  /**
   * La tienda online y la suscripción **cobran antes de crear la venta**
   * (callback de Webpay, `cobrosService.cobrar`), y ninguna de las dos pide RUT:
   * una compra sobre el umbral de la Res. Ex. SII 44/2025 se rechaza acá,
   * antes del cobro. El 400 de `crearEnTransaccion` en ese camino dejaría plata
   * cobrada sin venta, que es lo que el owner quiso evitar.
   *
   * Así el callback solo ve compras bajo el umbral, y la barrera de
   * `crearEnTransaccion` solo podría rechazar ahí si el umbral **baja** entre
   * este chequeo y el callback: un cambio de año con una fila nueva menor, y la
   * UF casi nunca baja de un año a otro. Si pasa, cae en "orden pagada sin
   * venta", que es reconciliable.
   *
   * Siempre la boleta: online no puede traer otro tipo (`resolverTipoDocumento`).
   */
  async exigirCompraOnlineBajoUmbral(
    tenantId: string,
    totalFinal: string,
  ): Promise<void> {
    const rows: { umbral_identidad: string | null }[] = await this.db.query(
      `SELECT ${UMBRAL_IDENTIDAD_SQL} AS umbral_identidad
         FROM tenants t
         JOIN provincia prov ON prov.provincia_id = t.provincia_id
              AND prov.eliminado_el IS NULL
         JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
         JOIN tipos_documento_tributario td ON td.pais_id = p.pais_id
              AND td.es_boleta = true AND td.activo = true
              AND td.eliminado_el IS NULL
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId],
    );
    const umbral = rows[0]?.umbral_identidad ?? null;
    if (umbral !== null && new Decimal(totalFinal).gt(umbral)) {
      throw new BadRequestException(
        `Una compra de más de ${montoUmbral(umbral)} lleva el nombre y el RUT ` +
          'de quien paga (Res. Ex. SII 44/2025), y la compra online todavía ' +
          'no los pide: hacela en el local',
      );
    }
  }

  /**
   * El filtro de "lo mío" para ventas. Se deriva por la caja porque **`ventas` no
   * guarda quién la hizo**: tiene `caja_id`, `canal` y `cancelada_por_usuario_id`,
   * pero ningún `creado_por`. Para una venta física la derivación es exacta —una
   * caja abierta pertenece a un solo usuario, así que la caja *es* el registro de
   * autoría—.
   *
   * **La venta online entra siempre**, sea de quien sea: `crear` la resuelve
   * contra la caja VIRTUAL del tenant (`findVirtual`), nunca contra una física,
   * así que no puede revelar el esperado de ningún cajón que alguien vaya a
   * arquear —que es lo único que este eje protege— y ocultársela al cajero
   * rompería una pantalla legítima a cambio de nada.
   *
   * ⚠️ **Eso vale MIENTRAS online exija pago completo.** Que sus pagos no puedan
   * caer en una caja física no es una propiedad del canal: descansa en dos
   * guardas que viven lejos de acá —`crear` rechaza una venta online sin pago
   * total, y `registrarAbono` opera **siempre** sobre la caja física del que
   * cobra—. El día que se habilite pago contra entrega o abono parcial online,
   * los pagos de una venta online caen en el cajón de un cajero y **esta
   * excepción los expone a cualquier otro cajero** vía el detalle de la venta.
   * Si eso se habilita, hay que filtrar por alcance **dos** lugares, no uno: la
   * lista de pagos de `findOne` (acá) y el listado de `GET /pagos`, que devuelve
   * `p.caja_id` sin redactar para los pagos que entran por su misma rama
   * `online` — hoy inocuo porque viven en la caja virtual, cuyo `usuario_id` es
   * NULL.
   *
   * ⚠️ Una venta **sin caja** no es de nadie y no entra: `caja_id` es nullable y
   * hoy ningún camino lo deja vacío, pero si mañana aparece uno, el `EXISTS` con
   * NULL da falso, que es lo que corresponde.
   */
  private filtroDeMisCajas(idxUsuario: number): string {
    return ` AND (
             v.canal = 'online'
             OR EXISTS (
               SELECT 1 FROM cajas c
                WHERE c.caja_id = v.caja_id
                  AND c.tenant_id = v.tenant_id
                  AND c.usuario_id = $${idxUsuario}
                  AND c.eliminado_el IS NULL
             )
           )`;
  }

  async resumen(
    tenantId: string,
    usuarioId: string,
    verTodas: boolean,
  ): Promise<VentasResumen> {
    const params: unknown[] = [tenantId];

    let filtroPropio = '';
    if (!verTodas) {
      params.push(usuarioId);
      filtroPropio = this.filtroDeMisCajas(params.length);
    }

    // Las correcciones (notas de crédito) son filas con `venta_referencia_id`:
    // heredan la caja de la venta que corrigen y por eso `filtroPropio` las
    // acota igual que a las ventas (spec 2026-10-01-vendido-neto § 3.3). Las
    // canceladas salen de los cuatro números (D9).
    const rows: {
      total_ventas: number;
      total_bruto: string;
      total_notas_credito: string;
      total_facturado: string;
      saldo_pendiente: string;
    }[] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE v.venta_referencia_id IS NULL)::int AS total_ventas,
              COALESCE(SUM(v.total_final)
                FILTER (WHERE v.venta_referencia_id IS NULL), 0)::text AS total_bruto,
              COALESCE(SUM(v.total_final)
                FILTER (WHERE v.venta_referencia_id IS NOT NULL), 0)::text AS total_notas_credito,
              COALESCE(SUM(CASE WHEN v.venta_referencia_id IS NULL THEN v.total_final
                                ELSE -v.total_final END), 0)::text AS total_facturado,
              -- La expresión ÚNICA del saldo (\`saldo-venta.ts\`): total − lo aplicado −
              -- lo rebajado "sin plata", con piso 0. La misma que el saldo del
              -- listado y del detalle, el tope del abono y "Por cobrar" del inicio.
              COALESCE(SUM(
                ${saldoDeVentaSql('v')}
              ) FILTER (WHERE v.venta_referencia_id IS NULL), 0)::text AS saldo_pendiente
         FROM ventas v
        WHERE v.tenant_id = $1 AND v.eliminado_el IS NULL
          AND v.estado <> 'cancelada'
          ${filtroPropio}`,
      params,
    );

    const row = rows[0];
    return {
      totalVentas: row?.total_ventas ?? 0,
      totalFacturado: row?.total_facturado ?? '0',
      totalBruto: row?.total_bruto ?? '0',
      totalNotasCredito: row?.total_notas_credito ?? '0',
      saldoPendiente: row?.saldo_pendiente ?? '0',
    };
  }

  async listar(
    tenantId: string,
    query: QueryVentasDto,
    usuarioId: string,
    verTodas: boolean,
  ): Promise<PaginatedResponse<VentaListItem>> {
    const { page, pageSize, offset } = resolvePagination(query);
    const { filters, params } = this.buildListarFilters(
      tenantId,
      query,
      usuarioId,
      verTodas,
    );

    const countRows: { total: number }[] = await this.db.query(
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
      saldo: string;
      total_reembolsado: string;
      tipo_documento_id: string | null;
      venta_referencia_id: string | null;
      documentos_resumen: DocumentosResumenRow;
    }[] = await this.db.query(
      `SELECT v.venta_id, v.canal, v.estado, v.total_final, v.fecha, v.creado_el,
              v.tipo_documento_id, v.venta_referencia_id,
              (
                SELECT jsonb_build_object(
                         'emisores',
                         COALESCE(
                           jsonb_agg(DISTINCT d.emisor) FILTER (WHERE NOT d.es_duplicado),
                           '[]'::jsonb),
                         'tieneDuplicado', COALESCE(bool_or(d.es_duplicado), false))
                FROM venta_documentos d
                WHERE ${DOCUMENTO_VIGENTE}
              ) AS documentos_resumen,
              -- Lo aplicado a la venta: el mismo término que resta la expresión del saldo.
              ${aplicadoDeVentaSql('v')} AS monto_pagado,
              -- La expresión ÚNICA del saldo (\`saldo-venta.ts\`), no \`total − pagado\`.
              ${saldoDeVentaSql('v')}::text AS saldo,
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
    usuarioId: string,
    verTodas: boolean,
  ): { filters: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    let paramIdx = 2;
    let filters = '';

    // El eje va primero y fuera de todo `if` de query: es el alcance, no un
    // filtro que el cliente elige.
    if (!verTodas) {
      params.push(usuarioId);
      filters += this.filtroDeMisCajas(paramIdx++);
    }

    if (query.estado) {
      filters += ` AND v.estado = $${paramIdx++}`;
      params.push(query.estado);
    }
    if (query.canal) {
      filters += ` AND v.canal = $${paramIdx++}`;
      params.push(query.canal);
    }
    if (query.documento) {
      // Una corrección lleva sus propios documentos (E7) y no es una venta que
      // revisar: queda fuera de todos los valores **salvo "Sin número"**
      // (owner, 2026-10-02). La NC de la máquina o de afuera nace sin número y
      // el contador la tiene que anotar: ahí entra como fila propia, para que
      // revise todo lo que le falta en un solo lugar. La excepción es solo de
      // ese valor: con cualquier otro, una corrección no es una venta que
      // revisar. Una venta cancelada tampoco entra en ninguno: no hay nada
      // pendiente que documentar. Esto último es una DEFENSA, hoy
      // inalcanzable: una fila `nadie` nace de un pago con un medio `nadie` (y
      // anular exige que la venta no tenga pagos) o de una entrega gratuita, que
      // nace pagada y anular exige `pendiente`; los documentos del sistema y
      // del facturador de afuera ya se descartan al anular. La condición viene
      // de una tabla cerrada, no del texto del cliente: no lleva parámetro.
      if (query.documento !== 'sin_numero')
        filters += ` AND v.venta_referencia_id IS NULL`;
      filters += ` AND v.estado <> 'cancelada'
        AND EXISTS (
          SELECT 1 FROM venta_documentos d
          WHERE ${DOCUMENTO_VIGENTE} AND ${CONDICION_DOCUMENTO[query.documento]}
        )`;
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
    saldo: string;
    total_reembolsado: string;
    tipo_documento_id: string | null;
    venta_referencia_id: string | null;
    documentos_resumen: DocumentosResumenRow;
  }): VentaListItem {
    return {
      id: r.venta_id,
      canal: r.canal,
      estado: r.estado,
      totalFinal: r.total_final,
      fecha: r.fecha,
      creadoEl: r.creado_el,
      montoPagado: new Decimal(r.monto_pagado).toFixed(4),
      saldo: new Decimal(r.saldo).toFixed(4),
      totalReembolsado: new Decimal(r.total_reembolsado).toFixed(4),
      ...flagsDeCorreccion(r),
      emisores: r.documentos_resumen.emisores,
      tieneDuplicado: r.documentos_resumen.tieneDuplicado,
    };
  }

  async findOne(
    tenantId: string,
    ventaId: string,
    usuarioId: string,
    verTodas: boolean,
  ) {
    const paramsDetalle: unknown[] = [ventaId, tenantId];
    let filtroPropio = '';
    if (!verTodas) {
      paramsDetalle.push(usuarioId);
      filtroPropio = this.filtroDeMisCajas(paramsDetalle.length);
    }

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
      base_ventas_total_final: string;
      base_ventas_sin_impuestos: string;
      config_calculo: ConfigCalculo | null;
      comentario: string | null;
      fecha: Date;
      creado_el: Date;
      venta_referencia_id: string | null;
      tipo_documento_codigo: string | null;
      tipo_documento_nombre: string | null;
      tipo_documento_es_boleta: boolean | null;
      tipo_documento_pais: string | null;
      tiene_lineas_despachadas: boolean;
      receptor_es_emisor: boolean;
      receptor_sugerido: { nombre: string; rut: string | null } | null;
    }[] = await this.db.query(
      `SELECT v.venta_id, v.caja_id, v.moneda_id, v.tipo_documento_id, v.canal, v.estado,
              v.total_bruto, v.total_descuentos, v.total_recargos, v.total_impuestos, v.total_final,
              v.base_ventas_total_final, v.base_ventas_sin_impuestos,
              v.config_calculo,
              v.comentario, v.fecha, v.creado_el, v.venta_referencia_id,
              td.codigo AS tipo_documento_codigo, td.nombre AS tipo_documento_nombre,
              td.es_boleta AS tipo_documento_es_boleta,
              tdp.codigo_iso AS tipo_documento_pais,
              v.receptor_es_emisor,
              -- El receptor de la última nota de esta venta que lo tiene: la
              -- pantalla lo precarga en la nota siguiente cuando la venta no tiene
              -- customer (owner, 2026-10-04). Una subconsulta y no otra ida a la base.
              (SELECT json_build_object('nombre', vc.nombre, 'rut', vc.rut)
                 FROM ventas nc
                 JOIN venta_customer vc ON vc.venta_id = nc.venta_id
                      AND vc.eliminado_el IS NULL
                WHERE nc.venta_referencia_id = v.venta_id
                  AND nc.tenant_id = v.tenant_id
                  AND nc.eliminado_el IS NULL
                ORDER BY nc.creado_el DESC, nc.venta_id DESC
                LIMIT 1) AS receptor_sugerido,
              EXISTS (
                SELECT 1 FROM cuentas cta
                  JOIN cuenta_lineas cl ON cl.cuenta_id = cta.cuenta_id
                       AND cl.tenant_id = cta.tenant_id
                       AND cl.eliminado_el IS NULL
                       AND cl.cantidad_enviada > 0
                 WHERE cta.venta_id = v.venta_id
                   AND cta.tenant_id = v.tenant_id
                   AND cta.eliminado_el IS NULL
              ) AS tiene_lineas_despachadas
       FROM ventas v
       LEFT JOIN tipos_documento_tributario td
            ON td.tipo_documento_id = v.tipo_documento_id AND td.eliminado_el IS NULL
       LEFT JOIN pais tdp ON tdp.pais_id = td.pais_id AND tdp.eliminado_el IS NULL
       WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL
         ${filtroPropio}`,
      paramsDetalle,
    );

    // 404 y no 403 cuando la venta existe pero no es suya: un 403 confirmaría
    // que existe. El detalle trae `caja_id`, `monto` y `vuelto` por pago, que es
    // por donde se reconstruía el esperado de una caja ajena.
    if (!rows.length) throw new NotFoundException('Venta no encontrada');
    const v = rows[0];

    type Row = Record<string, unknown>;
    const detalles: Row[] = await this.db.query(
      `SELECT d.detalle_id, d.item_id, d.descripcion, d.cantidad, d.precio_unitario,
              d.precio_unitario_origen, d.tasa_cambio, d.moneda_id_origen,
              d.subtotal, d.descuento_aplicado, d.recargo_aplicado, d.ajuste_venta,
              d.impuesto_aplicado, d.total_linea, d.cantidad_presentacion, d.unidad_codigo_presentacion,
              d.unidad_codigo_base, d.clasificacion_tributaria,
              ip.modo_inventario
       FROM venta_detalles d
       LEFT JOIN item_producto ip ON ip.item_id = d.item_id
       WHERE d.venta_id = $1 AND d.eliminado_el IS NULL
       -- El desempate no es cosmético: las líneas se guardan en UN solo save,
       -- así que comparten creado_el al microsegundo y el orden lo elegía el
       -- planner. Con una nota de crédito de dos líneas de ajuste eso se ve:
       -- la misma nota se renderizaba afecto/exento o exento/afecto según la
       -- recarga. Medido en el navegador, no supuesto.
       ORDER BY d.creado_el ASC, d.detalle_id ASC`,
      [ventaId],
    );
    // La serie y la condición de lo que SALIÓ en esta venta, para que el detalle
    // diga qué unidad se llevó el cliente. UNA consulta por venta, agrupada por
    // ítem en memoria: una por línea sería un N+1. Se lee del kardex (la salida
    // de la venta, `motivo = 'venta'`, como las otras lecturas del kardex de
    // la venta: una salida de otro motivo no es lo que se llevó el cliente). El detalle
    // del movimiento no tiene `eliminado_el`; el movimiento y la unidad sí, y
    // se filtran. Ordenadas por serie para que la lista sea estable.
    const unidadesVendidas: {
      item_id: string;
      serie: string;
      condicion: string;
    }[] = await this.db.query(
      `SELECT m.item_id, u.serie, u.condicion
         FROM movimientos_inventario m
         JOIN movimiento_inventario_detalle d ON d.movimiento_id = m.movimiento_id
         JOIN item_unidad u ON u.unidad_id = d.unidad_id
          AND u.tenant_id = m.tenant_id AND u.eliminado_el IS NULL
        WHERE m.venta_id = $1 AND m.tenant_id = $2
          AND m.tipo = 'salida' AND m.motivo = 'venta'
          AND m.eliminado_el IS NULL
        ORDER BY u.serie ASC`,
      [ventaId, tenantId],
    );
    const unidadesPorItem = new Map<
      string,
      { serie: string; condicion: string }[]
    >();
    for (const u of unidadesVendidas) {
      const lista = unidadesPorItem.get(u.item_id) ?? [];
      lista.push({ serie: u.serie, condicion: u.condicion });
      unidadesPorItem.set(u.item_id, lista);
    }
    // Ya comprometido por ítem: el mismo contador que aplica el tope al emitir
    // la nota. Compartirlo no es DRY por gusto — que la pantalla ofrezca una
    // unidad que el backend después rechaza es el modo de falla que este
    // número existe para evitar.
    const devueltoPorItem = await this.unidadesComprometidasPorItem(ventaId);
    // Reembolsos de la(s) orden(es) de pasarela vinculadas a esta venta.
    const reembolsos: Row[] = await this.db.query(
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
    const notasCredito: Row[] = await this.db.query(
      `SELECT venta_id, total_final, fecha, comentario
       FROM ventas
       WHERE venta_referencia_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       ORDER BY creado_el ASC`,
      [ventaId, tenantId],
    );
    // El remanente acreditable por porción fiscal. Mismo criterio que la
    // composición que usa `crearNotaCreditoEnTransaccion`, y por eso el modal
    // muestra exactamente el número que el backend después va a exigir: sin
    // esto el operador descubre el tope apretando Confirmar.
    //
    // **Lo calcula el backend a propósito.** Replicar acá lo que el navegador
    // necesitaría —valuar cada línea y cuantizarla con el `modo_redondeo`
    // congelado de la venta— ya se intentó el 2026-09-04 y bloqueaba notas que
    // el backend acepta.
    //
    // Filtra por `venta_referencia_id` sin mirar el tipo de documento porque
    // **esa columna la escribe un solo lugar**: la creación de la nota de
    // crédito. Es el mismo criterio de la consulta de `notasCredito` de arriba.
    const disponiblePorPorcion: { clasificacion: string; monto: string }[] =
      await this.db.query(
        `SELECT d.clasificacion_tributaria AS clasificacion,
                COALESCE(SUM(
                  CASE WHEN d.venta_id = $1 THEN d.total_linea ELSE -d.total_linea END
                ), 0)::text AS monto
           FROM venta_detalles d
          WHERE d.eliminado_el IS NULL
            -- Una sola lista y no \`= $1 OR IN (...)\`: ver el gemelo de
            -- \`unidadesComprometidasPorItem\`. Con el \`OR\` esta consulta hacía
            -- Parallel Seq Scan de \`venta_detalles\` **con el índice puesto**.
            AND d.venta_id IN (
              SELECT venta_id FROM ventas
               WHERE venta_referencia_id = $1
                 AND tenant_id = $2
                 AND eliminado_el IS NULL
              UNION ALL
              SELECT $1::uuid
            )
          GROUP BY 1
          ORDER BY 1`,
        [ventaId, tenantId],
      );
    // Las tres traen lo congelado (`nombre_regla`, `modo`, `valor_solicitado`)
    // además del monto: el catálogo vivo pudo cambiar o desaparecer desde que
    // se cobró, así que la fila tiene que bastarse sola.
    const descuentos: Row[] = await this.db.query(
      `SELECT venta_descuento_id, descuento_id, detalle_id, nombre_regla, modo,
              valor_aplicado, valor_solicitado, porcentaje_aplicado, aplicado_en
       FROM ventas_descuentos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const recargos: Row[] = await this.db.query(
      `SELECT venta_recargo_id, recargo_id, detalle_id, nombre_regla, modo,
              valor_aplicado, porcentaje_aplicado, aplicado_en
       FROM ventas_recargos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const impuestos: Row[] = await this.db.query(
      `SELECT venta_impuesto_id, impuesto_id, detalle_id, nombre_regla,
              valor_aplicado, porcentaje_aplicado, aplicado_en
       FROM ventas_impuestos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    // Congelado igual que las tres de arriba: nombre, tipo y valorEfectivo
    // sobreviven aunque la promo del catálogo cambie o se borre.
    const promociones: Row[] = await this.db.query(
      `SELECT venta_promocion_id, detalle_id, aplicacion, promocion_id,
              nombre_promocion, tipo, valor_efectivo, monto
       FROM ventas_promociones WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const customerRows: Row[] = await this.db.query(
      `SELECT customer_id, tercero_id, nombre, rut, direccion, giro, comuna,
              telefono, email
       FROM venta_customer WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    // `caja_id` se REDACTA cuando el pago no cayó en una caja del que consulta.
    // El caso: el cajero A deja una venta como cuenta por cobrar, B la abona con
    // SU caja abierta (`registrarAbono` deja cobrar la deuda de otra caja a quien
    // tiene `Cajas:Leer`, PRODUCTO § 10), y A abre el detalle de su PROPIA
    // venta —así que el filtro de alcance de la cabecera no corta— y se lleva el
    // triplete `caja_id` + `monto` + `vuelto` de la caja de B. Es exactamente el
    // dato que este eje existe para proteger.
    //
    // Se redacta el `caja_id` en vez de esconder la fila: el monto y el medio son
    // de SU venta y los necesita para entender que está pagada; lo que no es suyo
    // es a qué cajón fue a parar. Sin `caja_id` el pago no se puede atribuir a la
    // caja de nadie.
    const pagos: Row[] = await this.db.query(
      `SELECT pago_id, metodo_pago_id, moneda_oficial_id, monto, vuelto, fecha, referencia,
              CASE WHEN $2::boolean OR EXISTS (
                     SELECT 1 FROM cajas c
                      WHERE c.caja_id = pagos.caja_id
                        AND c.tenant_id = pagos.tenant_id
                        AND c.usuario_id = $3
                        AND c.eliminado_el IS NULL
                   )
                   THEN caja_id
              END AS caja_id
       -- \`pago_id\` desempata: \`PagosService.registrar\` guarda un \`Pago\` por
       -- método en un loop dentro de una sola transacción, y los que nacen
       -- juntos empatan en \`creado_el\` al microsegundo. Solo estabiliza el
       -- orden entre cargas — no reproduce el orden en que el cajero tipeó
       -- los medios, que no se guarda en ningún lado.
       FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL
       ORDER BY creado_el ASC, pago_id ASC`,
      [ventaId, verTodas, usuarioId],
    );

    const pagoIds = pagos.map((p) => p['pago_id'] as string);
    const aplicacionesRows: {
      pago_aplicacion_id: string;
      pago_id: string;
      tipo: string;
      referencia_id: string | null;
      monto: string;
    }[] =
      pagoIds.length > 0
        ? await this.db.query(
            `SELECT pago_aplicacion_id, pago_id, tipo, referencia_id, monto
             FROM pago_aplicaciones
             WHERE pago_id = ANY($1::uuid[]) AND eliminado_el IS NULL
             -- El reparto venta/propina de PagosService.registrar (aplicaciones)
             -- deja dos filas del mismo pago con el mismo \`creado_el\`. \`tipo DESC\`
             -- pone 'venta' antes que 'propina' (v > p alfabético) y
             -- \`pago_aplicacion_id\` desempata lo que quede. Es alfabético, no una
             -- prioridad: un tercer valor de \`TipoPagoAplicacion\` cae donde lo ponga
             -- su letra, y ahí esto pasa a un CASE.
             ORDER BY creado_el ASC, tipo DESC, pago_aplicacion_id ASC`,
            [pagoIds],
          )
        : [];
    const aplicacionesPorPago = new Map<string, typeof aplicacionesRows>();
    for (const a of aplicacionesRows) {
      const list = aplicacionesPorPago.get(a.pago_id) ?? [];
      list.push(a);
      aplicacionesPorPago.set(a.pago_id, list);
    }

    // Los documentos de la venta y de sus correcciones, y lo que el backend
    // decide sobre ellos. **La pantalla solo muestra estas banderas**: la regla
    // vive acá y en `VentaDocumentosService`, y replicarla en el cliente fue lo
    // que este frente vino a cerrar.
    const documentos = await this.ventaDocumentosService.listarParaDetalle(
      this.db,
      { tenantId, ventaId },
    );

    // `anulable`: la misma regla que `cancelarUnaVez` —el estado, los pagos y las
    // correcciones (`motivoQueImpideAnular`) y después lo emitido (`evaluarAnulacion`)—,
    // sin `externoHecho`: pedir la respuesta es parte del flujo, no un bloqueo.
    const motivoNoAnula = await this.motivoQueImpideAnular(this.db, {
      ventaId,
      estado: v.estado,
      // Ya cargados arriba: sin repetir las consultas.
      tienePagos: pagos.length > 0,
      tieneCorrecciones: notasCredito.length > 0,
    });
    const veredictoAnular =
      motivoNoAnula === null
        ? await this.ventaDocumentosService.evaluarAnulacion(this.db, {
            tenantId,
            ventaId,
          })
        : null;
    const anulable =
      veredictoAnular !== null && veredictoAnular.resultado !== 'bloqueada';
    const anularPreguntaExterno =
      veredictoAnular?.resultado === 'pregunta_externo';

    // El saldo y si se puede abonar los decide el BACKEND con la expresión ÚNICA del
    // saldo (`saldo-venta.ts`): la pantalla no resta nada ni replica el estado.
    const saldoRows: { saldo: string }[] = await this.db.query(
      `SELECT ${saldoDeVentaSql('v')}::text AS saldo
         FROM ventas v
        WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL`,
      [ventaId, tenantId],
    );
    const saldo = new Decimal(saldoRows[0]?.saldo ?? '0').toFixed(4);
    const admiteAbono = puedeAbonar(v.estado, saldo);

    // `abonoConMaquinaDuplica`: ¿un abono pagado con la máquina duplicaría un
    // documento? Hace falta algo que abonar (`puedeAbonar`: el mismo corte de
    // `PagosService.registrarAbono`) y que la deuda ya esté documentada, con el
    // predicado que usa `registrarDuplicadoDeAbono`.
    const abonoConMaquinaDuplica =
      admiteAbono &&
      (await this.ventaDocumentosService.ventaDocumentada(this.db, {
        tenantId,
        ventaId,
      }));

    const propinaRows: {
      venta_propina_id: string;
      porcentaje_sugerido: string;
      monto_sugerido: string;
      monto_pagado: string;
      tipo: string;
      estado: string;
      garzon_id: string;
      garzon_nombre: string | null;
      sesion_garzon_id: string | null;
      turno_id: string | null;
      tipo_garzon: string | null;
      liquidacion_id: string | null;
    }[] = await this.db.query(
      `SELECT vp.venta_propina_id, vp.porcentaje_sugerido, vp.monto_sugerido, vp.monto_pagado,
              vp.tipo, vp.estado, vp.garzon_id, g.nombre AS garzon_nombre,
              vp.sesion_garzon_id, vp.turno_id, vp.tipo_garzon, vp.liquidacion_id
       FROM venta_propina vp
       LEFT JOIN garzones g ON g.garzon_id = vp.garzon_id
                            AND g.tenant_id = vp.tenant_id
                            AND g.eliminado_el IS NULL
       WHERE vp.venta_id = $1 AND vp.tenant_id = $2 AND vp.eliminado_el IS NULL`,
      [ventaId, tenantId],
    );
    const propinaRow = propinaRows[0] ?? null;

    const customerRow = customerRows[0];
    const tipoNotaCredito = await this.tipoNotaCreditoDelTenant(tenantId);

    /**
     * Gemelo de los cortes de elegibilidad de `crearNotaCreditoEnTransaccion`:
     * no se emite sobre otra corrección (`venta_referencia_id`, no el tipo de
     * documento: la devolución interna no lo lleva), la venta está pagada,
     * pagada parcialmente o pendiente (esta última solo con "No vuelve plata":
     * `opcionesDevolucion` no tiene pagos que ofrecerle), y tiene
     * `config_calculo` congelada.
     *
     * Existe porque `disponibleNotaCredito` es una PROMESA: publicar un monto
     * acreditable sobre un documento que el POST rechaza de plano —medido: el
     * 37 % de los documentos de la base de desarrollo, incluida la nota de
     * crédito que se acreditaba a sí misma— es el modo de falla que ese campo
     * vino a cerrar, invertido.
     *
     * ⚠️ Es un gemelo, con todo lo que eso implica: si allá se agrega un
     * guard, acá hay que agregarlo. No se comparte porque aquéllos lanzan (y el
     * mensaje es parte del contrato de la emisión) y éste solamente decide si
     * hay número que mostrar.
     */
    const elegibleBase =
      v.venta_referencia_id === null &&
      ['pagada', 'pagada_parcial', 'pendiente'].includes(v.estado) &&
      // Literal al de la emisión (`!original.config_calculo`), no
      // `!== null`: con jsonb no difieren, pero un gemelo que no es literal
      // invita a que alguien "lo alinee" y mueva la conducta sin querer.
      !!v.config_calculo;

    // "¿Por dónde vuelve la plata?": las opciones salen de la MISMA resolución
    // que usa la nota al crearse (`documentoQueCorrige`), así que la pantalla
    // ofrece exactamente lo que el servidor acepta y no replica la regla. Sin
    // el tipo NC del país solo quedan las que no lo llevan (la devolución
    // interna): es el gemelo de `exigirTipoNotaCredito`, que la devolución
    // interna no necesita.
    const opcionesDevolucion = elegibleBase
      ? (
          await this.ventaDocumentosService.opcionesDevolucion(this.db, {
            tenantId,
            ventaId,
          })
        ).filter(
          (o) =>
            o.registro === 'devolucion_interna' || tipoNotaCredito !== null,
        )
      : [];
    // Sin ninguna forma de corregir no hay nada que acreditar.
    const elegibleParaNotaCredito =
      elegibleBase && opcionesDevolucion.length > 0;

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
            // Del catálogo (`es_boleta`), no del nombre: la pantalla de anular
            // dice "esta factura" o "este documento" según esto. Nulo si el tipo
            // se borró del catálogo (el JOIN no lo trae): ahí no es boleta.
            esBoleta: v.tipo_documento_es_boleta === true,
            // El RUT que se capture para una nota de crédito se valida con DV
            // módulo 11: el país del tipo es el del tenant (`receptorDeLaVenta`).
            rutChileno: v.tipo_documento_pais === CODIGO_ISO_CHILE,
          }
        : null,
      // Mismo criterio que `listar()` (`flagsDeCorreccion`): una corrección es
      // lo que tiene `venta_referencia_id` (E7), no lo que lleva el tipo NC —la
      // devolución interna no lo lleva—. El frontend lo reconstruía comparando
      // `codigo === '61'`, que es nullable y varía por país.
      ...flagsDeCorreccion(v),
      ventaReferenciaId: v.venta_referencia_id,
      opcionesDevolucion,
      documentos,
      anulable,
      anularPreguntaExterno,
      abonoConMaquinaDuplica,
      saldo,
      puedeAbonar: admiteAbono,
      // La venta vino de una cuenta de salón con al menos una línea YA ENVIADA a
      // cocina. Lo consume el modal de anulación: reponer comida que ya se cocinó
      // mete al stock ingredientes que físicamente no existen, así que ahí el
      // checkbox "Reponer el stock" nace DESTILDADO (owner, 2026-08-15). Es uno
      // solo para toda la venta y basta con que ALGUNA línea se haya despachado
      // (owner, 2026-08-23): el cajero lo tilda si igual quiere reponer.
      // `false` en la venta de POS, que no viene de ninguna cuenta.
      tieneLineasDespachadas: v.tiene_lineas_despachadas === true,
      canal: v.canal,
      estado: v.estado,
      totalBruto: v.total_bruto,
      totalDescuentos: v.total_descuentos,
      totalRecargos: v.total_recargos,
      totalImpuestos: v.total_impuestos,
      totalFinal: v.total_final,
      baseVentasTotalFinal: v.base_ventas_total_final,
      baseVentasSinImpuestos: v.base_ventas_sin_impuestos,
      /**
       * Cuánto se puede acreditar todavía por nota de crédito, en total y por
       * porción fiscal.
       *
       * `porPorcion` es una LISTA y no dos campos fijos: hoy las
       * clasificaciones son `afecto` y `exento`, pero el resto del modelo ya
       * las trata como dato (`clasificacion_tributaria` es `text`, no un enum)
       * y ADR-010 anticipa países con más baldes.
       *
       * ⚠️ `total` sale de `total_final` menos las notas previas, **no** de la
       * suma de las porciones. Hoy dan el mismo número —las líneas de toda nota
       * suman su total— pero no está garantizado: el piso en cero de cada
       * porción puede dejar la suma un minor unit arriba. El que el backend
       * exige es `total`, y la pantalla tiene que mostrar el que se va a
       * aplicar.
       *
       * ⚠️ Es el tope del DOCUMENTO. Si la plata vuelve por un pago en efectivo
       * (`devolucion.pagoId` de un método `es_efectivo`) hay además un tope
       * del EFECTIVO —lo que esa venta cobró en efectivo menos lo ya devuelto—
       * que **no se publica a propósito**: exponerlo era la fuga 5 del modo
       * ciego (ver el 422 de `crearNotaCreditoEnTransaccion`). Ese se sigue
       * descubriendo al confirmar, y es deliberado.
       *
       * En cero cuando el documento no admite nota de crédito: prometer un
       * monto que el POST rechaza de plano es el modo de falla que este campo
       * vino a cerrar, invertido.
       */
      disponibleNotaCredito: elegibleParaNotaCredito
        ? {
            total: Decimal.max(
              0,
              new Decimal(v.total_final).minus(
                notasCredito.reduce(
                  (a, n) => a.plus(n['total_final'] as string),
                  new Decimal(0),
                ),
              ),
            ).toFixed(4),
            porPorcion: disponiblePorPorcion.map((p) => ({
              clasificacion: p.clasificacion,
              monto: Decimal.max(0, new Decimal(p.monto)).toFixed(4),
            })),
          }
        : { total: '0.0000', porPorcion: [] },
      // Sin esto el desglose congelado no se puede ORDENAR como se aplicó: el
      // orden de los pasos es del tenant y editable. `null` en las ventas
      // anteriores al congelado; las notas de crédito congelan la suya propia,
      // heredada de la venta que corrigen.
      configCalculo: v.config_calculo,
      comentario: v.comentario,
      fecha: v.fecha,
      creadoEl: v.creado_el,
      propina: propinaRow
        ? {
            id: propinaRow.venta_propina_id,
            porcentajeSugerido: propinaRow.porcentaje_sugerido,
            montoSugerido: propinaRow.monto_sugerido,
            montoPagado: propinaRow.monto_pagado,
            tipo: propinaRow.tipo,
            estado: propinaRow.estado,
            garzonId: propinaRow.garzon_id,
            garzonNombre: propinaRow.garzon_nombre,
            sesionGarzonId: propinaRow.sesion_garzon_id,
            turnoId: propinaRow.turno_id,
            tipoGarzon: propinaRow.tipo_garzon,
            liquidacionId: propinaRow.liquidacion_id,
          }
        : null,
      detalles: detalles.map((d) => ({
        id: d['detalle_id'],
        itemId: d['item_id'],
        descripcion: d['descripcion'],
        cantidad: d['cantidad'],
        cantidadPresentacion: d['cantidad_presentacion'] ?? null,
        unidadCodigoPresentacion: d['unidad_codigo_presentacion'] ?? null,
        unidadCodigoBase: d['unidad_codigo_base'],
        precioUnitario: d['precio_unitario'],
        precioUnitarioOrigen: d['precio_unitario_origen'],
        tasaCambio: d['tasa_cambio'],
        monedaIdOrigen: d['moneda_id_origen'],
        subtotal: d['subtotal'],
        // El estado fiscal de la línea. Lo pide el detalle de una nota de
        // crédito, cuyas líneas de ajuste se separan justamente en una afecta y
        // una exenta: sin este campo, las dos se leen iguales en pantalla.
        clasificacionTributaria: d['clasificacion_tributaria'],
        descuentoAplicado: d['descuento_aplicado'],
        recargoAplicado: d['recargo_aplicado'],
        // Va sí o sí: sin él las partes que la pantalla muestra no suman el
        // total que muestra. La fila cierra en la base, pero el drawer y el
        // modal de reembolso leen de acá, no de la tabla.
        ajusteVenta: d['ajuste_venta'],
        impuestoAplicado: d['impuesto_aplicado'],
        totalLinea: d['total_linea'],
        // null = servicio (sin fila en item_producto); el modal de reembolso
        // solo habilita devolución para modo 'cantidad'.
        modoInventario: d['modo_inventario'] ?? null,
        // Vacío en lo que no tiene serie. Por ítem y no por línea: el kardex no
        // guarda a qué línea pertenece cada salida.
        unidades: unidadesPorItem.get(d['item_id'] as string) ?? [],
        cantidadDevuelta: (
          devueltoPorItem.get(d['item_id'] as string) ?? new Decimal(0)
        ).toString(),
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
        detalleId: d['detalle_id'],
        nombreRegla: d['nombre_regla'],
        modo: d['modo'],
        valorAplicado: d['valor_aplicado'],
        valorSolicitado: d['valor_solicitado'],
        porcentajeAplicado: d['porcentaje_aplicado'],
        aplicadoEn: d['aplicado_en'],
      })),
      recargos: recargos.map((r) => ({
        id: r['venta_recargo_id'],
        recargoId: r['recargo_id'],
        detalleId: r['detalle_id'],
        nombreRegla: r['nombre_regla'],
        modo: r['modo'],
        valorAplicado: r['valor_aplicado'],
        porcentajeAplicado: r['porcentaje_aplicado'],
        aplicadoEn: r['aplicado_en'],
      })),
      impuestos: impuestos.map((imp) => ({
        id: imp['venta_impuesto_id'],
        impuestoId: imp['impuesto_id'],
        detalleId: imp['detalle_id'],
        nombreRegla: imp['nombre_regla'],
        valorAplicado: imp['valor_aplicado'],
        porcentajeAplicado: imp['porcentaje_aplicado'],
        aplicadoEn: imp['aplicado_en'],
      })),
      promociones: promociones.map((p) => ({
        id: p['venta_promocion_id'],
        detalleId: p['detalle_id'],
        aplicacion: p['aplicacion'],
        promocionId: p['promocion_id'],
        nombre: p['nombre_promocion'],
        tipo: p['tipo'],
        valorEfectivo: p['valor_efectivo'],
        monto: p['monto'],
      })),
      customer: customerRow
        ? {
            id: customerRow['customer_id'],
            terceroId: customerRow['tercero_id'],
            nombre: customerRow['nombre'],
            rut: customerRow['rut'],
            direccion: customerRow['direccion'],
            giro: customerRow['giro'],
            comuna: customerRow['comuna'],
            telefono: customerRow['telefono'],
            email: customerRow['email'],
          }
        : null,
      // Una nota de crédito sin datos del comprador va a nombre del emisor.
      receptorEsEmisor: v.receptor_es_emisor === true,
      // Solo sin customer: con customer, la nota lleva el de la venta.
      receptorSugerido: customerRow ? null : (v.receptor_sugerido ?? null),
      pagos: pagos.map((p) => {
        const apps = aplicacionesPorPago.get(p['pago_id'] as string) ?? [];
        const montoAplicadoVenta = apps
          .filter((a) => a.tipo === 'venta')
          .reduce((acc, a) => acc.plus(a.monto), new Decimal(0))
          .toFixed(4);
        const montoAplicadoPropina = apps
          .filter((a) => a.tipo === 'propina')
          .reduce((acc, a) => acc.plus(a.monto), new Decimal(0))
          .toFixed(4);
        return {
          id: p['pago_id'],
          metodoPagoId: p['metodo_pago_id'],
          monedaOficialId: p['moneda_oficial_id'],
          cajaId: p['caja_id'],
          monto: p['monto'],
          vuelto: p['vuelto'],
          fecha: p['fecha'],
          referencia: p['referencia'],
          aplicaciones: apps.map((a) => ({
            tipo: a.tipo,
            monto: a.monto,
            referenciaId: a.referencia_id,
          })),
          montoAplicadoVenta,
          montoAplicadoPropina,
        };
      }),
    };
  }

  /**
   * La boleta de `GET /ventas/:id/boleta`: la misma de `armarBoleta`, solo
   * para una venta `pagada` o `cancelada` (owner, 2026-09-18). La `cancelada`
   * se reimprime —el papel la marca `ANULADA`, `ticket-builder.ts`—; la que
   * todavía no se cobró del todo (`pendiente`, `pagada_parcial`) no, porque
   * su papel saldría con la sección de pagos incompleta y sin nada que diga
   * que la venta sigue abierta.
   *
   * ⚠️ El filtro va acá y no dentro de `armarBoleta`: el cobro también la
   * llama (`crear`, `SalonesService.cerrarCuenta`), y un cobro del POS puede
   * dejar la venta `pendiente` o `pagada_parcial` — ese papel sí se imprime.
   */
  async reimprimirBoleta(
    tenantId: string,
    ventaId: string,
    usuarioId: string,
    verTodas: boolean,
  ): Promise<BoletaVenta> {
    const boleta = await this.armarBoleta(
      this.db,
      tenantId,
      ventaId,
      usuarioId,
      verTodas,
    );
    if (
      boleta.estado !== EstadoVenta.PAGADA &&
      boleta.estado !== EstadoVenta.CANCELADA
    )
      throw new BadRequestException(
        `Solo se reimprime la boleta de una venta pagada o anulada (esta está "${boleta.estado}").`,
      );
    return boleta;
  }

  /**
   * Reimpresión de quien NO tiene `Ventas:Anular` — solo `Ventas:Leer` (la
   * cajera). Decisión del owner, 2026-09-30 (`docs/agent/pendientes.md` § 3,
   * "Conectar con QZ Tray tiene el mismo techo que imprimir"): reimprime la
   * boleta de una venta SOLO si es de su propia caja y esa caja sigue
   * `abierta`, y nada más — el encargado (`Ventas:Anular`) sigue con el
   * alcance de siempre en `reimprimirBoleta`.
   *
   * Dos capas, no una — la revisión de seguridad del 2026-09-30 encontró que
   * una sola tiraba 403 también para una venta que la cajera NUNCA pudo ver,
   * confirmando por otra puerta que esa venta existe (mismo hueco que la
   * auditoría del 2026-08-22 le cerró a `findOne`, "un 403 confirmaría que
   * existe"):
   *
   * 1. **Visibilidad = el alcance de siempre.** `reimprimirBoleta(...,
   *    verTodas: false)` reusa `filtroDeMisCajas` tal cual —su caja en
   *    CUALQUIER estado, más las `online`— sin duplicarlo a mano. Lo que ese
   *    filtro deja afuera (la venta física de OTRA caja) nunca llega:
   *    `armarBoleta` la filtra de la cabecera y da su 404 de siempre, igual
   *    que `findOne`/`listar`.
   * 2. **De lo que sí ve, reimprime menos.** `exigirCajaPropiaAbierta`
   *    aplica la regla angosta —su caja Y `estado = 'abierta'`— sobre lo que
   *    la capa 1 ya confirmó visible: la online (sin dueño) y su propia caja
   *    ya cerrada o en conciliación caen acá, con 403.
   *
   * ⚠️ Sin lock entre las dos capas: la caja podría cerrarse en el medio (dos
   * requests casi simultáneos, cajera cerrando mientras reimprime). Se
   * acepta a propósito — esto solo imprime un papel, no mueve plata ni
   * stock; el peor caso es una copia de una caja que cerró hace un instante.
   */
  async reimprimirBoletaPropia(
    tenantId: string,
    ventaId: string,
    usuarioId: string,
  ): Promise<BoletaVenta> {
    const boleta = await this.reimprimirBoleta(
      tenantId,
      ventaId,
      usuarioId,
      false,
    );
    await this.exigirCajaPropiaAbierta(tenantId, ventaId, usuarioId);
    return boleta;
  }

  /**
   * La capa angosta de `reimprimirBoletaPropia` (ver su docblock): sobre una
   * venta que YA se sabe visible —esta función corre después de
   * `reimprimirBoleta`, que ya la encontró—, exige que la caja sea la del
   * usuario Y siga `estado = 'abierta'`. Mismo corte literal que
   * `CajaService.bloquearCajaAbierta` (`en_conciliacion` NO cuenta como
   * abierta acá, ni para operar sobre la caja). Una venta `online` cuelga de
   * la caja virtual, sin `usuario_id` (`cajas.usuario_id IS NULL`), así que
   * nunca pasa el chequeo — la cajera no la tiene como suya, aunque SÍ la ve.
   *
   * Si la fila no aparece (que no debería: la venta ya existía hace un
   * instante) el fallo es CERRADO — 403, no un pase silencioso — porque acá
   * ya no es una pregunta de existencia sino de la caja, y no hay forma
   * segura de leer "no sé" como "sí".
   */
  private async exigirCajaPropiaAbierta(
    tenantId: string,
    ventaId: string,
    usuarioId: string,
  ): Promise<void> {
    const rows: { usuario_id: string | null; estado: string | null }[] =
      await this.db.query(
        `SELECT cj.usuario_id, cj.estado
           FROM ventas v
           LEFT JOIN cajas cj ON cj.caja_id = v.caja_id
                  AND cj.tenant_id = v.tenant_id AND cj.eliminado_el IS NULL
          WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL`,
        [ventaId, tenantId],
      );
    const fila = rows[0];
    if (!fila || fila.usuario_id !== usuarioId || fila.estado !== 'abierta') {
      throw new ForbiddenException(
        'Esa boleta la reimprime el encargado: no es de tu caja, o tu caja ya no está abierta.',
      );
    }
  }

  /**
   * Arma el payload de la boleta desde la venta YA PERSISTIDA. No llama al
   * motor de cálculo (`calculo-precios/` no se toca): los importes de
   * `venta_detalles` y sus tablas hijas ya están cuantizados y congelados.
   *
   * `runner` acepta el `EntityManager` de una transacción abierta (el cierre,
   * que arma la boleta en el mismo commit que la venta) o el `Db` de una
   * lectura suelta (la reimpresión) — los dos exponen `.query(sql, params)`
   * con la misma firma, así que no hace falta ramificar.
   *
   * Una query por tabla, todas con `eliminado_el IS NULL`, y ninguna dentro de
   * un loop. La cabecera junta `ventas` con `cuentas`/`mesas` (mesa y número de
   * cuenta cuando la venta viene de salones) y con `cajas`/`usuarios` (el
   * cajero: el usuario dueño de la caja con la que se cobró — el mismo que
   * `crearEnTransaccion` resuelve con `cajaService.findActiva`/`findVirtual`
   * más arriba), todo con `LEFT JOIN`: una venta del POS no tiene cuenta, y la
   * caja virtual de una venta online no tiene usuario dueño.
   *
   * `usuarioId`/`verTodas` son el mismo alcance por caja de `findOne`
   * (`filtroDeMisCajas`, ver su docblock): la boleta devuelve pagos con monto,
   * vuelto y cajero, exactamente el dato por el que la auditoría del
   * 2026-08-22 le puso alcance a `findOne`
   * (`docs/superpowers/specs/2026-08-22-visibilidad-ventas-pagos-design.md`).
   * Sin este filtro acá, `GET /ventas/:id/boleta` reabría por otra puerta lo
   * que esa auditoría cerró — pedir `Ventas:Anular` no alcanza, porque el
   * alcance cuelga de un eje distinto (`Cajas:Leer`) y alguien puede tener
   * `Anular` con la caja acotada. Parámetros obligatorios y sin default a
   * propósito: que ningún llamador futuro se olvide del alcance por omisión.
   * Solo hace falta en la query de CABECERA — las hijas cuelgan de un
   * `venta_id` que la cabecera ya validó.
   */
  async armarBoleta(
    runner: EntityManager | Db,
    tenantId: string,
    ventaId: string,
    usuarioId: string,
    verTodas: boolean,
  ): Promise<BoletaVenta> {
    type CabeceraRow = {
      venta_id: string;
      fecha: Date;
      canal: string;
      estado: EstadoVenta;
      total_bruto: string;
      total_descuentos: string;
      total_recargos: string;
      total_impuestos: string;
      total_final: string;
      cuenta_numero: number | null;
      mesa_nombre: string | null;
      cajero_nombre: string | null;
      cajero_apellido: string | null;
    };
    const paramsCabecera: unknown[] = [ventaId, tenantId];
    let filtroPropio = '';
    if (!verTodas) {
      paramsCabecera.push(usuarioId);
      filtroPropio = this.filtroDeMisCajas(paramsCabecera.length);
    }
    const cabeceraRows: CabeceraRow[] = await runner.query(
      `SELECT v.venta_id, v.fecha, v.canal, v.estado,
              v.total_bruto, v.total_descuentos, v.total_recargos,
              v.total_impuestos, v.total_final,
              cta.numero AS cuenta_numero, m.nombre AS mesa_nombre,
              u.nombre AS cajero_nombre, u.apellido AS cajero_apellido
         FROM ventas v
         LEFT JOIN cuentas cta ON cta.venta_id = v.venta_id
                AND cta.tenant_id = v.tenant_id AND cta.eliminado_el IS NULL
         LEFT JOIN mesas m ON m.mesa_id = cta.mesa_id
                AND m.tenant_id = v.tenant_id AND m.eliminado_el IS NULL
         LEFT JOIN cajas cj ON cj.caja_id = v.caja_id
                AND cj.tenant_id = v.tenant_id AND cj.eliminado_el IS NULL
         LEFT JOIN usuarios u ON u.usuario_id = cj.usuario_id
                AND u.eliminado_el IS NULL
        WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL
          ${filtroPropio}`,
      paramsCabecera,
    );
    // 404 y no 403: mismo criterio que `findOne` — un 403 confirmaría que la
    // venta existe.
    if (!cabeceraRows.length)
      throw new NotFoundException('Venta no encontrada');
    const cabecera = cabeceraRows[0];

    type DetalleRow = {
      item_id: string;
      descripcion: string | null;
      cantidad: string;
      cantidad_presentacion: string | null;
      unidad_codigo_presentacion: string | null;
      unidad_codigo_base: string;
      precio_unitario: string;
      total_linea: string;
      personalizacion: PersonalizacionRecetaSnapshot | null;
    };
    const detalles: DetalleRow[] = await runner.query(
      `SELECT d.item_id, d.descripcion, d.cantidad, d.cantidad_presentacion,
              d.unidad_codigo_presentacion, d.unidad_codigo_base,
              d.precio_unitario, d.total_linea, d.personalizacion
         FROM venta_detalles d
        WHERE d.venta_id = $1 AND d.eliminado_el IS NULL
        -- Mismo desempate que \`findOne\`: las líneas de un solo \`save\`
        -- comparten \`creado_el\` al microsegundo.
        ORDER BY d.creado_el ASC, d.detalle_id ASC`,
      [ventaId],
    );

    // Nombres de los ingredientes omitidos/extras, en UNA query. Gemelo
    // deliberado de `nombresIngredientesPersonalizacion` (arriba, para
    // `crearEnTransaccion`): ese recibe siempre el `EntityManager` de la
    // transacción de venta; acá `runner` también puede ser el `Db` de una
    // lectura fuera de transacción, así que no comparte su firma.
    const ingredienteIds = new Set<string>();
    for (const d of detalles) {
      const p = d.personalizacion;
      if (!p) continue;
      for (const id of p.omitidos ?? []) ingredienteIds.add(id);
      for (const e of p.extras ?? []) ingredienteIds.add(e.ingredienteItemId);
    }
    let nombresIngredientes = new Map<string, string>();
    if (ingredienteIds.size > 0) {
      const filasNombre: { item_id: string; nombre: string }[] =
        await runner.query(
          `SELECT item_id, nombre FROM items
            WHERE item_id = ANY($1) AND tenant_id = $2 AND eliminado_el IS NULL`,
          [[...ingredienteIds], tenantId],
        );
      nombresIngredientes = new Map(
        filasNombre.map((f) => [f.item_id, f.nombre]),
      );
    }

    const items = detalles.map((d) => {
      const lineasDetalle = detallePersonalizacion(
        d.personalizacion,
        nombresIngredientes,
      );
      const comentario = d.personalizacion?.comentario;
      return {
        descripcion: d.descripcion ?? d.item_id,
        cantidad: d.cantidad,
        cantidadPresentacion: d.cantidad_presentacion,
        unidadCodigoPresentacion: d.unidad_codigo_presentacion,
        unidadCodigoBase: d.unidad_codigo_base,
        precioUnitario: d.precio_unitario,
        totalLinea: d.total_linea,
        // Sin frasear: `detallePersonalizacion` ya devuelve la forma que
        // `BoletaVenta['items'][number]['personalizacionDetalle']` declara
        // (gemela de `PersonalizacionDetalleLinea` del frontend), y el texto
        // ("Sin X" / "Extra X xN") lo arma `lineasPersonalizacionPreciada`
        // allá — mandarlo ya fraseado le daría dos dueños al mismo renglón.
        ...(lineasDetalle.length
          ? { personalizacionDetalle: lineasDetalle }
          : {}),
        ...(comentario ? { comentario } : {}),
      };
    });

    const impuestosRows: {
      impuesto_id: string;
      nombre_regla: string;
      valor_aplicado: string;
      porcentaje_aplicado: string | null;
    }[] = await runner.query(
      `SELECT impuesto_id, nombre_regla, valor_aplicado, porcentaje_aplicado
         FROM ventas_impuestos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    // Agrupado por impuesto: un impuesto se congela POR LÍNEA
    // (`aplicado_en = 'detalle'`), y la boleta muestra un total por impuesto,
    // no uno por línea — mismo criterio que `agregarImpuestosVenta` en
    // `ticket-builder.ts` (frontend), que agrupa las trazas del motor cuando
    // arma la precuenta del carrito vivo.
    const impuestosOrden: string[] = [];
    const impuestosPorId = new Map<
      string,
      { nombre: string; tasa: string; monto: Decimal }
    >();
    for (const row of impuestosRows) {
      const prev = impuestosPorId.get(row.impuesto_id);
      if (prev) {
        prev.monto = prev.monto.plus(row.valor_aplicado);
      } else {
        impuestosOrden.push(row.impuesto_id);
        impuestosPorId.set(row.impuesto_id, {
          nombre: row.nombre_regla,
          tasa: row.porcentaje_aplicado ?? '0',
          monto: new Decimal(row.valor_aplicado),
        });
      }
    }
    const impuestos = impuestosOrden.map((id) => {
      const i = impuestosPorId.get(id)!;
      return { nombre: i.nombre, tasa: i.tasa, monto: i.monto.toFixed(4) };
    });

    const promocionesRows: {
      promocion_id: string;
      nombre_promocion: string;
      monto: string;
    }[] = await runner.query(
      `SELECT promocion_id, nombre_promocion, monto
         FROM ventas_promociones WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const promocionesOrden: string[] = [];
    const promocionesPorId = new Map<
      string,
      { nombre: string; monto: Decimal }
    >();
    for (const row of promocionesRows) {
      const prev = promocionesPorId.get(row.promocion_id);
      if (prev) {
        prev.monto = prev.monto.plus(row.monto);
      } else {
        promocionesOrden.push(row.promocion_id);
        promocionesPorId.set(row.promocion_id, {
          nombre: row.nombre_promocion,
          monto: new Decimal(row.monto),
        });
      }
    }
    const promociones = promocionesOrden.map((id) => {
      const p = promocionesPorId.get(id)!;
      return { id, nombre: p.nombre, monto: p.monto.toFixed(4) };
    });

    // Mismo criterio que `findOne` (arriba): `venta_customer` no tiene
    // `tenant_id` propio, así que el aislamiento por tenant ya lo dio el
    // filtro de la CABECERA (`v.tenant_id = $2`) — `venta_id` es su única FK.
    // Solo las tres columnas que el ticket imprime (`BoletaCliente` en
    // `ticket-builder.ts`): el resto de `venta_customer` (telefono, email,
    // terceroId) no tiene lector en el papel.
    const customerRows: {
      nombre: string;
      rut: string | null;
      direccion: string | null;
    }[] = await runner.query(
      `SELECT nombre, rut, direccion
           FROM venta_customer WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    const customer = customerRows[0]
      ? {
          nombre: customerRows[0].nombre,
          rut: customerRows[0].rut,
          direccion: customerRows[0].direccion,
        }
      : null;

    const pagosRows: {
      pago_id: string;
      metodo_pago_id: string;
      monto: string;
      vuelto: string;
    }[] = await runner.query(
      `SELECT pago_id, metodo_pago_id, monto, vuelto
         FROM pagos WHERE venta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
        -- \`pago_id\` desempata: mismo empate que \`findOne\` (arriba) por el
        -- mismo loop de \`PagosService.registrar\`. Solo estabiliza el orden en
        -- que la boleta reimpresa lista los pagos, no reproduce el orden en
        -- que el cajero los tipeó (no se guarda en ningún lado).
        ORDER BY creado_el ASC, pago_id ASC`,
      [ventaId, tenantId],
    );
    const metodoPagoIds = [...new Set(pagosRows.map((p) => p.metodo_pago_id))];
    let nombresMetodoPago = new Map<string, string>();
    if (metodoPagoIds.length > 0) {
      const filasMetodo: { metodo_pago_id: string; nombre: string }[] =
        await runner.query(
          `SELECT metodo_pago_id, nombre FROM metodos_pago
            WHERE metodo_pago_id = ANY($1) AND eliminado_el IS NULL`,
          [metodoPagoIds],
        );
      nombresMetodoPago = new Map(
        filasMetodo.map((f) => [f.metodo_pago_id, f.nombre]),
      );
    }
    const pagos = pagosRows.map((p) => ({
      // '' y no el id: mismo fallback que hoy usa `index.vue` al resolver el
      // método por nombre (un método soft-borrado desaparece del JOIN, no la
      // fila del pago).
      nombre: nombresMetodoPago.get(p.metodo_pago_id) ?? '',
      monto: p.monto,
    }));
    // El vuelto es de la VENTA, no de cada pago: solo el efectivo lo admite
    // (`permite_vuelto`), así que sumar el `vuelto` de todos los pagos da el
    // mismo número que leer el del único que puede tenerlo, sin tener que
    // saber cuál es.
    const totalVuelto = pagosRows.reduce(
      (acc, p) => acc.plus(p.vuelto),
      new Decimal(0),
    );
    const vuelto = totalVuelto.isZero() ? null : totalVuelto.toFixed(4);

    // ⚠️ La propina de la venta vive en `venta_propina.monto_pagado`, NUNCA en
    // `pago_aplicaciones` (eso reparte un pago entre venta/propina cuando un
    // solo cobro paga las dos cosas — ver `findOne` más arriba). El cierre de
    // mesa crea SIEMPRE una fila acá, incluso sin propina (con
    // `estado = 'sin_propina'` y `monto_pagado = '0'`,
    // `venta-propina.service.ts:47-49`): filtrar por `estado = 'pagada'` es lo
    // que separa "no hay propina" de "hay una fila en cero".
    const propinaRows: { monto_pagado: string }[] = await runner.query(
      `SELECT monto_pagado FROM venta_propina
        WHERE venta_id = $1 AND tenant_id = $2 AND estado = 'pagada'
          AND eliminado_el IS NULL`,
      [ventaId, tenantId],
    );
    const propina = propinaRows.length
      ? { monto: propinaRows[0].monto_pagado }
      : null;

    // Mismo molde que `CajaService` para nombre+apellido: filtrar el
    // soft-delete va en el ON del LEFT JOIN de la cabecera, no acá — así la
    // fila sobrevive y solo el nombre del cajero se pierde.
    const cajero =
      [cabecera.cajero_nombre, cabecera.cajero_apellido]
        .filter((p): p is string => Boolean(p))
        .join(' ')
        .trim() || null;

    return {
      ventaId: cabecera.venta_id,
      fecha: cabecera.fecha,
      canal: cabecera.canal,
      estado: cabecera.estado,
      mesa: cabecera.mesa_nombre,
      cuentaNumero: cabecera.cuenta_numero,
      cajero,
      items,
      totales: {
        subtotalNeto: cabecera.total_bruto,
        totalDescuentos: cabecera.total_descuentos,
        totalRecargos: cabecera.total_recargos,
        totalImpuestos: cabecera.total_impuestos,
        totalFinal: cabecera.total_final,
      },
      impuestos,
      promociones,
      customer,
      propina,
      pagos,
      vuelto,
    };
  }
}
