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
    //
    // ⚠️ **La invitación se afirma en días de CALENDARIO, no en horas**, y el
    // reloj se congela para que la fecha real no decida el resultado. El código
    // usa `setDate(+7)`, que conserva la hora de pared: cruzando el cambio de
    // horario esos 7 días son 167 horas, y en abril 169. Este test afirmaba
    // `24 * 7` y se caía una semana por año — el 2026-08-30 daba 167 en
    // `America/Santiago`, donde el horario de verano arranca el 6 de septiembre.
    // No lo cazaba nadie porque la TZ no está fijada en ningún lado (sale de la
    // máquina) y CI corre en UTC, que no tiene cambio de hora.
    it('la invitación vive 7 días de calendario y el reset 1 hora', async () => {
      // Una fecha cuyo +7 cruza el cambio de horario en Santiago. En una TZ sin
      // cambio de hora el test pasa igual: lo que se afirma —misma hora de
      // pared, 7 días después— vale en las dos.
      jest.useFakeTimers().setSystemTime(new Date('2026-08-30T15:00:00Z'));
      try {
        const antes = new Date();
        await service.emitir(USUARIO, TipoTokenAcceso.INVITACION);
        const invitacion = guardado.expiraEl!;
        await service.emitir(USUARIO, TipoTokenAcceso.RESET);
        const reset = guardado.expiraEl!;

        // Las dos mitades importan y cazan mutantes distintos, los dos medidos:
        // la fecha pinea los 7 días —el `7` va literal acá, no leído de la
        // constante, así que bajarlo a 6 pone esto en rojo—, y la hora de pared
        // caza sumar 168 horas REALES (`setTime(getTime() + 7*24*3600000)`),
        // que en esta semana aterriza a las 12 en vez de a las 11.
        //
        // 📌 Ojo con cuál es el mutante: `setHours(getHours() + 24*7)` **no** lo
        // es. Hace la misma aritmética de campos locales que `setDate(+7)` y da
        // exactamente lo mismo, cambio de hora incluido. Lo que rompe la
        // semántica es hacer la cuenta sobre el epoch.
        const esperado = new Date(antes);
        esperado.setDate(esperado.getDate() + 7);
        expect(invitacion.toDateString()).toBe(esperado.toDateString());
        expect(invitacion.getHours()).toBe(antes.getHours());
        expect(invitacion.getMinutes()).toBe(antes.getMinutes());

        // El reset sí son horas reales: `setHours` suma horas, no días.
        const HORA = 3_600_000;
        expect((reset.getTime() - antes.getTime()) / HORA).toBeCloseTo(1, 0);
      } finally {
        jest.useRealTimers();
      }
    });

    // El `if/else` que había mandaba al `else` —la hora del reset— a cualquier
    // tipo que no fuera invitación. Los dos tipos nuevos habrían caído ahí en
    // silencio, y la ventana de un token es una decisión de seguridad, no un
    // default. Por eso hoy es un `switch` sin rama por omisión.
    it.each([TipoTokenAcceso.CONFIRMACION, TipoTokenAcceso.VERIFICACION])(
      '%s espera a que alguien lea un mail: 7 días, no la hora del reset',
      async (tipo) => {
        const antes = Date.now();
        await service.emitir(USUARIO, tipo);

        const dias = (guardado.expiraEl!.getTime() - antes) / 86_400_000;
        expect(dias).toBeCloseTo(7, 0);
      },
    );

    it('guarda los datos del token de confirmación, y null cuando no vienen', async () => {
      const datos = { tenantId: 'tenant-uuid', rolIds: ['rol-uuid'] };
      await service.emitir(
        USUARIO,
        TipoTokenAcceso.CONFIRMACION,
        undefined,
        datos,
      );
      expect(guardado.datos).toEqual(datos);

      await service.emitir(USUARIO, TipoTokenAcceso.RESET);
      expect(guardado.datos).toBeNull();
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
        datos: null,
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
