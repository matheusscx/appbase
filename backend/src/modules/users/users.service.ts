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

  findByEmail(email: string): Promise<Usuario | null> {
    return this.repo.findOne({ where: { correo: email } });
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
