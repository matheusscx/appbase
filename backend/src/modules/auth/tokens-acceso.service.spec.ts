import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { TokensAccesoService } from './tokens-acceso.service';
import { TipoTokenAcceso, TokenAcceso } from './entities/token-acceso.entity';

/**
 * Ciclo de vida del token, en unit.
 *
 * Existe porque todo esto colgaba solo del e2e, y ahí ya se escapó un mutante:
 * el test que decía cubrir el "un solo uso" pasaba con la guarda de `quemar`
 * borrada. Lo que se afirma acá es lo que no se ve desde HTTP — qué se guarda,
 * con qué vencimiento, y qué cortan las condiciones del `WHERE`.
 */
const USUARIO = 'usuario-uuid';

describe('TokensAccesoService', () => {
  let service: TokensAccesoService;
  let repo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let guardado: Partial<TokenAcceso>;

  beforeEach(async () => {
    guardado = {};
    repo = {
      findOne: jest.fn(),
      create: jest.fn((d: Partial<TokenAcceso>) => {
        guardado = d;
        return d;
      }),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensAccesoService,
        { provide: getRepositoryToken(TokenAcceso), useValue: repo },
      ],
    }).compile();
    service = module.get(TokensAccesoService);
  });

  describe('emitir', () => {
    // ⚠️ Lo que hace que una filtración de la base no reparta cuentas: el claro
    // existe solo en el link del mail.
    it('guarda el HASH, nunca el token en claro', async () => {
      const token = await service.emitir(USUARIO, TipoTokenAcceso.INVITACION);

      expect(guardado.tokenHash).not.toBe(token);
      expect(guardado.tokenHash).toBe(
        createHash('sha256').update(token).digest('hex'),
      );
    });

    it('devuelve un token distinto cada vez', async () => {
      const a = await service.emitir(USUARIO, TipoTokenAcceso.INVITACION);
      const b = await service.emitir(USUARIO, TipoTokenAcceso.INVITACION);

      expect(a).not.toBe(b);
      // 32 bytes en base64url: sin `=` ni `+` ni `/`, así entra en una URL sin
      // escapar nada.
      expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    // Los dos vencimientos son distintos a propósito: el reset lo dispara
    // cualquiera que sepa un correo, la invitación la dispara un admin.
    it('la invitación vive 7 días y el reset 1 hora', async () => {
      const antes = Date.now();
      await service.emitir(USUARIO, TipoTokenAcceso.INVITACION);
      const invitacion = guardado.expiraEl!.getTime() - antes;
      await service.emitir(USUARIO, TipoTokenAcceso.RESET);
      const reset = guardado.expiraEl!.getTime() - antes;

      const HORA = 3_600_000;
      expect(invitacion / HORA).toBeCloseTo(24 * 7, 0);
      expect(reset / HORA).toBeCloseTo(1, 0);
    });
  });

  describe('buscarVigente', () => {
    function fila(over: Partial<TokenAcceso> = {}): TokenAcceso {
      return {
        id: 'tok-1',
        tokenHash: 'h',
        tipo: TipoTokenAcceso.INVITACION,
        usuarioId: USUARIO,
        expiraEl: new Date(Date.now() + 60_000),
        usadoEl: null,
        creadoEl: new Date(),
        actualizadoEl: new Date(),
        eliminadoEl: null,
        ...over,
      };
    }

    it('busca por hash y por tipo, y solo entre los sin usar', async () => {
      repo.findOne.mockResolvedValue(fila());

      await service.buscarVigente('abc', TipoTokenAcceso.INVITACION);

      const [{ where }] = repo.findOne.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      // El `tipo` en el WHERE es lo que impide que un link de invitación —que
      // vive 7 días— valga como reset, y al revés.
      expect(where.tipo).toBe(TipoTokenAcceso.INVITACION);
      expect(where.tokenHash).toBe(
        createHash('sha256').update('abc').digest('hex'),
      );
      expect(where.usadoEl).toBeDefined();
    });

    it('descarta el vencido aunque la base lo devuelva', async () => {
      repo.findOne.mockResolvedValue(
        fila({ expiraEl: new Date(Date.now() - 1000) }),
      );

      const res = await service.buscarVigente(
        'abc',
        TipoTokenAcceso.INVITACION,
      );

      // El vencimiento se chequea en código, no en el WHERE: si esto se cayera,
      // un link de hace un año seguiría abriendo la cuenta.
      expect(res).toBeNull();
    });
  });
});
