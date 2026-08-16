import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from './usuario.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Usuario)
    private readonly repo: Repository<Usuario>,
  ) {}

  /**
   * Case-insensitive a propósito. Es la búsqueda que usan el login, el chequeo
   * de duplicado del registro y el vínculo con Google, y la unique de Postgres
   * sobre `correo` **sí** distingue mayúsculas: comparando exacto, una cuenta
   * dada de alta como `Juan.Perez@x.cl` no entraba tipeando `juan.perez@x.cl`
   * —y no hay reset de contraseña— mientras el registro público dejaba crear
   * las dos como personas distintas.
   *
   * El QueryBuilder mantiene el filtro de soft delete que aplicaba `findOne`.
   */
  findByEmail(email: string): Promise<Usuario | null> {
    return this.repo
      .createQueryBuilder('u')
      .where('LOWER(u.correo) = LOWER(:email)', { email })
      .getOne();
  }

  findById(id: string): Promise<Usuario | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByGoogleId(googleId: string): Promise<Usuario | null> {
    return this.repo.findOne({ where: { googleId } });
  }

  /**
   * `interno` va aparte del DTO **a propósito**: `correo_verificado_el` decide
   * si una cuenta puede entrar, así que no puede vivir en un objeto que
   * `class-validator` puebla desde un body. Hoy `CreateUserDto` no está atado a
   * ninguna ruta y `whitelist: true` limpiaría el campo de todos modos, pero
   * las dos cosas son ciertas *hoy*: el día que alguien exponga este DTO, un
   * `correoVerificadoEl` en el body sería auto-verificarse. Separado, no hay
   * ese día.
   */
  create(
    dto: CreateUserDto,
    interno?: { correoVerificadoEl?: Date },
  ): Promise<Usuario> {
    const user = this.repo.create({ ...dto, ...interno });
    return this.repo.save(user);
  }

  // `linkGoogleId` se borró el 2026-08-15 con su único llamador. Era el
  // mecanismo del agujero que se cerró ese día —atar un `googleId` a una cuenta
  // local porque el correo coincidía— y dejarlo vivo sin llamadores era dejar el
  // gatillo cargado para el próximo que buscara "cómo vinculo un googleId".
  // Vincular Google a una cuenta existente es una acción deliberada desde
  // adentro de la sesión, y ese método todavía no existe.
}
