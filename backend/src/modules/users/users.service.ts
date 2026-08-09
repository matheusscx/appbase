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

  create(dto: CreateUserDto): Promise<Usuario> {
    const user = this.repo.create(dto);
    return this.repo.save(user);
  }

  async linkGoogleId(userId: string, googleId: string): Promise<Usuario> {
    await this.repo.update(userId, { googleId });
    return this.repo.findOneOrFail({ where: { id: userId } });
  }
}
