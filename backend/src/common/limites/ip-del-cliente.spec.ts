import { ipDelCliente } from './ip-del-cliente';

function req(headers: Record<string, string>, remoteAddress = '10.0.0.9') {
  return { headers, socket: { remoteAddress } };
}

describe('ipDelCliente', () => {
  const SECRETO = 'secreto-de-prueba-largo';

  it('con el secreto del proxy correcto, cree la IP que manda el proxy', () => {
    expect(
      ipDelCliente(
        req({ 'x-proxy-secreto': SECRETO, 'x-cliente-ip': '200.1.2.3' }),
        { secretoProxy: SECRETO },
      ),
    ).toBe('200.1.2.3');
  });

  it('sin el secreto, x-cliente-ip no vale: el cliente la puede escribir', () => {
    expect(
      ipDelCliente(req({ 'x-cliente-ip': '200.1.2.3' }), {
        secretoProxy: SECRETO,
      }),
    ).toBe('10.0.0.9');
  });

  it('con un secreto equivocado, tampoco', () => {
    expect(
      ipDelCliente(
        req({ 'x-proxy-secreto': 'otro', 'x-cliente-ip': '200.1.2.3' }),
        { secretoProxy: SECRETO },
      ),
    ).toBe('10.0.0.9');
  });

  it('si el backend no tiene secreto configurado, no le cree a nadie', () => {
    expect(
      ipDelCliente(
        req({ 'x-proxy-secreto': '', 'x-cliente-ip': '200.1.2.3' }),
        {},
      ),
    ).toBe('10.0.0.9');
  });

  it('con el secreto correcto pero una IP que no es IP, cae a la siguiente fuente', () => {
    expect(
      ipDelCliente(
        req({ 'x-proxy-secreto': SECRETO, 'x-cliente-ip': 'cualquier-cosa' }),
        { secretoProxy: SECRETO },
      ),
    ).toBe('10.0.0.9');
  });

  it('la cabecera del borde vale solo si está configurada', () => {
    const r = req({ 'x-real-ip': '190.5.6.7' });
    expect(ipDelCliente(r, {})).toBe('10.0.0.9');
    expect(ipDelCliente(r, { cabeceraBorde: 'X-Real-IP' })).toBe('190.5.6.7');
  });

  it('una cabecera del borde con lista no se usa: el primero lo escribe el cliente', () => {
    expect(
      ipDelCliente(req({ 'x-forwarded-for': '1.1.1.1, 190.5.6.7' }), {
        cabeceraBorde: 'x-forwarded-for',
      }),
    ).toBe('10.0.0.9');
  });

  it('el proxy con secreto gana sobre la cabecera del borde', () => {
    expect(
      ipDelCliente(
        req({
          'x-proxy-secreto': SECRETO,
          'x-cliente-ip': '200.1.2.3',
          'x-real-ip': '152.55.176.109',
        }),
        { secretoProxy: SECRETO, cabeceraBorde: 'x-real-ip' },
      ),
    ).toBe('200.1.2.3');
  });

  it('IPv6: agrupa por /64, para que rotar dentro del mismo bloque no sirva', () => {
    expect(ipDelCliente(req({}, '2001:db8:1:2:aaaa::1'), {})).toBe(
      ipDelCliente(req({}, '2001:db8:1:2:bbbb::2'), {}),
    );
  });
});
