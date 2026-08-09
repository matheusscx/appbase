import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Usuario } from '../users/usuario.entity';
import { UpdatePerfilDto } from './dto/update-perfil.dto';
import { UpdateContrasenaDto } from './dto/update-contrasena.dto';
import { UpdatePreferenciasDto } from './dto/update-preferencias.dto';
import type { UsuarioPreferencias } from '../../common/types/usuario-preferencias.interface';
import { mergeUsuarioPreferencias } from '../../common/utils/usuario-preferencias.util';

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(Usuario)
    private readonly repo: Repository<Usuario>,
  ) {}

  async updatePerfil(userId: string, dto: UpdatePerfilDto): Promise<Usuario> {
    await this.repo.update(userId, dto);
    return this.repo.findOneOrFail({ where: { id: userId } });
  }

  async updateContrasena(
    userId: string,
    dto: UpdateContrasenaDto,
  ): Promise<{ message: string }> {
    if (dto.contrasenaNueva !== dto.confirmarContrasena) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }
    const user = await this.repo.findOneOrFail({ where: { id: userId } });
    if (!user.contrasena) {
      throw new BadRequestException(
        'Este usuario no tiene contraseña configurada (usa Google)',
      );
    }
    const valid = await bcrypt.compare(dto.contrasenaActual, user.contrasena);
    if (!valid) throw new UnauthorizedException('Contraseña actual incorrecta');
    const hashed = await bcrypt.hash(dto.contrasenaNueva, 10);
    await this.repo.update(userId, { contrasena: hashed });
    return { message: 'Contraseña actualizada' };
  }

  async updatePreferencias(
    userId: string,
    dto: UpdatePreferenciasDto,
  ): Promise<UsuarioPreferencias> {
    const user = await this.repo.findOneOrFail({ where: { id: userId } });
    const merged = mergeUsuarioPreferencias(user.preferencias, dto);
    await this.repo.update(userId, { preferencias: merged });
    return merged;
  }
}
