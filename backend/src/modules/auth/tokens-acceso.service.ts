import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, type EntityManager } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { TipoTokenAcceso, TokenAcceso } from './entities/token-acceso.entity';

/** Invitación: la dispara un admin y la persona puede tardar en ver el mail. */
const VIGENCIA_INVITACION_DIAS = 7;
/** Reset: lo dispara cualquiera que sepa un correo, así que la ventana es corta. */
const VIGENCIA_RESET_HORAS = 1;

@Injectable()
export class TokensAccesoService {
  constructor(
    @InjectRepository(TokenAcceso)
    private readonly repo: Repository<TokenAcceso>,
  ) {}

  /**
   * SHA-256 en hex. Determinista **a propósito**: es lo que permite validar un
   * token con una búsqueda por índice en vez de recorrer los vivos comparando.
   * Ver el docblock de la entidad para por qué acá no va bcrypt.
   */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Emite un token y devuelve el **claro**, que es la única vez que existe: en
   * la base solo queda el hash.
   *
   * `manager` opcional para poder emitirlo dentro de la transacción que crea la
   * cuenta: si el alta falla, la invitación no puede quedar viva apuntando a un
   * usuario que no existe.
   */
  async emitir(
    usuarioId: string,
    tipo: TipoTokenAcceso,
    manager?: EntityManager,
  ): Promise<string> {
    // 32 bytes = 256 bits de entropía. `base64url` para que entre en una URL
    // sin escapar nada.
    const token = randomBytes(32).toString('base64url');
    const expiraEl = new Date();
    if (tipo === TipoTokenAcceso.INVITACION) {
      expiraEl.setDate(expiraEl.getDate() + VIGENCIA_INVITACION_DIAS);
    } else {
      expiraEl.setHours(expiraEl.getHours() + VIGENCIA_RESET_HORAS);
    }

    const fila = { tokenHash: this.hash(token), tipo, usuarioId, expiraEl };
    if (manager) {
      await manager.save(TokenAcceso, manager.create(TokenAcceso, fila));
    } else {
      await this.repo.save(this.repo.create(fila));
    }
    return token;
  }

  /**
   * Devuelve el token vivo, o `null` si no existe, ya se usó o venció.
   *
   * **No lo quema**: lo usa la pantalla para decidir si muestra el formulario o
   * un "este link venció". Quemarlo acá haría que abrir el link dos veces —o un
   * prefetch del navegador— inutilizara la invitación antes de que la persona
   * escriba nada.
   */
  async buscarVigente(
    token: string,
    tipo: TipoTokenAcceso,
  ): Promise<TokenAcceso | null> {
    const fila = await this.repo.findOne({
      where: { tokenHash: this.hash(token), tipo, usadoEl: IsNull() },
    });
    if (!fila || fila.expiraEl <= new Date()) return null;
    return fila;
  }

  /**
   * Quema el token: **condicionado a que siga sin usar**, no un `save()` sobre
   * la fila leída. Dos requests simultáneos con el mismo link leerían los dos
   * un token vigente; el `UPDATE ... WHERE usado_el IS NULL` deja que solo uno
   * afecte una fila, y el otro se entera. Sin eso, un doble submit fijaría la
   * contraseña dos veces y el "un solo uso" sería decorativo.
   */
  async quemar(id: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(TokenAcceso) : this.repo;
    const res = await repo
      .createQueryBuilder()
      .update(TokenAcceso)
      .set({ usadoEl: () => 'NOW()' })
      .where('token_id = :id AND usado_el IS NULL AND eliminado_el IS NULL', {
        id,
      })
      .execute();
    if (!res.affected) {
      throw new BadRequestException('Ese link ya fue usado');
    }
  }

  /**
   * Da de baja **todos** los tokens vivos de un usuario, de cualquier tipo.
   *
   * ⚠️ Se llama al fijar una contraseña, y es una condición de seguridad, no
   * higiene. Sin esto, el link de invitación —que vive 7 días y queda en la
   * casilla— **sobrevive al reset**: alguien que tenga ese primer mail puede
   * usarlo después, fijar otra contraseña y entrar. Matar los refresh tokens
   * del intruso, como hace `elegirContrasena`, no alcanza si se le deja una
   * llave de reentrada.
   */
  async invalidarTodos(
    usuarioId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(TokenAcceso) : this.repo;
    await repo
      .createQueryBuilder()
      .update(TokenAcceso)
      .set({ usadoEl: () => 'NOW()' })
      .where(
        'usuario_id = :usuarioId AND usado_el IS NULL AND eliminado_el IS NULL',
        { usuarioId },
      )
      .execute();
  }

  /**
   * Da de baja los tokens vivos del mismo tipo de un usuario. Se llama antes de
   * emitir uno nuevo: pedir el reset dos veces tiene que dejar **un** link
   * válido, el último, y no una colección de links vivos repartidos por la
   * casilla.
   */
  async invalidarAnteriores(
    usuarioId: string,
    tipo: TipoTokenAcceso,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(TokenAcceso) : this.repo;
    await repo
      .createQueryBuilder()
      .update(TokenAcceso)
      .set({ usadoEl: () => 'NOW()' })
      .where(
        'usuario_id = :usuarioId AND tipo = :tipo AND usado_el IS NULL AND eliminado_el IS NULL',
        { usuarioId, tipo },
      )
      .execute();
  }
}
