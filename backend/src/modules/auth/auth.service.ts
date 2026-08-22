import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, type EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Db } from '../../common/db/db.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { Usuario } from '../users/usuario.entity';
import { TipoTokenAcceso } from './entities/token-acceso.entity';
import { TokensAccesoService } from './tokens-acceso.service';
import { MailService } from '../mail/mail.service';
import { RefreshToken } from './entities/refresh-token.entity';

/** Cuerpo del mail de reset. El link lleva el token en claro, la única vez que existe. */
function mailDeReset(correo: string, token: string, base: string) {
  return {
    para: correo,
    asunto: 'Elegí una contraseña nueva',
    cuerpo:
      `Pediste recuperar el acceso a tu cuenta.\n\n` +
      `Elegí una contraseña nueva acá (el link vence en 1 hora):\n` +
      `${base}/recuperar/${token}\n\n` +
      `Si no lo pediste, ignorá este mail: tu contraseña actual sigue funcionando.`,
  };
}

/**
 * Cuánto después de rotar un refresh token se sigue considerando que quien lo
 * presenta es el perdedor de una carrera y no un atacante. Ver
 * `resolverCanjePerdido`.
 */
const GRACIA_CANJE_MS = 30_000;

/**
 * La única respuesta de `register`, y es la misma en las tres ramas. Está en
 * una constante justamente para que no pueda divergir: dos textos parecidos
 * pero distintos volverían a distinguir los casos, que es el agujero que este
 * endpoint acaba de cerrar.
 */
const MENSAJE_REGISTRO =
  'Si ese correo no tenía cuenta, te llega un link para verificarlo y entrar.';

/** Cuerpo del mail de verificación del auto-registro. */
function mailDeVerificacion(correo: string, token: string, base: string) {
  return {
    para: correo,
    asunto: 'Verificá tu correo',
    cuerpo:
      `Creaste una cuenta con esta dirección.\n\n` +
      `Confirmá que es tuya para poder entrar (el link vence en 7 días):\n` +
      `${base}/verificar/${token}\n\n` +
      `Si no fuiste vos, ignorá este mail: sin este paso la cuenta no se puede usar.`,
  };
}

/**
 * Aviso a quien YA tiene la cuenta. Es la contracara de que `register` no
 * distinga: la persona que se registra no se entera de que el correo estaba
 * tomado, así que el dueño real es quien tiene que enterarse.
 *
 * ⚠️ No lleva link ni token. No hay nada que la persona deba hacer —su cuenta
 * y su contraseña siguen intactas— y un link acá sería un objetivo de phishing
 * servido por nosotros.
 */
function mailDeIntentoDeRegistro(correo: string) {
  return {
    para: correo,
    asunto: 'Alguien intentó registrarse con tu correo',
    cuerpo:
      `Alguien quiso crear una cuenta con esta dirección, que ya tiene una.\n\n` +
      `No hicimos ningún cambio: tu cuenta y tu contraseña siguen igual.\n\n` +
      `Si fuiste vos, entrá con tu contraseña de siempre. Si no la recordás, ` +
      `usá "olvidé mi contraseña" desde la pantalla de ingreso.`,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
    private readonly db: Db,
    private readonly tokens: TokensAccesoService,
    private readonly mail: MailService,
  ) {}

  async validateUser(email: string, password: string): Promise<Usuario | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.contrasena) return null;
    const valid = await bcrypt.compare(password, user.contrasena);
    if (!valid) return null;
    // ⚠️ El corte por correo sin verificar va **después** de comprobar la
    // contraseña, no antes. Antes sería un oráculo: cualquiera podría separar
    // "ese correo no existe" de "existe pero sin verificar" probando cualquier
    // clave. Quien llega hasta acá ya demostró saber la contraseña, así que
    // decirle por qué no entra no le informa nada que no supiera.
    if (!user.correoVerificadoEl) {
      throw new UnauthorizedException(
        'Todavía no verificaste tu correo. Buscá el link que te mandamos al registrarte.',
      );
    }
    return user;
  }

  /**
   * Auto-registro público.
   *
   * ⚠️ **Responde lo mismo exista o no el correo** (decisión del owner,
   * 2026-08-15). Antes devolvía `409 "El correo ya esta registrado"` contra un
   * `201`, o sea que cualquiera podía enumerar qué direcciones tienen cuenta.
   * La asimetría era interna y llamativa: `recuperar()`, acá abajo, fue escrito
   * explícitamente para NO hacer esto, y el criterio no se había replicado.
   *
   * **No devuelve tokens, y eso es consecuencia de lo anterior, no un extra.**
   * Para responder igual en los dos casos no puede haber sesión: cuando el
   * correo ya es de otra persona no hay cuenta propia a la cual entrar.
   * Coincide con lo que la verificación de correo exige por su lado — no se
   * puede estar logueado antes de probar la dirección.
   *
   * Las tres ramas son indistinguibles desde afuera y ninguna dice cuál ocurrió:
   * 1. **Correo libre** → se crea la cuenta sin verificar y sale el link.
   * 2. **Existe, sin verificar** → se reenvía el link. Sin esto, un correo
   *    tipeado mal por su dueño le dejaría la dirección trabada para siempre:
   *    la `unique` la reserva y el token vence a los 7 días.
   * 3. **Existe y verificada** → no se toca nada y le llega un aviso de que
   *    alguien intentó registrarse con su correo.
   */
  async register(dto: RegisterDto): Promise<{ message: string }> {
    const correo = dto.correo.trim().toLowerCase();
    const existing = await this.usersService.findByEmail(correo);

    if (existing?.correoVerificadoEl) {
      await this.mail.enviar(mailDeIntentoDeRegistro(existing.correo));
      return { message: MENSAJE_REGISTRO };
    }

    let usuarioId: string;
    if (existing) {
      usuarioId = existing.id;
    } else {
      const hashed = await bcrypt.hash(dto.contrasena, 10);
      try {
        const user = await this.usersService.create({
          ...dto,
          correo,
          contrasena: hashed,
        });
        usuarioId = user.id;
      } catch (e) {
        // 23505 = unique_violation. Se llega acá por una carrera: dos registros
        // del mismo correo libre, los dos vieron `findByEmail` en null y los dos
        // insertaron. Sin traducirlo sale un **500**, y ese 500 vuelve a
        // distinguir desde afuera un correo tomado de uno libre — justo lo que
        // este endpoint dejó de hacer al responder siempre lo mismo. Mismo
        // criterio que `tenants.service.ts` → `crearUsuario`, que ya traduce el
        // suyo.
        if ((e as { code?: string }).code !== '23505') throw e;
        // ⚠️ `usuarios` tiene DOS uniques: `correo` y `nombre_usuario` — y
        // `RegisterDto` acepta los dos. Tragarse cualquier 23505 le diría
        // "revisá tu correo" a alguien cuya cuenta NO se creó, que es peor que
        // el 500. Se distingue **por conducta y no por el texto del error**:
        // los nombres de constraint son hashes de TypeORM (`UQ_1a7a36f3…`) y
        // cambian con el esquema. Si el correo ya está tomado, la carrera fue
        // por el correo.
        const ganador = await this.usersService.findByEmail(correo);
        if (!ganador) throw e;
        // Se corta acá a propósito, sin reintentar: el ganador de la carrera
        // sigue su flujo y manda el mail de verificación. Continuar emitiría un
        // segundo token y `invalidarAnteriores` le quemaría el link al ganador
        // — dos mails y un solo link válido, el peor de los dos mundos para
        // quien se está registrando.
        return { message: MENSAJE_REGISTRO };
      }
    }

    // Igual que en `recuperar`: registrarse dos veces deja UN link válido, el
    // último, y no una colección repartida por la casilla.
    await this.tokens.invalidarAnteriores(
      usuarioId,
      TipoTokenAcceso.VERIFICACION,
    );
    const token = await this.tokens.emitir(
      usuarioId,
      TipoTokenAcceso.VERIFICACION,
    );
    await this.mail.enviar(
      mailDeVerificacion(correo, token, this.frontendUrl()),
    );
    return { message: MENSAJE_REGISTRO };
  }

  /**
   * Sella `correo_verificado_el` desde el link del auto-registro y quema el
   * token, **en una transacción** — mismo criterio que `elegirContrasena`: si
   * el quemado fallara después de sellar, el link seguiría vivo.
   *
   * A diferencia de la invitación, acá NO se elige contraseña: la persona ya la
   * puso al registrarse. Lo único que faltaba era la prueba de la dirección.
   */
  async verificarCorreo(token: string): Promise<{ message: string }> {
    const fila = await this.tokens.buscarVigente(
      token,
      TipoTokenAcceso.VERIFICACION,
    );
    if (!fila) {
      throw new BadRequestException(
        'Ese link ya no sirve: puede estar vencido o ya usado. Volvé a registrarte y te mandamos uno nuevo.',
      );
    }
    await this.db.transaccion(async (manager) => {
      await this.tokens.quemar(fila.id, manager);
      const res = await manager.update(
        Usuario,
        { id: fila.usuarioId, eliminadoEl: IsNull() },
        { correoVerificadoEl: () => 'NOW()' },
      );
      if (!res.affected) {
        throw new BadRequestException('Ese link ya no sirve');
      }
    });
    return { message: 'Listo, tu correo quedó verificado. Ya podés entrar.' };
  }

  /**
   * Dice si un link sirve, **sin quemarlo**. La pantalla lo consulta al cargar
   * para mostrar "este link venció" en vez de un formulario que va a fallar
   * después de que la persona tipeó dos veces su contraseña.
   *
   * No quemarlo acá es deliberado: un prefetch del navegador o abrir el link
   * dos veces inutilizaría la invitación antes de escribir nada.
   */
  async verificarToken(
    token: string,
    tipo: TipoTokenAcceso,
  ): Promise<{ correo: string }> {
    const fila = await this.tokens.buscarVigente(token, tipo);
    if (!fila) {
      throw new BadRequestException(
        'Ese link ya no sirve: puede estar vencido o ya usado. Pedí uno nuevo.',
      );
    }
    const user = await this.usersService.findById(fila.usuarioId);
    if (!user) throw new BadRequestException('Ese link ya no sirve');
    return { correo: user.correo };
  }

  /**
   * Fija la contraseña desde un link y lo quema, **en una transacción**: si el
   * quemado fallara después de guardar el hash, el link seguiría vivo y
   * serviría de nuevo.
   *
   * Se quema PRIMERO. `quemar()` corta con un `UPDATE ... WHERE usado_el IS
   * NULL`, así que de dos requests simultáneos con el mismo link solo uno
   * sigue; el otro revienta antes de tocar la contraseña.
   */
  async elegirContrasena(
    token: string,
    tipo: TipoTokenAcceso,
    contrasena: string,
  ): Promise<{ message: string }> {
    const fila = await this.tokens.buscarVigente(token, tipo);
    if (!fila) {
      throw new BadRequestException(
        'Ese link ya no sirve: puede estar vencido o ya usado. Pedí uno nuevo.',
      );
    }
    const hashed = await bcrypt.hash(contrasena, 10);
    await this.db.transaccion(async (manager) => {
      await this.tokens.quemar(fila.id, manager);
      // Y se matan TODOS los links vivos de esa cuenta, no solo el usado. Un
      // link de invitación vive 7 días: sin esto sobrevive al reset y quien
      // tenga ese mail puede volver a fijar la contraseña y entrar. La cuenta
      // ya tiene dueño; cualquier link pendiente es una llave de reentrada.
      await this.tokens.invalidarTodos(fila.usuarioId, manager);
      // Con `eliminadoEl IS NULL` en el criterio: sin eso, este camino escribe
      // sobre una fila borrada. El `GET` hermano sí filtra (usa `findById`), y
      // la incoherencia entre los dos se ve desde afuera.
      // Se sella el correo de paso: haber abierto este link **es** la prueba
      // de que la dirección existe y de que la persona la lee. Vale para los
      // dos tipos — invitación y reset—, y cubre el caso de quien se
      // auto-registró, nunca verificó, y llegó acá por "olvidé mi contraseña".
      const res = await manager.update(
        Usuario,
        { id: fila.usuarioId, eliminadoEl: IsNull() },
        { contrasena: hashed, correoVerificadoEl: () => 'NOW()' },
      );
      if (!res.affected) {
        throw new BadRequestException('Ese link ya no sirve');
      }
    });
    // Se cierran las sesiones vivas: si el reset lo pidió alguien porque le
    // tomaron la cuenta, dejar los refresh tokens del intruso vivos vaciaría
    // el sentido del reset.
    // Mismo criterio que `switchTenant`: se van las vivas, las lápidas quedan.
    await this.refreshRepo.delete({
      userId: fila.usuarioId,
      usadoEl: IsNull(),
    });
    return { message: 'Contraseña actualizada' };
  }

  /**
   * Pide un reset.
   *
   * ⚠️ **Responde lo mismo exista o no el correo.** Si distinguiera, este
   * endpoint —público y sin autenticación— sería un oráculo para averiguar qué
   * direcciones tienen cuenta, o sea para enumerar la base de usuarios.
   */
  async recuperar(correo: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(correo);
    if (user) {
      // Pedirlo dos veces deja UN link válido, el último: si no, quedan varios
      // vivos repartidos por la casilla y cualquiera de ellos sirve.
      await this.tokens.invalidarAnteriores(user.id, TipoTokenAcceso.RESET);
      const token = await this.tokens.emitir(user.id, TipoTokenAcceso.RESET);
      await this.mail.enviar(
        mailDeReset(user.correo, token, this.frontendUrl()),
      );
    }
    return {
      message:
        'Si ese correo tiene una cuenta, te llega un link para elegir una contraseña nueva.',
    };
  }

  /**
   * Base del link que va en los mails. Por `ConfigService` y no `process.env`:
   * la clase ya lo inyecta para todo lo demás, y `process.env` no se puede
   * mockear en un test.
   */
  private frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
  }

  async login(
    user: Usuario,
  ): Promise<{ access_token: string; refresh_token: string; user: Usuario }> {
    const { access_token, refresh_token } = await this.generateTokens(user);
    return { access_token, refresh_token, user };
  }

  /**
   * Login con Google.
   *
   * ⚠️ **"El correo coincide" no vincula** (decisión del owner, 2026-08-15,
   * mismo criterio que el alta de usuarios). Antes, no encontrar el `googleId`
   * hacía buscar por correo y **atar el `googleId` a esa cuenta local** sin
   * probar que la dirección fuera de quien estaba entrando. Con el registro
   * público sin verificar, eso era una vía directa a la cuenta de otro.
   *
   * Ahora la colisión se rechaza y se manda a la persona a entrar con su
   * contraseña. Vincular Google a una cuenta que ya existe es una acción
   * deliberada desde adentro de la sesión — no existe todavía, y no se inventa
   * acá: hacerla implícita en el login es exactamente el agujero.
   *
   * ⚠️ **Y se lee `email_verified`**, que `passport-google-oauth20` ya exponía
   * y no se estaba mirando. Sin eso, un proveedor de Google Workspace mal
   * configurado —o una cuenta con un alias sin probar— alcanzaba para crear una
   * cuenta a nombre de cualquier dirección.
   */
  async googleLogin(profile: {
    googleId: string;
    name: string;
    email: string;
    emailVerificado: boolean;
  }): Promise<Usuario> {
    let user = await this.usersService.findByGoogleId(profile.googleId);
    if (!user) {
      if (!profile.emailVerificado) {
        throw new UnauthorizedException(
          'Google no confirma que ese correo sea tuyo, así que no podemos crear la cuenta.',
        );
      }
      if (await this.usersService.findByEmail(profile.email)) {
        throw new ConflictException(
          'Ya existe una cuenta con ese correo. Entrá con tu contraseña.',
        );
      }
      user = await this.usersService.create(
        {
          googleId: profile.googleId,
          nombre: profile.name.split(' ')[0] || profile.name,
          apellido: profile.name.split(' ').slice(1).join(' ') || undefined,
          correo: profile.email,
          contrasena: undefined,
          nombreUsuario: profile.email.split('@')[0],
          telefono: undefined,
        },
        // Google ya probó la dirección (se acaba de exigir `email_verified`
        // arriba), así que pedir un segundo link sería pedir dos veces lo
        // mismo.
        { correoVerificadoEl: new Date() },
      );
    }
    return user;
  }

  async generateTokens(
    user: Usuario,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const access_token = this.generateAccessToken(user);
    const refresh_token = await this.createRefreshToken(user.id, null);
    return { access_token, refresh_token };
  }

  generateAccessToken(user: Usuario, tenantId: string | null = null): string {
    return this.jwtService.sign({
      sub: user.id,
      email: user.correo,
      tenant_id: tenantId,
      es_superadmin: user.esSuperadmin,
    });
  }

  /**
   * Canjea un refresh token por uno nuevo. **Un solo ganador, y el reuso corta
   * la sesión.**
   *
   * El canje es la primera sentencia y es la que decide: el
   * `WHERE usado_el IS NULL` hace que de dos requests simultáneos con la misma
   * cookie sólo uno afecte una fila. Antes eran `findOne` + `delete` sin mirar
   * `affected`, así que **los dos podían ganar** — y el disparador no es
   * teórico: el frontend serializa el refresh por pestaña (`useApiFetch.ts`),
   * pero no entre pestañas, y dos tabs despertando de standby alcanzan.
   *
   * Si no afectó nada, la fila puede seguir existiendo —marcada— y eso **puede**
   * ser la señal clásica de una sesión copiada… o la carrera de dos pestañas.
   * Separarlas es todo el trabajo de `resolverCanjePerdido`.
   *
   * ⚠️ **Ningún camino de esta función puede desloguear a alguien legítimo.**
   * Es el error que el primer intento cometió: hacer la carrera determinista no
   * la elimina, sólo elige un perdedor, y ese perdedor era indistinguible de un
   * atacante.
   */
  async refresh(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    // ⚠️ **Marcar + insertar + apuntar van en UNA transacción, y el orden no es
    // estilo: es lo único que hace que la ventana de gracia sirva.**
    //
    // El `UPDATE` del perdedor queda esperando el lock de esta misma fila. Si
    // el ganador corriera en autocommit, ese lock se soltaría en el `UPDATE`
    // —o sea al PRINCIPIO— y el perdedor leería `reemplazado_por` tres viajes
    // antes de que se escriba: encontraría `NULL`, caería en "sin reemplazo
    // utilizable" y se comería un 401. Medido contra el stack real: pasaba **7
    // de cada 8 veces**, así que el camino feliz de la gracia era el
    // excepcional. Dentro de la transacción el lock se suelta recién en el
    // commit, y para entonces el puntero ya está.
    const rotado = await this.db.transaccion(async (manager) => {
      const canje = await manager
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ usadoEl: () => 'NOW()' })
        .where('token = :token AND usado_el IS NULL', { token: refreshToken })
        .returning(['id', 'userId', 'activeTenantId', 'expiresAt'])
        .execute();

      const fila = (
        canje.raw as {
          id: string;
          user_id: string;
          active_tenant_id: string | null;
          expires_at: Date;
        }[]
      )[0];

      if (!fila) return null;

      if (new Date(fila.expires_at) < new Date()) {
        throw new UnauthorizedException('Refresh token expirado');
      }

      const nueva = await this.insertarFilaRefresh(
        manager,
        fila.user_id,
        fila.active_tenant_id,
      );
      await manager.update(RefreshToken, fila.id, {
        reemplazadoPor: nueva.id,
      });

      return {
        refresh_token: nueva.token,
        userId: fila.user_id,
        activeTenantId: fila.active_tenant_id,
      };
    });

    if (!rotado) return this.resolverCanjePerdido(refreshToken);

    // ⛔ **Adentro de la transacción NO puede ir nada que use el repositorio
    // inyectado en vez del `manager`.** `usersService.findById` estuvo un rato
    // ahí adentro y deadlockeaba el pool: pedía una SEGUNDA conexión mientras
    // retenía la primera con la transacción abierta y el lock de la fila
    // tomado. Con ~10 refresh en vuelo el pool (10 por default) se agota, los
    // ganadores quedan `idle in transaction` esperando una conexión que sólo
    // otro de ellos podría soltar, y **la API entera muere hasta reiniciar el
    // contenedor**. Postgres no lo aborta porque el ciclo no es de locks de
    // base, es del pool: `deadlock_timeout` nunca dispara.
    //
    // Nada de esto necesita ser atómico con la rotación —el usuario sólo se usa
    // para firmar el access token—, así que va después del commit.
    // La poda también va afuera de la transacción: es higiene y no tiene por
    // qué alargar el lock que el perdedor de la carrera está esperando. Y va
    // **antes** del `throw` de abajo: si fuera después, el camino del usuario
    // borrado se la saltearía, y como para esa cuenta no va a haber otro
    // refresh exitoso nunca, esas filas no las limpiaría nadie.
    await this.podarVencidos(rotado.userId);

    const user = await this.usersService.findById(rotado.userId);
    if (!user) throw new UnauthorizedException('Refresh token inválido');

    return {
      access_token: this.generateAccessToken(user, rotado.activeTenantId),
      refresh_token: rotado.refresh_token,
    };
  }

  /**
   * El canje no afectó ninguna fila. Cuatro razones posibles, y **sólo una es un
   * ataque**:
   *
   * 1. **No existe** — token inventado, o de una sesión cerrada cuya fila borró
   *    el `logout`. 401 y nada más.
   * 2. **Vencida** — la sesión ya está muerta sola. 401 sin revocar.
   * 3. **Rotada hace un instante y con reemplazo vivo** — la carrera de dos
   *    pestañas, o un reintento de red. Se le devuelve **el mismo token que ganó
   *    el otro**: las dos siguen andando y nadie se entera.
   * 4. **Rotada hace rato** — ya no hay carrera que explicar. Eso sí es la firma
   *    de una sesión copiada, y corta todo.
   *
   * La ventana existe porque el caso 3 y el 4 son el **mismo hecho** visto a
   * distinta distancia temporal: no hay forma de distinguirlos por otra vía, así
   * que se elige un umbral y se documenta. 30 segundos cubre de sobra dos tabs
   * despertando juntas y un reintento de red, y deja la ventana de utilidad de
   * un token robado en prácticamente nada.
   */
  private async resolverCanjePerdido(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const previa = await this.refreshRepo.findOne({
      where: { token: refreshToken },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usadoEl: true,
        reemplazadoPor: true,
      },
    });
    // Casos 1 y 2.
    if (!previa || previa.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    const dentroDeGracia =
      previa.usadoEl !== null &&
      Date.now() - previa.usadoEl.getTime() <= GRACIA_CANJE_MS;

    if (dentroDeGracia && previa.reemplazadoPor) {
      const reemplazo = await this.refreshRepo.findOne({
        where: { id: previa.reemplazadoPor, usadoEl: IsNull() },
      });
      // El reemplazo tiene que seguir vigente: si ya se rotó a su vez, devolver
      // un token quemado sería peor que el 401. La sesión avanzó sin esta
      // pestaña y no hay nada útil que darle.
      if (reemplazo && reemplazo.expiresAt > new Date()) {
        const user = await this.usersService.findById(reemplazo.userId);
        if (user) {
          // Caso 3. Ni `warn` ni revocación: no pasó nada anormal.
          return {
            access_token: this.generateAccessToken(
              user,
              reemplazo.activeTenantId,
            ),
            refresh_token: reemplazo.token,
          };
        }
      }
    }

    // Dentro de la gracia pero sin reemplazo utilizable: no se pudo ayudar, pero
    // **tampoco se revoca**. Una revocación acá volvería a castigar la carrera,
    // que es justo lo que esta función existe para no hacer.
    if (dentroDeGracia) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    // Caso 4: el único que revoca.
    this.logger.warn(
      `Reuso de refresh token rotado hace más de ${GRACIA_CANJE_MS}ms (usuario ${previa.userId}): se revocan todas sus sesiones.`,
    );
    await this.refreshRepo.delete({ userId: previa.userId });
    throw new UnauthorizedException('Refresh token inválido');
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshRepo.delete({ token: refreshToken });
  }

  async getMe(userId: string): Promise<Usuario> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    return user;
  }

  async getMyTenants(
    userId: string,
  ): Promise<{ tenantId: string; nombre: string }[]> {
    return this.db.query<{ tenantId: string; nombre: string }[]>(
      `SELECT t.tenant_id as "tenantId", t.nombre
       FROM usuarios_tenants ut
       JOIN tenants t ON t.tenant_id = ut.tenant_id
       WHERE ut.usuario_id = $1
         AND ut.eliminado_el IS NULL
         AND t.eliminado_el IS NULL`,
      [userId],
    );
  }

  /**
   * ⚠️ **Exige el refresh token además del access token** (decisión del owner,
   * 2026-08-15). Esta ruta emite un `refresh_token` nuevo, o sea que convierte
   * cualquier access token filtrado —historial del navegador, log del hosting,
   * XSS— en una **sesión renovable**: 15 minutos de filtración se volvían
   * acceso indefinido. Con `JwtAuthGuard` solo, el access token bastaba.
   *
   * Pedir también la cookie no cambia nada para quien opera de verdad: el
   * navegador la manda en toda llamada, y el frontend ya usa `credentials`.
   * Lo que cierra es el camino de quien tiene **sólo** el access token.
   *
   * ℹ️ Sigue revocando **todos** los refresh del usuario, o sea que cambiar de
   * tenant desloguea los otros dispositivos, incluidos los de otros tenants.
   * Lo que la hacía peligrosa era que un token filtrado pudiera dispararla, y
   * eso es justamente lo que el párrafo de arriba cierra.
   *
   * ✅ **Y eso ya no es "conducta heredada que no se toca acá"** (que es lo que
   * decía este docblock hasta el 2026-08-22): el owner decidió que **la sesión
   * es de la cuenta, no del tenant** y descartó las sesiones paralelas por
   * tenant — regla escrita en `docs/PRODUCTO.md` §2. Acotar la revocación al
   * tenant activo **sería posible** (`refresh_tokens.active_tenant_id` sabe de
   * cuál era cada sesión); no se hace a propósito. Salió de la auditoría del
   * 2026-08-22 como pregunta de producto, no como bug: nadie ajeno puede
   * disparar esto, solo la propia persona sobre su cuenta.
   */
  async switchTenant(
    userId: string,
    tenantId: string,
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    // La cookie tiene que ser una sesión viva DE ESTE usuario: sin el
    // `userId`, un refresh token cualquiera —el de otra cuenta— serviría de
    // segundo factor para el access token robado.
    const sesion = await this.refreshRepo.findOne({
      where: { token: refreshToken, userId, usadoEl: IsNull() },
      select: { id: true, expiresAt: true },
    });
    if (!sesion || sesion.expiresAt < new Date()) {
      throw new UnauthorizedException('Sesión inválida');
    }

    // El JOIN a `tenants` con su `eliminado_el IS NULL` es lo que iguala este
    // método con su hermano `getMyTenants`, que ya lo hacía. Sin él, un tenant
    // soft-borrado por el superadmin con una membresía viva devolvía **200 y un
    // token** para un tenant muerto: el daño quedaba acotado porque
    // `TenantGuard` corta en la ruta siguiente, pero prometía algo que no
    // existe, y el usuario se enteraba un request más tarde y con otro error.
    // Ojo con el alias: acá `eliminado_el` a secas era de `usuarios_tenants`.
    const rows = await this.db.query<unknown[]>(
      `SELECT 1 FROM usuarios_tenants ut
       JOIN tenants t ON t.tenant_id = ut.tenant_id AND t.eliminado_el IS NULL
       WHERE ut.usuario_id = $1
         AND ut.tenant_id = $2
         AND ut.eliminado_el IS NULL`,
      [userId, tenantId],
    );
    if (rows.length === 0)
      throw new ForbiddenException('No perteneces a este tenant');
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    // Revocar los refresh tokens VIVOS del usuario. `usadoEl: IsNull()` no es
    // cosmético: sin él este borrado se llevaba también las **lápidas**, y la
    // detección de reuso quedaba apagada después de cada cambio de tenant —un
    // token robado y ya rotado caía en "no existe" y devolvía un 401 genérico
    // en vez de cortar la sesión. Se borran y no se marcan porque esto es una
    // revocación deliberada, no una rotación: marcarlas haría que el otro
    // dispositivo del usuario, al refrescar, disparara un `warn` de reuso que
    // no describe nada.
    await this.refreshRepo.delete({ userId, usadoEl: IsNull() });
    const access_token = this.generateAccessToken(user, tenantId);
    const refresh_token = await this.createRefreshToken(userId, tenantId);
    return { access_token, refresh_token };
  }

  private async createRefreshToken(
    userId: string,
    activeTenantId: string | null = null,
  ): Promise<string> {
    return (await this.crearFilaRefresh(userId, activeTenantId)).token;
  }

  /**
   * Igual que `createRefreshToken` pero devolviendo también el `id` de la fila,
   * que es lo que `refresh` necesita para dejar el puntero `reemplazado_por`.
   */
  private async crearFilaRefresh(
    userId: string,
    activeTenantId: string | null = null,
  ): Promise<{ id: string; token: string }> {
    await this.podarVencidos(userId);
    return this.insertarFilaRefresh(
      this.refreshRepo.manager,
      userId,
      activeTenantId,
    );
  }

  /**
   * Inserta la fila y nada más. Existe separada de `crearFilaRefresh` para que
   * `refresh` pueda hacerla **dentro de su transacción** sin arrastrar la poda
   * adentro del lock que el perdedor de la carrera está esperando.
   */
  private async insertarFilaRefresh(
    manager: EntityManager,
    userId: string,
    activeTenantId: string | null,
  ): Promise<{ id: string; token: string }> {
    const token = randomUUID();
    const expiresAt = new Date(
      Date.now() +
        this.parseExpiration(
          this.config.get<string>('JWT_REFRESH_EXPIRATION') ?? '1h',
        ),
    );
    const fila = await manager.save(RefreshToken, {
      token,
      userId,
      expiresAt,
      activeTenantId,
    });
    return { id: fila.id, token };
  }

  /**
   * Las lápidas se acumulan (una por rotación), y una vencida ya no distingue
   * nada porque el reuso de un token vencido no revoca. Se limpian las de ESTE
   * usuario, no las de todos: el borrado queda acotado a las filas que el
   * request ya está tocando, sin barrer la tabla entera.
   */
  private async podarVencidos(userId: string): Promise<void> {
    await this.refreshRepo
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('user_id = :userId AND expires_at < NOW()', { userId })
      .execute();
  }

  private parseExpiration(expiration: string): number {
    const match = expiration.match(/^(\d+)([smhd])$/);
    if (!match) return 3_600_000;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return value * multipliers[unit];
  }
}
