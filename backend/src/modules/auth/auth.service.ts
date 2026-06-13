import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { User } from '../users/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.password) return null;
    const valid = await bcrypt.compare(password, user.password);
    return valid ? user : null;
  }

  async register(dto: RegisterDto): Promise<{ access_token: string; user: User }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('El email ya está registrado');
    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.create({ ...dto, password: hashed });
    return { access_token: this.generateToken(user), user };
  }

  login(user: User): { access_token: string; user: User } {
    return { access_token: this.generateToken(user), user };
  }

  async googleLogin(profile: {
    googleId: string;
    name: string;
    email: string;
  }): Promise<User> {
    let user = await this.usersService.findByGoogleId(profile.googleId);
    if (!user) {
      user = await this.usersService.findByEmail(profile.email);
      if (user) {
        user = await this.usersService.linkGoogleId(user.id, profile.googleId);
      } else {
        user = await this.usersService.create({
          googleId: profile.googleId,
          name: profile.name,
          email: profile.email,
        });
      }
    }
    return user;
  }

  generateToken(user: User): string {
    return this.jwtService.sign({ sub: user.id, email: user.email });
  }

  async getMe(userId: string): Promise<User> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
