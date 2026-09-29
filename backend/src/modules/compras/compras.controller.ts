import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import { ClaveIdempotencia } from '../../common/decorators/clave-idempotencia.decorator';
import { ComprasService } from './compras.service';
import { PresentacionesCompraService } from './presentaciones-compra.service';
import { LecturaDteService } from './lectura-dte.service';
import { CompraBorradorDto } from './dto/compra-borrador.dto';
import { FindComprasDto } from './dto/find-compras.dto';
import { AnularCompraDto } from './dto/anular-compra.dto';
import {
  ActualizarDocumentoDto,
  CorregirDescuentoDto,
  CorregirLineaDto,
} from './dto/corregir-compra.dto';
import {
  CrearPresentacionCompraDto,
  EditarPresentacionCompraDto,
  ListarPresentacionesCompraDto,
} from './dto/presentacion-compra.dto';
import { LecturaDteDto } from './dto/lectura-dte.dto';
import {
  AnularPagoProveedorDto,
  CrearPagoProveedorDto,
  FindPagosProveedorDto,
} from './dto/pago-proveedor.dto';

/**
 * Módulo propio `Compras` (spec compras-recepcion § 5): el que recibe no es
 * el que paga, y colgarlo de Inventario daría compras a todo el que cuenta
 * stock. `Crear` cubre el borrador entero (crear, editar, descartar) porque
 * es un solo trabajo que todavía no movió nada.
 *
 * ⚠️ Las rutas fijas van ANTES de `/:id`, o Nest las toma como un id.
 */
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('compras')
export class ComprasController {
  constructor(
    private readonly comprasService: ComprasService,
    private readonly presentacionesService: PresentacionesCompraService,
    private readonly lecturaDteService: LecturaDteService,
  ) {}

  @Get('tipos-documento')
  @RequiresPermiso('Compras', 'Leer')
  tiposDocumento(@Req() req: Request) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.tiposDocumento(tenantId);
  }

  @Get('proveedores')
  @RequiresPermiso('Compras', 'Leer')
  proveedores(@Req() req: Request) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.proveedores(tenantId);
  }

  /**
   * Los productos e ingredientes que se pueden comprar. Propio de Compras, como
   * `proveedores`: quien recibe mercadería no necesita permiso sobre el
   * catálogo de ítems (owner, 2026-09-19). `Crear`, porque es la lista para
   * cargar una compra.
   */
  @Get('productos')
  @RequiresPermiso('Compras', 'Crear')
  productos(@Req() req: Request) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.productos(tenantId);
  }

  /**
   * Cómo le viene cada producto a un proveedor (spec compras-unidad-de-compra
   * § 5). `Crear`: se crean, corrigen y retiran en plena carga del borrador
   * (owner, 2026-09-27), es operación del módulo y no configuración del admin.
   */
  @Get('presentaciones')
  @RequiresPermiso('Compras', 'Crear')
  presentaciones(
    @Req() req: Request,
    @Query() query: ListarPresentacionesCompraDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.presentacionesService.listar(tenantId, query.proveedorId);
  }

  @Post('presentaciones')
  @RequiresPermiso('Compras', 'Crear')
  crearPresentacion(
    @Req() req: Request,
    @Body() dto: CrearPresentacionCompraDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.presentacionesService.crear(tenantId, dto);
  }

  @Patch('presentaciones/:id')
  @RequiresPermiso('Compras', 'Crear')
  editarPresentacion(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPresentacionCompraDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.presentacionesService.editar(tenantId, id, dto);
  }

  @Delete('presentaciones/:id')
  @HttpCode(204)
  @RequiresPermiso('Compras', 'Crear')
  retirarPresentacion(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.presentacionesService.retirar(tenantId, id);
  }

  @Get()
  @RequiresPermiso('Compras', 'Leer')
  findAll(@Req() req: Request, @Query() query: FindComprasDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.findAll(tenantId, query);
  }

  /**
   * Lo que el sistema sabe de una factura leída en el navegador (spec
   * compras-xml-dte § 7). POST por el tamaño del body; no escribe nada.
   * `Crear`: es el primer paso de cargar una compra.
   */
  @Post('dte/lectura')
  @HttpCode(200)
  @RequiresPermiso('Compras', 'Crear')
  leerDte(@Req() req: Request, @Body() dto: LecturaDteDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.lecturaDteService.leer(tenantId, dto);
  }

  /**
   * Los medios habilitados del tenant, para el modal de pago (spec § 5.1).
   * `Pagar`: es información de quien paga (decisión 12), y va ANTES de
   * `@Get(':id')` o "medios-pago" se lee como un id.
   */
  @Get('medios-pago')
  @RequiresPermiso('Compras', 'Pagar')
  mediosPago(@Req() req: Request) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.mediosPago(tenantId);
  }

  /**
   * Los pagos de un proveedor, con sus aplicaciones (spec § 8, movido desde
   * la Tarea 3: sin esta lectura los e2e de pagar solo podrían afirmar por
   * SQL). `Pagar`, ANTES de `@Get(':id')`.
   */
  @Get('pagos')
  @RequiresPermiso('Compras', 'Pagar')
  listarPagos(@Req() req: Request, @Query() query: FindPagosProveedorDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.listarPagos(tenantId, query.proveedorId);
  }

  @Get(':id')
  @RequiresPermiso('Compras', 'Leer')
  findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.findOne(tenantId, id);
  }

  @Post()
  @RequiresPermiso('Compras', 'Crear')
  crear(@Req() req: Request, @Body(EscalaMonedaPipe) dto: CompraBorradorDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.crearBorrador(tenantId, usuarioId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Compras', 'Crear')
  actualizar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: CompraBorradorDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.actualizarBorrador(tenantId, id, dto);
  }

  /**
   * Mueve stock y costo: una entrada por línea. `Crear` y no un permiso
   * aparte, porque recibir la mercadería es el mismo trabajo que cargarla
   * (spec compras-recepcion § 5).
   */
  @Post(':id/confirmar')
  @RequiresPermiso('Compras', 'Crear')
  confirmar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.confirmar(tenantId, usuarioId, id);
  }

  /**
   * Completa o corrige el precio de una línea ya confirmada (spec
   * compras-recepcion § 4.4). `Actualizar` y no `Crear`: cambia el costo de
   * mercadería que ya entró, y puede tocar lo que se vendió después.
   */
  @Patch(':id/lineas/:lineaId')
  @RequiresPermiso('Compras', 'Actualizar')
  corregirLinea(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineaId', ParseUUIDPipe) lineaId: string,
    @Body(EscalaMonedaPipe) dto: CorregirLineaDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.corregirLinea(
      tenantId,
      usuarioId,
      id,
      lineaId,
      dto,
    );
  }

  /** El descuento al total de una confirmada. Mismo permiso que la línea. */
  @Patch(':id/descuento')
  @RequiresPermiso('Compras', 'Actualizar')
  corregirDescuento(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: CorregirDescuentoDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.corregirDescuento(tenantId, usuarioId, id, dto);
  }

  /**
   * Corrige el total del documento o el vencimiento de una confirmada (spec
   * compras-deuda-proveedor § 6). `Actualizar`, el mismo permiso que
   * corregir un precio o el descuento.
   */
  @Patch(':id/documento')
  @RequiresPermiso('Compras', 'Actualizar')
  actualizarDocumento(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: ActualizarDocumentoDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.actualizarDocumento(tenantId, id, dto);
  }

  /**
   * Registra un pago a proveedor (spec § 5.1): `Pagar`, y es un cobro —exige
   * `Idempotency-Key` (ADR-026, pattern backend § 18): el reintento del que
   * paga después de un corte reproduce el pago en vez de pagar dos veces.
   */
  @Post('pagos')
  @RequiresPermiso('Compras', 'Pagar')
  registrarPago(
    @Req() req: Request,
    @Body(EscalaMonedaPipe) dto: CrearPagoProveedorDto,
    @ClaveIdempotencia() clave: string,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.registrarPago(tenantId, usuarioId, dto, clave);
  }

  /**
   * Anula un pago a proveedor (spec § 5.2). `Pagar`, no `Anular` (el de la
   * compra): así quien se equivocó de monto lo deshace desde su propia caja
   * (spec § 2, decisión 7).
   */
  @Post('pagos/:id/anular')
  @RequiresPermiso('Compras', 'Pagar')
  anularPago(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnularPagoProveedorDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.anularPago(tenantId, usuarioId, id, dto);
  }

  /**
   * Anula una confirmada (spec compras-recepcion § 4.5). `Anular` va aparte
   * porque es la acción que más mueve: saca del stock todo lo que entró.
   */
  @Post(':id/anular')
  @RequiresPermiso('Compras', 'Anular')
  anular(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnularCompraDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.anular(tenantId, usuarioId, id, dto);
  }

  /**
   * Las unidades serializadas de una línea que pueden salir al bajar su
   * cantidad. `Actualizar`, el mismo permiso que la corrección que las usa.
   */
  @Get(':id/lineas/:lineaId/unidades')
  @RequiresPermiso('Compras', 'Actualizar')
  unidadesDeLinea(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineaId', ParseUUIDPipe) lineaId: string,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.unidadesDeLinea(tenantId, id, lineaId);
  }

  @Delete(':id')
  @RequiresPermiso('Compras', 'Crear')
  descartar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.descartarBorrador(tenantId, id);
  }
}
