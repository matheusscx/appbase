import { Test, type TestingModule } from '@nestjs/testing';
import { TokensAccesoService } from './tokens-acceso.service';
import { MailService } from '../mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { IsNull } from 'typeorm';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { type Usuario } from '../users/usuario.entity';

const mockUser: Usuario = {
  id: 'user-uuid',
  nombre: 'Test',
  apellido: 'User',
  correo: 'test@example.com',
  contrasena: null,
  nombreUsuario: null,
  telefono: null,
  googleId: null,
  esSuperadmin: false,
  preferencias: {},
  correoVerificadoEl: new Date(),
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null,
};

describe('AuthService', () => {
  let service: AuthService;
  let refreshRepo: {
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
    /** `crearFilaRefresh` inserta por el manager del repo. */
    manager: Record<string, unknown>;
  };
  let ejecutarQb: jest.Mock;
  let managerTx: {
    createQueryBuilder: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let usersService: { findById: jest.Mock; [k: string]: jest.Mock };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(),
    };
    // `refresh` y la poda de `createRefreshToken` usan el query builder. El
    // mock es encadenable y `execute` resuelve por llamada, así que un test
    // puede fijar el resultado del canje con `mockResolvedValueOnce` y dejar
    // que la poda —que corre después— caiga en el default.
    ejecutarQb = jest.fn().mockResolvedValue({ raw: [], affected: 0 });
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['update', 'set', 'where', 'returning', 'delete', 'from']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.execute = ejecutarQb;
    refreshRepo = {
      save: jest.fn().mockResolvedValue({ id: 'rt-nueva' }),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qb),
      manager: {},
    };
    // `crearFilaRefresh` inserta por `repo.manager`; se apunta al mismo mock
    // para que las aserciones sobre `refreshRepo.save` sigan valiendo.
    refreshRepo.manager = { save: refreshRepo.save };
    // El manager de la transacción de `refresh`. Marcar + insertar + apuntar
    // corren acá adentro, y eso **no es un detalle de implementación**: es lo
    // que hace que el perdedor de la carrera lea el puntero ya escrito en vez
    // de un `NULL`. Ver el ⚠️ de `AuthService.refresh`.
    managerTx = {
      createQueryBuilder: jest.fn(() => qb),
      save: jest.fn().mockResolvedValue({ id: 'rt-nueva' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
      cb(managerTx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: TokensAccesoService,
          useValue: {
            emitir: jest.fn().mockResolvedValue('tok'),
            buscarVigente: jest.fn(),
            quemar: jest.fn(),
            invalidarAnteriores: jest.fn(),
            invalidarTodos: jest.fn(),
          },
        },
        // Mockeado: un unit no manda mail.
        { provide: MailService, useValue: { enviar: jest.fn() } },
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock.access.token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                JWT_REFRESH_EXPIRATION: '1h',
              };
              return map[key];
            }),
          },
        },
        {
          provide: UsersService,
          useValue: (usersService = {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            findByGoogleId: jest.fn(),
          }),
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshRepo,
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('generateTokens', () => {
    it('saves a new refresh token to DB and returns both tokens', async () => {
      const result = await service.generateTokens(mockUser);

      expect(result.access_token).toBe('mock.access.token');
      expect(result.refresh_token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(refreshRepo.save).toHaveBeenCalledWith(
        RefreshToken,
        expect.objectContaining({ userId: 'user-uuid' }),
      );
    });
  });

  describe('refresh', () => {
    /** Lo que devuelve el `UPDATE ... RETURNING` cuando el canje gana. */
    const canjeGanado = (expiresAt: Date) => ({
      raw: [
        {
          id: 'rt-id',
          user_id: 'user-uuid',
          active_tenant_id: null,
          expires_at: expiresAt,
        },
      ],
    });

    it('reclama el token con un UPDATE condicionado, no con findOne + delete', async () => {
      // El corazón del canje atómico: `usado_el IS NULL` en el WHERE es lo que
      // hace que de dos requests simultáneos con la misma cookie sólo uno
      // afecte una fila. Con el `findOne` + `delete` anterior **los dos podían
      // ganar**, y el disparador es real: el frontend serializa el refresh por
      // pestaña, no entre pestañas.
      ejecutarQb.mockResolvedValueOnce(
        canjeGanado(new Date(Date.now() + 3_600_000)),
      );
      usersService.findById.mockResolvedValue(mockUser);

      await service.refresh('valid-token');

      // Y sale del manager de la transacción, no del repo suelto.
      expect(managerTx.createQueryBuilder).toHaveBeenCalled();
      const qb = managerTx.createQueryBuilder.mock.results[0].value as Record<
        string,
        jest.Mock
      >;
      const [condicion] = qb.where.mock.calls[0] as [string, unknown];
      expect(condicion).toContain('usado_el IS NULL');
      // Y NO se borra la fila: la lápida es lo que después distingue el reuso.
      expect(refreshRepo.delete).not.toHaveBeenCalled();
    });

    it('rota y devuelve un access token nuevo cuando el canje gana', async () => {
      ejecutarQb.mockResolvedValueOnce(
        canjeGanado(new Date(Date.now() + 3_600_000)),
      );
      usersService.findById.mockResolvedValue(mockUser);

      const result = await service.refresh('valid-token');

      expect(result.access_token).toBe('mock.access.token');
      expect(result.refresh_token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(managerTx.save).toHaveBeenCalled();
    });

    it('un token inexistente es 401 y NO revoca nada', async () => {
      ejecutarQb.mockResolvedValueOnce({ raw: [] });
      refreshRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshRepo.delete).not.toHaveBeenCalled();
    });

    it('un token rotado hace RATO corta todas las sesiones', async () => {
      // La razón de ser de la lápida, y el único caso que revoca: pasada la
      // ventana ya no hay carrera que explicar, y presentar un token rotado es
      // la señal clásica de que alguien copió la sesión.
      ejecutarQb.mockResolvedValueOnce({ raw: [] });
      refreshRepo.findOne.mockResolvedValue({
        id: 'rt-id',
        userId: 'user-uuid',
        expiresAt: new Date(Date.now() + 3_600_000),
        usadoEl: new Date(Date.now() - 60_000),
        reemplazadoPor: 'rt-nueva',
      });

      await expect(service.refresh('token-rotado')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshRepo.delete).toHaveBeenCalledWith({ userId: 'user-uuid' });
    });

    it('DOS PESTAÑAS: al perdedor de la carrera se le devuelve el token del ganador', async () => {
      // El falso positivo que la primera versión introducía y que este bloque
      // existe para impedir. Las dos tabs comparten la cookie del navegador y el
      // frontend serializa el refresh POR PESTAÑA, así que dos tabs despertando
      // de standby canjean el mismo token: una gana y la otra llegaba a un token
      // ya rotado, que es la firma exacta de una sesión copiada. Se deslogueaba
      // de todos sus dispositivos a alguien que no hizo nada.
      ejecutarQb.mockResolvedValueOnce({ raw: [] });
      refreshRepo.findOne
        .mockResolvedValueOnce({
          id: 'rt-id',
          userId: 'user-uuid',
          expiresAt: new Date(Date.now() + 3_600_000),
          usadoEl: new Date(Date.now() - 1_000),
          reemplazadoPor: 'rt-nueva',
        })
        .mockResolvedValueOnce({
          id: 'rt-nueva',
          token: 'token-del-ganador',
          userId: 'user-uuid',
          activeTenantId: null,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
      usersService.findById.mockResolvedValue(mockUser);

      const result = await service.refresh('token-perdedor');

      expect(result.refresh_token).toBe('token-del-ganador');
      expect(result.access_token).toBe('mock.access.token');
      // Y lo que más importa: nadie se queda afuera.
      expect(refreshRepo.delete).not.toHaveBeenCalled();
    });

    it('dentro de la gracia pero sin reemplazo utilizable: 401 y TAMPOCO revoca', async () => {
      // La sesión avanzó sin esta pestaña (el reemplazo ya se rotó a su vez).
      // No hay token útil que darle, pero revocar acá volvería a castigar la
      // carrera, que es justo lo que este camino existe para no hacer.
      ejecutarQb.mockResolvedValueOnce({ raw: [] });
      refreshRepo.findOne
        .mockResolvedValueOnce({
          id: 'rt-id',
          userId: 'user-uuid',
          expiresAt: new Date(Date.now() + 3_600_000),
          usadoEl: new Date(Date.now() - 1_000),
          reemplazadoPor: 'rt-nueva',
        })
        .mockResolvedValueOnce(null);

      await expect(service.refresh('token-perdedor')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshRepo.delete).not.toHaveBeenCalled();
    });

    it('el ganador deja el puntero al reemplazo, o el perdedor no tiene qué recibir', async () => {
      ejecutarQb.mockResolvedValueOnce(
        canjeGanado(new Date(Date.now() + 3_600_000)),
      );
      usersService.findById.mockResolvedValue(mockUser);
      await service.refresh('valid-token');

      // ⚠️ **Dentro de la transacción**, y eso es lo que se está afirmando. Con
      // el puntero escrito en autocommit el lock de la fila se soltaba en el
      // `UPDATE` de marcado —al principio— y el perdedor lo leía tres viajes
      // antes de que existiera: medido contra Postgres real, se comía un 401 en
      // **7 de cada 8** carreras. El caso feliz de la gracia era el excepcional.
      expect(managerTx.update).toHaveBeenCalledWith(RefreshToken, 'rt-id', {
        reemplazadoPor: 'rt-nueva',
      });
      expect(refreshRepo.update).not.toHaveBeenCalled();
    });

    it('reusar un token VENCIDO no revoca: no puede desloguear los otros dispositivos', async () => {
      // Falso positivo que hay que evitar: un tab reintentando con una cookie
      // vieja no puede terminar cerrando la sesión de la persona en todos lados.
      // La sesión ya está muerta por vencimiento; no hay nada que proteger.
      ejecutarQb.mockResolvedValueOnce({ raw: [] });
      refreshRepo.findOne.mockResolvedValue({
        id: 'rt-id',
        userId: 'user-uuid',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh('token-vencido')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshRepo.delete).not.toHaveBeenCalled();
    });

    it('gana el canje pero el token estaba vencido: 401 sin rotar', async () => {
      ejecutarQb.mockResolvedValueOnce(
        canjeGanado(new Date(Date.now() - 1000)),
      );

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('deletes the refresh token from DB by token value', async () => {
      await service.logout('some-token');

      expect(refreshRepo.delete).toHaveBeenCalledWith({ token: 'some-token' });
    });

    it('does not throw when token does not exist', async () => {
      refreshRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(service.logout('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('switchTenant', () => {
    // Su hermano `getMyTenants` ya filtraba tenants borrados; éste no. Con un
    // tenant soft-borrado y una membresía viva devolvía 200 y un token para un
    // tenant muerto. `TenantGuard` cortaba en la ruta SIGUIENTE, así que el
    // usuario se enteraba un request después y con otro error.
    /** Una sesión viva en la cookie: la precondición nueva de la ruta. */
    const conSesionViva = () =>
      refreshRepo.findOne.mockResolvedValue({
        id: 'rt-id',
        expiresAt: new Date(Date.now() + 3_600_000),
      });

    it('exige que el tenant no esté borrado, no solo que exista la membresía', async () => {
      conSesionViva();
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      usersService.findById.mockResolvedValue({ id: 'usuario-uuid' });

      await service.switchTenant('usuario-uuid', 'tenant-uuid', 'rt-vivo');

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      const plano = sql.replace(/\s+/g, ' ');
      expect(plano).toContain(
        'JOIN tenants t ON t.tenant_id = ut.tenant_id AND t.eliminado_el IS NULL',
      );
      // Y la membresía sigue filtrando su propio borrado, con el alias puesto:
      // sin `ut.`, `eliminado_el` quedaba ambiguo entre las dos tablas.
      expect(plano).toContain('ut.eliminado_el IS NULL');
      expect(params).toEqual(['usuario-uuid', 'tenant-uuid']);
    });

    it('rechaza con Forbidden cuando la consulta no devuelve filas', async () => {
      conSesionViva();
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.switchTenant('usuario-uuid', 'tenant-uuid', 'rt-vivo'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sin una sesión viva en la cookie no emite nada, aunque el access token sea válido', async () => {
      // La ruta devuelve un refresh token NUEVO, así que con `JwtAuthGuard`
      // solo convertía cualquier access token filtrado en sesión renovable: 15
      // minutos de filtración pasaban a acceso indefinido.
      refreshRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);

      await expect(
        service.switchTenant('usuario-uuid', 'tenant-uuid', 'rt-inventado'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // Y corta ANTES de mirar la membresía: no se filtra si el tenant existe.
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(refreshRepo.save).not.toHaveBeenCalled();
    });

    it('la cookie tiene que ser del MISMO usuario que el access token', async () => {
      // Sin el `userId` en el criterio, el refresh token de cualquier otra
      // cuenta serviría de segundo factor para el access token robado.
      conSesionViva();
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      usersService.findById.mockResolvedValue({ id: 'usuario-uuid' });

      await service.switchTenant('usuario-uuid', 'tenant-uuid', 'rt-vivo');

      expect(refreshRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            token: 'rt-vivo',
            userId: 'usuario-uuid',
          }),
        }),
      );
    });

    it('revoca las sesiones vivas pero CONSERVA las lápidas', async () => {
      // Sin el `usadoEl: IsNull()`, este borrado se llevaba también las filas
      // marcadas y la detección de reuso quedaba apagada después de cada cambio
      // de tenant: un token robado y ya rotado caía en "no existe" y devolvía un
      // 401 genérico en vez de cortar la sesión.
      conSesionViva();
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      usersService.findById.mockResolvedValue({ id: 'usuario-uuid' });

      await service.switchTenant('usuario-uuid', 'tenant-uuid', 'rt-vivo');

      expect(refreshRepo.delete).toHaveBeenCalledWith({
        userId: 'usuario-uuid',
        usadoEl: IsNull(),
      });
    });

    it('una cookie vencida no sirve', async () => {
      refreshRepo.findOne.mockResolvedValue({
        id: 'rt-id',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.switchTenant('usuario-uuid', 'tenant-uuid', 'rt-vencido'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('register', () => {
    it('responde LO MISMO exista o no el correo', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ ...mockUser, id: 'nuevo-uuid' });
      const libre = await service.register({
        nombre: 'N',
        correo: 'nuevo@x.cl',
        contrasena: 'secreto123',
      });

      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        correo: 'tomado@x.cl',
      });
      const tomado = await service.register({
        nombre: 'N',
        correo: 'tomado@x.cl',
        contrasena: 'secreto123',
      });

      // Byte por byte: si divergieran, el endpoint volvería a ser un
      // enumerador público de cuentas. Es el 409 que se sacó.
      expect(tomado).toEqual(libre);
    });

    it('no crea ninguna cuenta cuando el correo ya está verificado', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        correo: 'tomado@x.cl',
      });

      await service.register({
        nombre: 'Impostor',
        correo: 'tomado@x.cl',
        contrasena: 'secreto123',
      });

      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('la cuenta nueva nace SIN verificar', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ ...mockUser, id: 'nuevo-uuid' });

      await service.register({
        nombre: 'N',
        correo: 'nuevo@x.cl',
        contrasena: 'secreto123',
      });

      // El segundo argumento es el que sella la verificación. `register` no
      // puede pasarlo: probar la dirección es justamente lo que falta.
      const [, interno] = usersService.create.mock.calls[0] as [
        unknown,
        unknown,
      ];
      expect(interno).toBeUndefined();
    });

    it('normaliza el correo antes de buscarlo, o el mismo mail con otra caja escaparía', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser);

      await service.register({
        nombre: 'N',
        correo: '  Juan.Perez@X.CL ',
        contrasena: 'secreto123',
      });

      expect(usersService.findByEmail).toHaveBeenCalledWith('juan.perez@x.cl');
    });
  });

  describe('validateUser', () => {
    it('no deja entrar a una cuenta con el correo sin verificar', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        contrasena: await bcrypt.hash('secreto123', 10),
        correoVerificadoEl: null,
      });

      await expect(
        service.validateUser('test@example.com', 'secreto123'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('la contraseña mala devuelve null ANTES de mirar la verificación', async () => {
      // El orden es la defensa: si el corte por verificación fuera primero,
      // cualquiera podría separar "no existe" de "existe sin verificar"
      // probando una clave cualquiera.
      usersService.findByEmail.mockResolvedValue({
        ...mockUser,
        contrasena: await bcrypt.hash('secreto123', 10),
        correoVerificadoEl: null,
      });

      await expect(
        service.validateUser('test@example.com', 'clave-incorrecta'),
      ).resolves.toBeNull();
    });
  });

  describe('googleLogin', () => {
    const perfil = {
      googleId: 'g-1',
      name: 'Juan Perez',
      email: 'juan@x.cl',
      emailVerificado: true,
    };

    it('no vincula el googleId a una cuenta local que coincide por correo', async () => {
      // "El correo coincide" dejó de ser prueba de identidad. Antes esto ataba
      // el googleId de quien entraba a la cuenta local de otra persona.
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(mockUser);

      await expect(service.googleLogin(perfil)).rejects.toBeInstanceOf(
        ConflictException,
      );
      // Y no queda ningún otro camino: `linkGoogleId` se borró con este cambio.
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('rechaza el perfil cuyo correo Google no confirma', async () => {
      usersService.findByGoogleId.mockResolvedValue(null);

      await expect(
        service.googleLogin({ ...perfil, emailVerificado: false }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('la cuenta que crea Google nace verificada: la dirección ya está probada', async () => {
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser);

      await service.googleLogin(perfil);

      const [, interno] = usersService.create.mock.calls[0] as [
        unknown,
        { correoVerificadoEl?: Date },
      ];
      expect(interno.correoVerificadoEl).toBeInstanceOf(Date);
    });

    it('encontrar el googleId entra directo, sin mirar el correo', async () => {
      usersService.findByGoogleId.mockResolvedValue(mockUser);

      await expect(service.googleLogin(perfil)).resolves.toBe(mockUser);
      expect(usersService.findByEmail).not.toHaveBeenCalled();
    });
  });
});
