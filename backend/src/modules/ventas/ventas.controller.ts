import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import {
  RequiresPermiso,
  RequiresAlgunPermiso,
} from '../../common/decorators/requires-permiso.decorator';
import { ClaveIdempotencia } from '../../common/decorators/clave-idempotencia.decorator';
import { RbacService } from '../rbac/rbac.service';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { VentasService } from './ventas.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import { QueryVentasDto } from './dto/query-ventas.dto';
import { CreateNotaCreditoDto } from './dto/create-nota-credito.dto';
import { CancelarVentaDto } from './dto/cancelar-venta.dto';
import { CompletarDocumentoDto } from './dto/completar-documento.dto';

@ApiTags('ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('ventas')
export class VentasController {
  constructor(
    private readonly ventasService: VentasService,
    private readonly rbacService: RbacService,
  ) {}

  @Post()
  @RequiresPermiso('Ventas', 'Crear')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'UUID por intento de cobro. El reintento con la misma clave reproduce la venta ya creada.',
  })
  async crear(
    @Req() req: Request,
    @Body(EscalaMonedaPipe) dto: CreateVentaDto,
    @ClaveIdempotencia() clave: string,
  ) {
    const u = req.user as JwtUser;
    return this.ventasService.crear(u.tenantId ?? '', u.id, dto, clave);
  }

  @Post(':id/notas-credito')
  @RequiresPermiso('Ventas', 'Nota de crédito')
  async crearNotaCredito(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: CreateNotaCreditoDto,
  ) {
    const u = req.user as JwtUser;
    return this.ventasService.crearNotaCreditoDesdeVenta({
      tenantId: u.tenantId ?? '',
      usuarioId: u.id,
      ventaOriginalId: id,
      monto: dto.monto,
      comentario: dto.comentario,
      devoluciones: dto.devoluciones,
      // El cliente dice por dónde vuelve la plata; el servidor resuelve qué
      // documento corrige y valida que el pago sea de ESTA venta y ESTE tenant.
      via:
        dto.devolucion.pagoId !== undefined
          ? { tipo: 'pago', pagoId: dto.devolucion.pagoId }
          : { tipo: 'sin_plata' },
    });
  }

  /**
   * Anota después el número de un documento de la máquina o hecho por fuera
   * (spec `2026-10-01-emision-por-venta`, § 3.4). `Ventas:Crear` es el piso, y el
   * eje **`Cajas:Leer`** dice sobre qué ventas: el mismo alcance que `findOne`
   * (404, no 403, si la venta no es suya). El tenant sale del token; el body
   * solo trae lo que se tipeó.
   */
  @Patch(':id/documentos/:documentoId')
  @RequiresPermiso('Ventas', 'Crear')
  async completarNumeroDocumento(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Body() dto: CompletarDocumentoDto,
  ) {
    const u = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      u.id,
      u.tenantId!,
    );
    return this.ventasService.completarNumeroDocumento({
      tenantId: u.tenantId ?? '',
      usuarioId: u.id,
      verTodas,
      ventaId: id,
      documentoId,
      numero: dto.numero,
      clase: dto.clase,
    });
  }

  /**
   * Borra el número de un documento hecho por fuera (PRODUCTO § 10, owner
   * 2026-10-02): quien puede anular ventas (`Ventas:Anular`) puede corregir un
   * número anotado por error, y queda registrado quién, cuándo y qué decía. La
   * venta vuelve a "sin número", así que anular otra vez pregunta (E10).
   *
   * Es un `POST` y no un `DELETE`: no se borra ninguna fila, el documento sigue
   * y el borrado queda como un hecho aparte. Sin body: el usuario sale del token
   * y el número que había lo lee el servidor. El alcance de caja es el de
   * `findOne` (404, no 403, si la venta no es suya), como el `PATCH` de arriba.
   */
  @Post(':id/documentos/:documentoId/borrar-numero')
  @RequiresPermiso('Ventas', 'Anular')
  async borrarNumeroDocumento(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
  ) {
    const u = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      u.id,
      u.tenantId!,
    );
    return this.ventasService.borrarNumeroDocumento({
      tenantId: u.tenantId ?? '',
      usuarioId: u.id,
      verTodas,
      ventaId: id,
      documentoId,
    });
  }

  @Post(':id/anular')
  @RequiresPermiso('Ventas', 'Anular')
  async anular(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarVentaDto,
  ) {
    const u = req.user as JwtUser;
    return this.ventasService.cancelar({
      tenantId: u.tenantId ?? '',
      usuarioId: u.id,
      ventaId: id,
      motivo: dto.motivo,
      // Por defecto repone: no hacerlo pierde inventario en silencio.
      reponerStock: dto.reponerStock !== false,
      // Tal cual, sin default: `undefined` (no contestó) y `false` (contestó que
      // no) son dos conductas distintas (E10).
      externoHecho: dto.externoHecho,
    });
  }

  /**
   * Reimprimir la boleta de una venta pagada o anulada — la que todavía no se
   * cobró del todo da 400 (`VentasService.reimprimirBoleta`).
   *
   * `GET /ventas/:id` no alcanza para esto: su `SELECT` no trae
   * `venta_detalles.personalizacion`, así que un plato con ingredientes
   * sacados o extras saldría distinto al original.
   *
   * Dos niveles de permiso (owner, 2026-09-30 —
   * `docs/agent/pendientes.md` § 3, "Conectar con QZ Tray tiene el mismo
   * techo que imprimir"— reabre en este punto la decisión del 17/9 de
   * `docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md` § 2):
   *
   * - **`Ventas:Anular`** (el encargado): sigue igual que siempre. ⚠️ El
   *   permiso NO alcanza solo: igual que `findOne` (ver su docblock más
   *   abajo), esto pasa por el alcance de `resolverAlcanceDerivadoDeCaja`
   *   (eje `Cajas:Leer`, no `Ventas:Anular`) porque la boleta trae pagos con
   *   monto, vuelto y cajero — el mismo dato por el que la auditoría del
   *   2026-08-22 le puso alcance a `findOne`. Sin esto, un usuario con
   *   `Anular` pero caja acotada podría reimprimir la boleta de una venta de
   *   otra caja.
   * - **`Ventas:Leer`** a secas (la cajera): reimprime **solo** si la venta
   *   es de su propia caja y esa caja sigue `abierta` —
   *   `VentasService.reimprimirBoletaPropia` hace ese chequeo en dos capas:
   *   404 si la venta no es ni de su caja (en cualquier estado) ni `online`
   *   (mismo alcance de siempre, `filtroDeMisCajas` — ni se entera de que
   *   existe); 403 si SÍ la ve así pero no cumple la regla angosta (su caja
   *   ya cerrada/en conciliación, o la `online`, sin dueño).
   */
  @Get(':id/boleta')
  @RequiresAlgunPermiso(
    { modulo: 'Ventas', permiso: 'Anular' },
    { modulo: 'Ventas', permiso: 'Leer' },
  )
  async boleta(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const u = req.user as JwtUser;
    const tieneAnular = await this.rbacService.userHasPermiso(
      u.id,
      u.tenantId!,
      'Ventas',
      'Anular',
    );
    if (!tieneAnular) {
      return this.ventasService.reimprimirBoletaPropia(
        u.tenantId ?? '',
        id,
        u.id,
      );
    }
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      u.id,
      u.tenantId!,
    );
    return this.ventasService.reimprimirBoleta(
      u.tenantId ?? '',
      id,
      u.id,
      verTodas,
    );
  }

  /**
   * Alcance de lectura: `Ventas:Leer` es el piso —dice si podés entrar—, y el eje
   * **`Cajas:Leer`** dice CUÁNTO ves — `MiCaja` NO entra en la regla, ver el
   * docblock de `resolverAlcanceDerivadoDeCaja`. Sin esto, un cajero con `Ventas:Leer` leía
   * TODAS las ventas del tenant y el detalle de cualquiera de ellas, que trae
   * `caja_id`, `monto` y `vuelto` por pago: era el camino largo para reconstruir
   * el esperado de una caja ajena (auditoría del 2026-08-22, ver
   * `docs/superpowers/specs/2026-08-22-visibilidad-ventas-pagos-design.md`).
   */
  @Get('resumen')
  @RequiresPermiso('Ventas', 'Leer')
  async resumen(@Req() req: Request) {
    const u = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      u.id,
      u.tenantId!,
    );
    return this.ventasService.resumen(u.tenantId ?? '', u.id, verTodas);
  }

  @Get()
  @RequiresPermiso('Ventas', 'Leer')
  async listar(@Req() req: Request, @Query() query: QueryVentasDto) {
    const u = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      u.id,
      u.tenantId!,
    );
    return this.ventasService.listar(u.tenantId ?? '', query, u.id, verTodas);
  }

  @Get(':id')
  @RequiresPermiso('Ventas', 'Leer')
  async findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const u = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      u.id,
      u.tenantId!,
    );
    return this.ventasService.findOne(u.tenantId ?? '', id, u.id, verTodas);
  }
}

@ApiTags('ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('tipos-documento')
export class TiposDocumentoController {
  constructor(private readonly ventasService: VentasService) {}

  @Get()
  @RequiresPermiso('Ventas', 'Leer')
  async listar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.ventasService.findTiposDocumento(u.tenantId ?? '');
  }
}
