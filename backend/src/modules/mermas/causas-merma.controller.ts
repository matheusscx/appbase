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
import { CausasMermaService } from './causas-merma.service';
import { CreateCausaMermaDto } from './dto/create-causa-merma.dto';
import { UpdateCausaMermaDto } from './dto/update-causa-merma.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('causas-merma')
export class CausasMermaController {
  constructor(private readonly service: CausasMermaService) {}

  @Get()
  findAll(@Req() req: Request, @Query('soloActivas') soloActivas?: string) {
    const user = req.user as { tenantId: string };
    return this.service.findAll(user.tenantId, soloActivas === 'true');
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
    const user = req.user as { tenantId: string };
    return this.service.remove(user.tenantId, id);
  }
}
