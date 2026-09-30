import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  RequiresPermiso,
  RequiresAlgunPermiso,
} from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { ImpresorasService } from './impresoras.service';
import { QzFirmaService } from './qz-firma.service';
import { CreateImpresoraDto } from './dto/create-impresora.dto';
import { UpdateImpresoraDto } from './dto/update-impresora.dto';
import { FirmarQzDto } from './dto/firmar-qz.dto';
import { QueryImpresorasDto } from './dto/query-impresoras.dto';
import { QueryImpresorasOperacionDto } from './dto/query-impresoras-operacion.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('impresoras')
export class ImpresorasController {
  constructor(
    private readonly impresorasService: ImpresorasService,
    private readonly qzFirmaService: QzFirmaService,
  ) {}

  // ── Firmado QZ Tray (sin @RequiresPermiso: cert público, firma solo requiere
  // estar autenticado). Antes de @Patch(':id') para que 'qz' no sea un :id. ──
  @Get('qz/certificado')
  qzCertificado() {
    return { certificado: this.qzFirmaService.getCertificado() };
  }

  @Post('qz/firmar')
  qzFirmar(@Body() dto: FirmarQzDto) {
    return { firma: this.qzFirmaService.firmar(dto.data) };
  }

  /**
   * Impresoras activas de un rol, para quien IMPRIME — no para quien
   * administra la configuración (`listar`, abajo, exige `Impresoras:Leer`,
   * que hoy ningún rol operativo sembrado tiene). Solo los 6 campos que el
   * navegador necesita para hablarle a QZ Tray (`ImpresorasService
   * .listarOperativas`).
   *
   * **Guard — el permiso de cada camino que imprime (medido, 2026-09-30):**
   *
   * | Camino | Endpoint que llama | Permiso |
   * |---|---|---|
   * | Boleta del POS (cobrar) | `POST /ventas` | `Ventas:Crear` |
   * | Comanda | `POST /cuentas/:id/comanda/reclamar` | `Salones:Operar` |
   * | Precuenta | (misma pantalla de operación del salón) | `Salones:Operar` |
   * | Cobro de cuenta de salón (PIN) | `POST /cuentas/:id/cerrar` | `Salones:Operar` |
   * | Reimpresión de boleta | `GET /ventas/:id/boleta` | `Ventas:Anular`, o `Ventas:Leer` con la venta en su caja abierta |
   *
   * Tres módulos, no dos: `RequiresAlgunPermiso` advierte que no es un "OR"
   * genérico, pero acá las tres alternativas comparten la misma entidad —
   * imprimir es el acto operativo común de Ventas y Salones, igual que
   * Salones+Propinas lo es para el garzón (ver el docblock del decorador).
   * Vendedor (POS) tiene `Ventas:Crear`; garzón y encargado de salón tienen
   * `Salones:Operar`; `Ventas:Anular` abre la reimpresión de cualquier venta
   * (`ventas.controller.ts` → `boleta`). `Ventas:Leer` no está en la lista a
   * propósito: abriría la red de impresoras a roles de solo lectura. Quien
   * reimprime con `Ventas:Leer` lo hace desde su propia caja abierta, y quien
   * tiene caja cobra con `Ventas:Crear`. Un rol con caja y `Ventas:Leer` pero
   * sin `Crear` reimprimiría sin impresora: ningún rol sembrado es así.
   */
  @Get('operacion')
  @RequiresAlgunPermiso(
    { modulo: 'Ventas', permiso: 'Crear' },
    { modulo: 'Salones', permiso: 'Operar' },
    { modulo: 'Ventas', permiso: 'Anular' },
  )
  operacion(@Req() req: Request, @Query() query: QueryImpresorasOperacionDto) {
    const user = req.user as { tenantId: string };
    return this.impresorasService.listarOperativas(user.tenantId, query.rol);
  }

  @Get()
  @RequiresPermiso('Impresoras', 'Leer')
  listar(@Req() req: Request, @Query() query: QueryImpresorasDto) {
    const user = req.user as { tenantId: string };
    return this.impresorasService.listar(
      user.tenantId,
      query.rol,
      query.incluirEliminados,
    );
  }

  @Post()
  @RequiresPermiso('Impresoras', 'Crear')
  crear(@Req() req: Request, @Body() dto: CreateImpresoraDto) {
    const user = req.user as { tenantId: string };
    return this.impresorasService.crear(user.tenantId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Impresoras', 'Actualizar')
  actualizar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateImpresoraDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.impresorasService.actualizar(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequiresPermiso('Impresoras', 'Eliminar')
  eliminar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.impresorasService.eliminar(user.tenantId!, user.id, id);
  }

  @Post(':id/restaurar')
  @RequiresPermiso('Impresoras', 'Eliminar')
  restaurar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.impresorasService.restaurar(user.tenantId!, id);
  }
}
