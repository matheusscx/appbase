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
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { ImpresorasService } from './impresoras.service';
import { QzFirmaService } from './qz-firma.service';
import { CreateImpresoraDto } from './dto/create-impresora.dto';
import { UpdateImpresoraDto } from './dto/update-impresora.dto';
import { FirmarQzDto } from './dto/firmar-qz.dto';
import { QueryImpresorasDto } from './dto/query-impresoras.dto';

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
