import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { CausasMermaService } from './causas-merma.service';
import { CreateCausaMermaDto } from './dto/create-causa-merma.dto';
import { UpdateCausaMermaDto } from './dto/update-causa-merma.dto';
import { QueryCausasMermaDto } from './dto/query-causas-merma.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('causas-merma')
export class CausasMermaController {
  constructor(private readonly service: CausasMermaService) {}

  @Get()
  findAll(@Req() req: Request, @Query() query: QueryCausasMermaDto) {
    const user = req.user as { tenantId: string };
    return this.service.findAll(
      user.tenantId,
      query.soloActivas ?? false,
      query.incluirEliminados,
    );
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateCausaMermaDto) {
    const user = req.user as { tenantId: string };
    return this.service.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCausaMermaDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.service.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.service.remove(user.tenantId!, user.id, id);
  }

  @UseGuards(TenantAdminGuard)
  @Post(':id/restaurar')
  restaurar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.service.restaurar(user.tenantId!, id);
  }
}
