import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import {
  ClaveIdempotencia,
  resolverClaveIdempotencia,
} from '../../common/decorators/clave-idempotencia.decorator';
import { RbacService } from '../rbac/rbac.service';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
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
  ConfirmarCompraDto,
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
    private readonly rbacService: RbacService,
  ) {}

  /**
   * ¿El llamador tiene `Compras:Pagar`? Resuelto a mano (no
   * `@RequiresPermiso`) porque hace falta condicional: `confirmar` solo lo
   * exige cuando el body trae `pago` (spec § 7), y las lecturas de compras
   * (`findAll`/`findOne`) lo usan para decidir qué campos devolver, no para
   * rechazar la ruta entera (decisión 12) — mismo molde que
   * `resolverEscrituraCompartida` en `caja.controller.ts`.
   */
  private tienePermisoPagar(u: JwtUser): Promise<boolean> {
    return this.rbacService.userHasPermiso(
      u.id,
      u.tenantId!,
      'Compras',
      'Pagar',
    );
  }

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
  async findAll(@Req() req: Request, @Query() query: FindComprasDto) {
    const u = req.user as JwtUser;
    const tienePagar = await this.tienePermisoPagar(u);
    if (query.estadoPago && !tienePagar) {
      throw new ForbiddenException('No tienes permiso para esta acción');
    }
    return this.comprasService.findAll(u.tenantId!, query, tienePagar);
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

  /**
   * Lo que se debe, por proveedor (spec § 8): "el bodeguero recibe y el
   * dueño paga" (decisión 12). `Pagar`, ANTES de `@Get(':id')`.
   */
  @Get('por-pagar')
  @RequiresPermiso('Compras', 'Pagar')
  porPagar(@Req() req: Request) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.porPagar(tenantId);
  }

  /** El detalle de un proveedor en "Por pagar" (spec § 8). `Pagar`, ANTES de `@Get(':id')`. */
  @Get('por-pagar/:proveedorId')
  @RequiresPermiso('Compras', 'Pagar')
  porPagarProveedor(
    @Req() req: Request,
    @Param('proveedorId', ParseUUIDPipe) proveedorId: string,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.porPagarProveedor(tenantId, proveedorId);
  }

  @Get(':id')
  @RequiresPermiso('Compras', 'Leer')
  async findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const u = req.user as JwtUser;
    const tienePagar = await this.tienePermisoPagar(u);
    return this.comprasService.findOne(u.tenantId!, id, tienePagar);
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
   *
   * Con `pago` (spec § 7, "compra al contado en un solo gesto"): exige
   * `Compras:Pagar` además de `Crear` — resuelto ACÁ, a mano, porque
   * `@RequiresPermiso` no puede condicionar por el body — y `Idempotency-Key`
   * (es un cobro, ADR-026). Sin `pago`, ninguno de los dos aplica: la
   * cabecera es opcional y un bodeguero sin `Pagar` sigue pudiendo confirmar
   * sin pagar.
   */
  @Post(':id/confirmar')
  @RequiresPermiso('Compras', 'Crear')
  async confirmar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: ConfirmarCompraDto,
  ) {
    const u = req.user as JwtUser;
    // Se resuelve SIEMPRE, con o sin `pago`: la respuesta de confirmar trae
    // los campos de pago (spec § 8) igual que un `GET /compras/:id`
    // posterior — el dueño que confirma sin pagar todavía tiene `Pagar`.
    const tienePagar = await this.tienePermisoPagar(u);
    if (!dto.pago) {
      return this.comprasService.confirmar(
        u.tenantId!,
        u.id,
        id,
        undefined,
        undefined,
        tienePagar,
      );
    }
    if (!tienePagar) {
      throw new ForbiddenException('No tienes permiso para esta acción');
    }
    const clave = resolverClaveIdempotencia(req.headers['idempotency-key']);
    return this.comprasService.confirmar(
      u.tenantId!,
      u.id,
      id,
      dto.pago,
      clave,
      tienePagar,
    );
  }

  /**
   * Completa o corrige el precio de una línea ya confirmada (spec
   * compras-recepcion § 4.4). `Actualizar` y no `Crear`: cambia el costo de
   * mercadería que ya entró, y puede tocar lo que se vendió después.
   */
  @Patch(':id/lineas/:lineaId')
  @RequiresPermiso('Compras', 'Actualizar')
  async corregirLinea(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineaId', ParseUUIDPipe) lineaId: string,
    @Body(EscalaMonedaPipe) dto: CorregirLineaDto,
  ) {
    const u = req.user as JwtUser;
    const tienePagar = await this.tienePermisoPagar(u);
    return this.comprasService.corregirLinea(
      u.tenantId!,
      u.id,
      id,
      lineaId,
      dto,
      tienePagar,
    );
  }

  /** El descuento al total de una confirmada. Mismo permiso que la línea. */
  @Patch(':id/descuento')
  @RequiresPermiso('Compras', 'Actualizar')
  async corregirDescuento(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: CorregirDescuentoDto,
  ) {
    const u = req.user as JwtUser;
    const tienePagar = await this.tienePermisoPagar(u);
    return this.comprasService.corregirDescuento(
      u.tenantId!,
      u.id,
      id,
      dto,
      tienePagar,
    );
  }

  /**
   * Corrige el total del documento o el vencimiento de una confirmada (spec
   * compras-deuda-proveedor § 6). `Actualizar`, el mismo permiso que
   * corregir un precio o el descuento.
   */
  @Patch(':id/documento')
  @RequiresPermiso('Compras', 'Actualizar')
  async actualizarDocumento(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: ActualizarDocumentoDto,
  ) {
    const u = req.user as JwtUser;
    const tienePagar = await this.tienePermisoPagar(u);
    return this.comprasService.actualizarDocumento(
      u.tenantId!,
      id,
      dto,
      tienePagar,
    );
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
  async anular(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnularCompraDto,
  ) {
    const u = req.user as JwtUser;
    const tienePagar = await this.tienePermisoPagar(u);
    return this.comprasService.anular(u.tenantId!, u.id, id, dto, tienePagar);
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
