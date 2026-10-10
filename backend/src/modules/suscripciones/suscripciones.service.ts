import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { Suscripcion } from './entities/suscripcion.entity';
import { CreateSuscripcionDto } from './dto/create-suscripcion.dto';
import { UpdateSuscripcionDto } from './dto/update-suscripcion.dto';
import { ItemsService } from '../items/items.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { VentasService } from '../ventas/ventas.service';
import { MetodosPagoService } from '../metodos-pago/metodos-pago.service';
import { InscripcionesService } from '../pasarela/services/inscripciones.service';
import {
  CobrosService,
  type CobroPreparado,
} from '../pasarela/services/cobros.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';
import { ProviderComunicacionError } from '../pasarela/providers/payment-provider.interface';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';
import { huellaDe } from '../idempotencia/huella';
import { calcularProximoCobro } from './utils/proximo-cobro.util';

const PASARELA_TOKENIZADA = 'oneclick';

// Lo que ve quien da de alta en cada caso (decisión del owner, 2026-10-09).
// Las que piden volver a confirmar dicen "sin recargarla": la clave vive en la
// memoria de la pestaña, y recargar empieza otro intento.
const MENSAJE_ALTA_OTROS_DATOS =
  'Esta suscripción ya se había pedido con otros datos. Revisá tus suscripciones antes de intentar de nuevo.';
const MENSAJE_COBRO_RECHAZADO =
  'El cobro de la suscripción fue rechazado. Probá con otra tarjeta.';
const MENSAJE_COBRO_SIN_CONFIRMAR =
  'Transbank no confirmó el cobro: no sabemos si salió. Volvé a confirmar desde esta pantalla, sin recargarla: el sistema lo consulta y no se te va a cobrar dos veces.';
const MENSAJE_NO_SE_COBRO =
  'No se cobró la suscripción: Transbank no registró el cargo. Podés intentar de nuevo.';
const MENSAJE_NO_SE_PUEDE_ACLARAR =
  'No pudimos confirmar con Transbank si se cobró. Esperá unos minutos y volvé a confirmar desde esta pantalla, sin recargarla: no se te va a cobrar dos veces.';
const MENSAJE_COBRADO_SIN_TERMINAR =
  'El cobro de la suscripción salió, pero no se pudo terminar el alta. Volvé a confirmar desde esta pantalla, sin recargarla: no se te va a cobrar dos veces.';
const MENSAJE_PRECIO_CAMBIO =
  'El cobro de la suscripción salió, pero el precio del plan cambió desde entonces y no se pudo terminar el alta. El comercio lo va a revisar: no vuelvas a intentar.';

/** Lo que el alta necesita para cobrar y para crear venta y suscripción. */
interface DatosAlta {
  item: { nombre: string; precioBase: string; monedaId: string | null };
  frecuencia: string;
  marca: string | null;
  ultimos4: string | null;
  totalFinal: string;
  metodoPagoId: string;
}

/** Lo que tx0 del alta le deja a tx1. */
interface AltaPreparada {
  datos: DatosAlta;
  cobro: CobroPreparado;
}

export interface AltaSuscripcion {
  id: string;
  itemId: string;
  itemNombre: string;
  precio: string;
  monedaId: string | null;
  frecuencia: string;
  diaMes: number | null;
  diaSemana: number | null;
  estado: string;
  proximoCobro: string;
  activaHasta: string | null;
  inscripcionId: string | null;
  tarjetaMarca: string | null;
  tarjetaLast4: string | null;
  ventaInicialId: string;
  creadoEl: Date;
  /**
   * Lo que el motor de precios tuvo que avisar sobre el primer período —
   * descuento topeado en cero, regla o impuesto pausado, faltante de receta.
   * Viene **siempre**, vacío si no hay nada que decir: sin eso el cliente no
   * puede distinguir "sin advertencias" de "el endpoint no las manda" (misma
   * convención que `garzones.service.ts`).
   *
   * Se devuelven aunque el cobro ya haya ocurrido: no son un freno, son la
   * explicación de por qué el monto autorizado no es el precio de catálogo.
   */
  advertencias: string[];
}

const TRANSICIONES: Record<string, { desde: string[]; hacia: string }> = {
  pausar: { desde: ['activa'], hacia: 'pausada' },
  reanudar: { desde: ['pausada'], hacia: 'activa' },
  cancelar: { desde: ['activa', 'pausada'], hacia: 'cancelada' },
};

@Injectable()
export class SuscripcionesService {
  private readonly logger = new Logger(SuscripcionesService.name);

  constructor(
    @InjectRepository(Suscripcion)
    private readonly suscripcionRepo: Repository<Suscripcion>,
    private readonly db: Db,
    private readonly itemsService: ItemsService,
    private readonly calculoPreciosService: CalculoPreciosService,
    private readonly ventasService: VentasService,
    private readonly metodosPagoService: MetodosPagoService,
    private readonly inscripcionesService: InscripcionesService,
    private readonly cobrosService: CobrosService,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly idempotencia: IdempotenciaService,
  ) {}

  /**
   * El alta: un cobro Oneclick por intento, aunque el cliente confirme dos
   * veces (ADR-029, § "El alta de suscripción"). El cargo lo hace Transbank,
   * fuera de la base, así que va por `ejecutarConEfectoExterno`:
   * - **preparar** (tx0): reclamo de la clave, los chequeos que pueden rebotar
   *   con 400 sin dejar rastro, y la orden en `en_proceso` (write-ahead);
   * - **efectuar** (tx1): con reclamo y orden bloqueados, cobra; si sale, venta,
   *   suscripción y conciliación de la orden en la misma tx. Un rechazo suelta
   *   la clave: el mismo intento con otra tarjeta vuelve a entrar;
   * - **resolverSinConfirmar**: el reintento cuyo primer intento murió o no
   *   tuvo respuesta de Transbank le pregunta si el cargo salió. Si salió,
   *   termina el alta sin cobrar; si no, lo dice y suelta la clave. Nunca vuelve
   *   a cobrar.
   *
   * El reintento que llega con el primero en curso espera su lock y reproduce:
   * `repetida: true`, "ya estaba activa".
   */
  async crear(
    tenantId: string,
    usuarioId: string,
    dto: CreateSuscripcionDto,
    clave: string,
  ): Promise<AltaSuscripcion & { repetida?: true }> {
    // El cobro al que Transbank pudo haber dicho que sí sin que nos enteremos:
    // si la llamada falla por comunicación, se anota sobre su orden.
    let llamado: CobroPreparado | undefined;
    try {
      const { origen, respuesta } =
        await this.idempotencia.ejecutarConEfectoExterno<
          AltaPreparada,
          AltaSuscripcion
        >(
          {
            tenantId,
            actor: { usuarioId },
            clave,
            operacion: 'suscripcion.alta',
            // Lo que el request pidió, campo por campo. Los días ausentes van
            // como `null`: omitirlos y mandarlos vacíos es el mismo pedido.
            huella: huellaDe('suscripcion.alta', {
              itemId: dto.itemId,
              diaMes: dto.diaMes ?? null,
              diaSemana: dto.diaSemana ?? null,
              inscripcionId: dto.inscripcionId,
            }),
            mensajeOtrosDatos: MENSAJE_ALTA_OTROS_DATOS,
          },
          {
            preparar: async (solicitudId) => {
              const datos = await this.leerAlta(tenantId, usuarioId, dto);
              const cobro = await this.cobrosService.prepararCobro(
                tenantId,
                {
                  inscripcionId: dto.inscripcionId,
                  pagadorRef: usuarioId,
                  monto: datos.totalFinal,
                  descripcion: `Suscripción ${datos.item.nombre}`,
                },
                solicitudId,
              );
              return { datos, cobro };
            },
            efectuar: async (_solicitudId, { datos, cobro }) => {
              const orden = await this.cobrosService.efectuarCobro(
                tenantId,
                cobro,
                () => {
                  llamado = cobro;
                },
              );
              if (orden.estado === 'fallida')
                return {
                  soltar: new BadRequestException(MENSAJE_COBRO_RECHAZADO),
                };
              // Otro camino la cerró entre tx0 y el lock (un `/verificar` de
              // la API): lo que no es `pagada` se aclara en el reintento.
              if (orden.estado !== 'pagada')
                throw new ConflictException(MENSAJE_NO_SE_PUEDE_ACLARAR);
              try {
                return {
                  respuesta: await this.materializarAlta(
                    tenantId,
                    usuarioId,
                    dto,
                    datos,
                    orden.ordenId,
                  ),
                };
              } catch (e) {
                throw this.cobradoSinTerminar(orden.ordenId, e);
              }
            },
            resolverSinConfirmar: async (solicitudId) => {
              const { veredicto, orden } =
                await this.cobrosService.aclararCobro(tenantId, solicitudId);
              if (veredicto === 'no_se_puede')
                throw new ConflictException(MENSAJE_NO_SE_PUEDE_ACLARAR);
              if (veredicto === 'fallida')
                return { soltar: new ConflictException(MENSAJE_NO_SE_COBRO) };
              // El cargo salió: se termina el alta con lo que pidió este
              // request, que es el mismo pedido (la huella coincidió).
              let datos: DatosAlta;
              try {
                datos = await this.leerAlta(tenantId, usuarioId, dto);
              } catch (e) {
                throw this.cobradoSinTerminar(orden.ordenId, e);
              }
              // La venta recalcula el precio; si cambió desde el cobro, no
              // cuadraría con lo cobrado. Queda sin aclarar y en el log.
              if (!new Decimal(datos.totalFinal).eq(orden.monto)) {
                this.logger.error(
                  `Cobro del alta aprobado (orden ${orden.ordenId}, ${orden.monto}) pero el plan hoy cuesta ${datos.totalFinal}: el alta no se termina`,
                );
                throw new ConflictException(MENSAJE_PRECIO_CAMBIO);
              }
              try {
                return {
                  respuesta: await this.materializarAlta(
                    tenantId,
                    usuarioId,
                    dto,
                    datos,
                    orden.ordenId,
                  ),
                };
              } catch (e) {
                throw this.cobradoSinTerminar(orden.ordenId, e);
              }
            },
            cuerpoOtrosDatos: () => Promise.resolve({}),
          },
        );
      // Un alta sin confirmar que resultó cobrada se ve como la primera
      // respuesta perdida: "ya estaba activa" (decisión del owner).
      return origen === 'efectuada'
        ? respuesta
        : { ...respuesta, repetida: true };
    } catch (e) {
      if (e instanceof ProviderComunicacionError && llamado) {
        // La tx del cobro hizo rollback: la orden sigue `en_proceso` (es de
        // tx0) y el reclamo sin respuesta. El reintento lo aclara.
        await this.cobrosService.anotarCobroSinConfirmar(tenantId, llamado, e);
        throw new BadGatewayException(MENSAJE_COBRO_SIN_CONFIRMAR);
      }
      if (llamado && !(e instanceof HttpException)) {
        // Falló algo que no es HTTP después de llamar a Transbank (la base al
        // registrar la respuesta, p. ej.): no sabemos si se cobró, y un 500
        // crudo no dice que no hay que recargar. El reintento lo aclara.
        this.logger.error(
          `Falló el alta después de llamar a Transbank (orden ${llamado.ordenId}): la orden queda 'en_proceso' y el reintento lo aclara. ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        throw new ConflictException(MENSAJE_NO_SE_PUEDE_ACLARAR);
      }
      throw e;
    }
  }

  /**
   * El cargo salió y lo que sigue falló (la venta, o re-leer el alta al
   * terminarla). La tx hace rollback: la orden vuelve a `en_proceso` y el
   * reclamo queda sin respuesta, así que el reintento consulta y termina sin
   * cobrar. Lo que no puede salir es el error crudo: un 400 de ventas o un 500
   * no dicen que el cobro ya ocurrió, y recargar la pantalla pierde la clave.
   */
  private cobradoSinTerminar(ordenId: string, e: unknown): ConflictException {
    this.logger.error(
      `Cobro Oneclick aprobado (orden ${ordenId}) pero no se pudo terminar el alta: la orden queda 'en_proceso' y el reintento lo aclara. ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return new ConflictException(MENSAJE_COBRADO_SIN_TERMINAR);
  }

  /**
   * Los chequeos del alta y lo que se cobra (pasos 1 a 6 de siempre). Corre en
   * tx0, después del reclamo: un rebote revierte la clave (ADR-026). Y otra vez
   * al terminar un alta cuyo cobro salió sin respuesta.
   */
  private async leerAlta(
    tenantId: string,
    usuarioId: string,
    dto: CreateSuscripcionDto,
  ): Promise<DatosAlta> {
    // 1. Item suscribible del tenant
    const item = await this.itemsService.findOne(tenantId, dto.itemId);
    if (item.tipo !== 'suscripcion') {
      throw new BadRequestException('El item no es una suscripción');
    }
    if (!item.activo) {
      throw new BadRequestException('El item no está activo');
    }
    const frecuencia = item.frecuencia as string;

    // 2. Día según frecuencia (el rango grueso lo valida el DTO; aquí las reglas cruzadas)
    if (frecuencia === 'mensual' && dto.diaMes == null) {
      throw new BadRequestException(
        'Las suscripciones mensuales requieren el día del mes (1-28)',
      );
    }
    if (frecuencia === 'quincenal') {
      if (dto.diaMes == null || dto.diaMes > 13) {
        throw new BadRequestException(
          'Las suscripciones quincenales requieren un día del mes entre 1 y 13',
        );
      }
    }
    if (frecuencia === 'semanal' && dto.diaSemana == null) {
      throw new BadRequestException(
        'Las suscripciones semanales requieren el día de la semana',
      );
    }

    // 3. Oneclick debe estar activo en el tenant (decisión: sin Oneclick se bloquea)
    await this.assertOneclickActivo(tenantId);

    // 4. Ownership de la tarjeta + snapshot server-side (marca/últimos4)
    const { marca, ultimos4 } =
      await this.inscripcionesService.resolverMedioDeUsuario(
        tenantId,
        dto.inscripcionId,
        usuarioId,
      );
    // 5. Total del primer período (mismo motor que usará la venta). Se necesita
    //    ANTES del cobro: es el monto que se le autoriza a la tarjeta.
    //
    //    `resultado.advertencias` se descarta acá a propósito. Las que viajan al
    //    cliente son las de la venta (`materializarAlta`), por una razón que no es de
    //    contenido sino de autoridad: la venta es el cálculo que queda
    //    persistido, así que sus advertencias explican la fila que existe. Las de
    //    acá explican un cálculo intermedio que no sobrevive.
    //
    //    Hoy los dos conjuntos son idénticos: la venta llama a `calcular` con
    //    argumentos equivalentes (mismo tenant, mismo ítem, cantidad 1, sin
    //    `metodoPagoId` ni reglas a nivel venta en ninguno de los dos; la venta
    //    manda además `precioUnitarioResuelto` —el canal interno del motor,
    //    desde el 2026-08-30—, que `resolverLinea` deriva igual cuando falta), y
    //    las advertencias que la venta agrega por su cuenta son de
    //    recetas y combos, inalcanzables acá porque el paso 1 rechaza todo lo que
    //    no sea `tipo='suscripcion'`.
    //    Que sean idénticos ya NO es una coincidencia: desde el 2026-08-21 los
    //    dos caminos arman el mapa de tasas igual —los dos pisan con `'1'` la
    //    tasa de la oficial— y "oficial" significa lo mismo en los dos lados,
    //    `pais.moneda_oficial_id` (ADR-005). Antes no: `ventas` tomaba
    //    `valor_del_dia` crudo y resolvía la moneda por `tenant_moneda.es_default`,
    //    un campo que ya no existe. Este comentario decía que "si dejaran de
    //    coincidir, la buena sigue siendo la de la venta"; ya no hay dos que
    //    puedan dejar de coincidir.
    // `canal` explícito por el mismo motivo que `online.service.ts:348`: decide
    // qué promociones aplican, y `totalFinal` de ESTE cálculo es lo que se
    // autoriza contra la tarjeta en tx1 del alta. Sin el `canal`, `calcular` cae
    // al default `'fisico'` — un conjunto de promos distinto del que la venta
    // usa al persistirse con `canal: 'online'` en `materializarAlta` — y lo cobrado
    // dejaría de coincidir con lo registrado.
    const resultado = await this.calculoPreciosService.calcular(tenantId, {
      canal: 'online' as const,
      lineas: [{ itemId: dto.itemId, cantidad: '1' }],
    });
    const totalFinal = resultado.totales.totalFinal;
    // 5b. Sobre el umbral de la Res. Ex. SII 44/2025, antes de cobrar: la venta
    //     de `materializarAlta` lo exigiría con la tarjeta ya cobrada.
    await this.ventasService.exigirCompraOnlineBajoUmbral(tenantId, totalFinal);

    // 6. Método de pago contable (se registra en el pago de la venta)
    const metodoPagoId =
      await this.metodosPagoService.resolverMetodoCredito(tenantId);

    return {
      item: {
        nombre: item.nombre,
        precioBase: item.precioBase,
        monedaId: item.monedaId ?? null,
      },
      frecuencia,
      marca,
      ultimos4,
      totalFinal,
      metodoPagoId,
    };
  }

  /**
   * Cobro OK → venta del primer período + suscripción, y la orden conciliada
   * con esa venta. Corre en la tx del cobro (o del aclarado), con la orden
   * bloqueada: si algo falla, todo vuelve atrás, la orden queda `en_proceso`
   * (es de tx0) y el reintento lo aclara consultando a Transbank, sin cobrar
   * de nuevo. Lock: orden → venta (`verificarReembolsable`).
   */
  private async materializarAlta(
    tenantId: string,
    usuarioId: string,
    dto: CreateSuscripcionDto,
    d: DatosAlta,
    ordenId: string,
  ): Promise<AltaSuscripcion> {
    // Nombre del usuario para el customer de la venta
    const usuarioRows: { nombre: string }[] = await this.db.query(
      `SELECT nombre FROM usuarios WHERE usuario_id = $1 AND eliminado_el IS NULL`,
      [usuarioId],
    );
    const customerNombre = usuarioRows[0]?.nombre ?? 'Suscriptor online';

    const salida = await this.db.transaccion(async (manager) => {
      const venta = await this.ventasService.crearEnTransaccion(
        manager,
        tenantId,
        usuarioId,
        {
          canal: 'online',
          lineas: [{ itemId: dto.itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: d.metodoPagoId, monto: d.totalFinal }],
          customer: { nombre: customerNombre },
        },
      );

      const suscripcion = await manager.save(
        Suscripcion,
        manager.create(Suscripcion, {
          tenantId,
          usuarioId,
          itemId: dto.itemId,
          frecuencia: d.frecuencia,
          diaMes: dto.diaMes ?? null,
          diaSemana: dto.diaSemana ?? null,
          estado: 'activa',
          proximoCobro: calcularProximoCobro(
            d.frecuencia,
            new Date(),
            dto.diaMes,
            dto.diaSemana,
          ),
          inscripcionId: dto.inscripcionId,
          tarjetaMarca: d.marca,
          tarjetaLast4: d.ultimos4,
          ventaInicialId: venta.id,
        }),
      );

      return {
        id: suscripcion.id,
        itemId: dto.itemId,
        itemNombre: d.item.nombre,
        precio: d.item.precioBase,
        monedaId: d.item.monedaId,
        frecuencia: suscripcion.frecuencia,
        diaMes: suscripcion.diaMes,
        diaSemana: suscripcion.diaSemana,
        estado: suscripcion.estado,
        proximoCobro: suscripcion.proximoCobro,
        activaHasta: suscripcion.activaHasta ?? null,
        inscripcionId: suscripcion.inscripcionId,
        tarjetaMarca: d.marca,
        tarjetaLast4: d.ultimos4,
        ventaInicialId: venta.id,
        creadoEl: suscripcion.creadoEl,
        advertencias: venta.advertencias,
      };
    });
    await this.cobrosService.vincularVenta(
      tenantId,
      ordenId,
      salida.ventaInicialId,
    );
    return salida;
  }

  private async assertOneclickActivo(tenantId: string): Promise<void> {
    try {
      await this.tenantPasarelaService.resolverConfiguracionActiva(
        tenantId,
        PASARELA_TOKENIZADA,
      );
    } catch {
      throw new BadRequestException(
        'Las suscripciones requieren tener Oneclick activo en la pasarela del tenant',
      );
    }
  }

  async findMias(tenantId: string, usuarioId: string) {
    const rows: {
      suscripcion_id: string;
      item_id: string;
      item_nombre: string;
      precio_base: string;
      moneda_id: string;
      frecuencia: string;
      dia_mes: number | null;
      dia_semana: number | null;
      estado: string;
      proximo_cobro: string;
      activa_hasta: string | null;
      inscripcion_id: string | null;
      tarjeta_marca: string | null;
      tarjeta_last4: string | null;
      venta_inicial_id: string | null;
      creado_el: Date;
    }[] = await this.db.query(
      `SELECT s.suscripcion_id, s.item_id, i.nombre AS item_nombre,
              i.precio_base, i.moneda_id,
              s.frecuencia, s.dia_mes, s.dia_semana, s.estado,
              s.proximo_cobro::text AS proximo_cobro,
              s.activa_hasta::text AS activa_hasta,
              s.inscripcion_id, s.tarjeta_marca, s.tarjeta_last4,
              s.venta_inicial_id, s.creado_el
       FROM suscripciones s
       JOIN items i ON i.item_id = s.item_id AND i.eliminado_el IS NULL
       WHERE s.tenant_id = $1 AND s.usuario_id = $2 AND s.eliminado_el IS NULL
       ORDER BY s.creado_el DESC`,
      [tenantId, usuarioId],
    );

    return rows.map((r) => ({
      id: r.suscripcion_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      precio: r.precio_base,
      monedaId: r.moneda_id,
      frecuencia: r.frecuencia,
      diaMes: r.dia_mes,
      diaSemana: r.dia_semana,
      estado: r.estado,
      proximoCobro: r.proximo_cobro,
      activaHasta: r.activa_hasta,
      inscripcionId: r.inscripcion_id,
      tarjetaMarca: r.tarjeta_marca,
      tarjetaLast4: r.tarjeta_last4,
      ventaInicialId: r.venta_inicial_id,
      creadoEl: r.creado_el,
    }));
  }

  async findTodas(tenantId: string) {
    const rows: {
      suscripcion_id: string;
      item_id: string;
      item_nombre: string;
      precio_base: string;
      moneda_id: string;
      usuario_id: string;
      usuario_nombre: string;
      usuario_email: string;
      frecuencia: string;
      dia_mes: number | null;
      dia_semana: number | null;
      estado: string;
      proximo_cobro: string;
      activa_hasta: string | null;
      inscripcion_id: string | null;
      tarjeta_marca: string | null;
      tarjeta_last4: string | null;
      venta_inicial_id: string | null;
      creado_el: Date;
    }[] = await this.db.query(
      `SELECT s.suscripcion_id, s.item_id, i.nombre AS item_nombre,
              i.precio_base, i.moneda_id,
              s.usuario_id, u.nombre AS usuario_nombre, u.correo AS usuario_email,
              s.frecuencia, s.dia_mes, s.dia_semana, s.estado,
              s.proximo_cobro::text AS proximo_cobro,
              s.activa_hasta::text AS activa_hasta,
              s.inscripcion_id, s.tarjeta_marca, s.tarjeta_last4,
              s.venta_inicial_id, s.creado_el
       FROM suscripciones s
       JOIN items i ON i.item_id = s.item_id AND i.eliminado_el IS NULL
       JOIN usuarios u ON u.usuario_id = s.usuario_id AND u.eliminado_el IS NULL
       WHERE s.tenant_id = $1 AND s.eliminado_el IS NULL
       ORDER BY s.creado_el DESC`,
      [tenantId],
    );

    return rows.map((r) => ({
      id: r.suscripcion_id,
      itemId: r.item_id,
      itemNombre: r.item_nombre,
      precio: r.precio_base,
      monedaId: r.moneda_id,
      usuarioId: r.usuario_id,
      usuarioNombre: r.usuario_nombre,
      usuarioEmail: r.usuario_email,
      frecuencia: r.frecuencia,
      diaMes: r.dia_mes,
      diaSemana: r.dia_semana,
      estado: r.estado,
      proximoCobro: r.proximo_cobro,
      activaHasta: r.activa_hasta,
      inscripcionId: r.inscripcion_id,
      tarjetaMarca: r.tarjeta_marca,
      tarjetaLast4: r.tarjeta_last4,
      ventaInicialId: r.venta_inicial_id,
      creadoEl: r.creado_el,
    }));
  }

  // usuarioId = null ⇒ scope admin: opera sobre cualquier suscripción del tenant.
  async cambiarEstado(
    tenantId: string,
    usuarioId: string | null,
    suscripcionId: string,
    dto: UpdateSuscripcionDto,
  ) {
    const suscripcion = await this.suscripcionRepo.findOne({
      where:
        usuarioId === null
          ? { id: suscripcionId, tenantId }
          : { id: suscripcionId, tenantId, usuarioId },
    });
    if (!suscripcion) {
      throw new NotFoundException('Suscripción no encontrada');
    }

    const transicion = TRANSICIONES[dto.accion];
    if (!transicion.desde.includes(suscripcion.estado)) {
      throw new BadRequestException(
        `No se puede ${dto.accion} una suscripción ${suscripcion.estado}`,
      );
    }

    suscripcion.estado = transicion.hacia;
    if (dto.accion === 'cancelar') {
      // El período ya cobrado sigue vigente: usable hasta el día anterior a
      // activa_hasta, "se cancela ese día a primera hora".
      suscripcion.activaHasta = suscripcion.proximoCobro;
    }
    await this.suscripcionRepo.save(suscripcion);
    return {
      id: suscripcion.id,
      estado: suscripcion.estado,
      activaHasta: suscripcion.activaHasta,
    };
  }

  /**
   * Reasigna la tarjeta (inscripción Oneclick) de una suscripción propia del
   * usuario. Solo activa/pausada; valida ownership de la suscripción y de la
   * inscripción, y actualiza el snapshot de tarjeta.
   */
  async cambiarTarjeta(
    tenantId: string,
    usuarioId: string,
    suscripcionId: string,
    inscripcionId: string,
  ) {
    const suscripcion = await this.suscripcionRepo.findOne({
      where: { id: suscripcionId, tenantId, usuarioId },
    });
    if (!suscripcion) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    if (!['activa', 'pausada'].includes(suscripcion.estado)) {
      throw new BadRequestException(
        `No se puede cambiar la tarjeta de una suscripción ${suscripcion.estado}`,
      );
    }

    const { marca, ultimos4 } =
      await this.inscripcionesService.resolverMedioDeUsuario(
        tenantId,
        inscripcionId,
        usuarioId,
      );

    suscripcion.inscripcionId = inscripcionId;
    suscripcion.tarjetaMarca = marca;
    suscripcion.tarjetaLast4 = ultimos4;
    await this.suscripcionRepo.save(suscripcion);
    return {
      id: suscripcion.id,
      inscripcionId,
      tarjetaMarca: marca,
      tarjetaLast4: ultimos4,
    };
  }

  /**
   * Cuenta las suscripciones vigentes (activa/pausada) amarradas a cada
   * inscripción de un usuario. Alimenta el aviso del modal de borrado de tarjeta.
   */
  async contarPorInscripcion(
    tenantId: string,
    usuarioId: string,
  ): Promise<Record<string, number>> {
    const rows: { inscripcion_id: string; total: number }[] =
      await this.db.query(
        `SELECT inscripcion_id, COUNT(*)::int AS total
         FROM suscripciones
         WHERE tenant_id = $1 AND usuario_id = $2 AND eliminado_el IS NULL
           AND inscripcion_id IS NOT NULL
           AND estado IN ('activa', 'pausada')
         GROUP BY inscripcion_id`,
        [tenantId, usuarioId],
      );
    return Object.fromEntries(rows.map((r) => [r.inscripcion_id, r.total]));
  }

  /**
   * Cancela todas las suscripciones vigentes (activa/pausada) de un usuario
   * amarradas a una inscripción. Se invoca al eliminar la tarjeta: usa la misma
   * semántica que `cancelar` (activa_hasta = proximo_cobro).
   */
  async cancelarPorInscripcion(
    tenantId: string,
    usuarioId: string,
    inscripcionId: string,
  ): Promise<{ canceladas: number }> {
    const suscripciones = await this.suscripcionRepo.find({
      where: [
        { tenantId, usuarioId, inscripcionId, estado: 'activa' },
        { tenantId, usuarioId, inscripcionId, estado: 'pausada' },
      ],
    });
    for (const s of suscripciones) {
      s.estado = 'cancelada';
      s.activaHasta = s.proximoCobro;
    }
    if (suscripciones.length) {
      await this.suscripcionRepo.save(suscripciones);
    }
    return { canceladas: suscripciones.length };
  }

  async eliminar(tenantId: string, suscripcionId: string) {
    const suscripcion = await this.suscripcionRepo.findOne({
      where: { id: suscripcionId, tenantId },
    });
    if (!suscripcion) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    if (suscripcion.estado !== 'cancelada') {
      throw new BadRequestException(
        'Solo se pueden eliminar suscripciones canceladas',
      );
    }
    await this.suscripcionRepo.softRemove(suscripcion);
    return { id: suscripcion.id };
  }
}
