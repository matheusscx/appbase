import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Usuario } from '../users/usuario.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
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
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
  ) {}

  async updatePerfil(userId: string, dto: UpdatePerfilDto): Promise<Usuario> {
    await this.repo.update(userId, dto);
    return this.repo.findOneOrFail({ where: { id: userId } });
  }

  /**
   * Cambiar la contraseña **cierra todas las sesiones vivas**, incluida la de
   * quien la cambia. Sin esto, alguien que se dio cuenta de que le tomaron la
   * cuenta y entra a cambiar su contraseña deja al intruso adentro: su refresh
   * token sigue vivo y lo puede renovar indefinidamente. Es exactamente lo que
   * la persona creyó estar cortando.
   *
   * Misma decisión que su flujo hermano `AuthService.elegirContrasena` (el
   * reset por link), que ya borra los refresh tokens por el mismo motivo.
   *
   * **Por qué también cae la sesión propia.** "Todos menos el mío" ES
   * representable: la cookie `refresh_token` viaja en cada request al mismo
   * origen —`AuthController` ya la lee en `/auth/refresh` y `/auth/logout`—,
   * así que un `WHERE user_id = $1 AND token <> $2` habría preservado esta
   * pestaña. Se eligió no hacerlo, y la razón es simplicidad y robustez, no
   * una imposibilidad: el borrado total no depende de que la cookie llegue
   * intacta, y ante la duda de si echar al intruso, echa a todos. El costo es
   * que quien cambia su contraseña vuelve a entrar.
   *
   * (La comparación con `elegirContrasena` no alcanza para justificarlo: ese
   * flujo es **no autenticado** y no tiene la cookie propia disponible del
   * mismo modo, así que ahí el borrado total es la única opción, no una
   * elección.)
   *
   * El front lo hace explícito: avisa y desloguea en el momento, en vez de
   * dejar que la sesión muera sola cuando venza el access token.
   */
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
    await this.refreshRepo.delete({ userId });
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
