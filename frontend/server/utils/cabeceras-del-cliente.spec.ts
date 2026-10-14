import { describe, expect, it } from 'vitest'
import { cabecerasDelCliente } from './cabeceras-del-cliente'

describe('cabecerasDelCliente', () => {
  const SECRETO = 'secreto-de-prueba'

  it('sin PROXY_SECRETO no agrega nada: el backend no tendría con qué creerle', () => {
    expect(cabecerasDelCliente({}, '10.0.0.5', {})).toBeNull()
  })

  it('con secreto, nombra al cliente por el par TCP y firma con el secreto', () => {
    expect(cabecerasDelCliente({}, '10.0.0.5', { PROXY_SECRETO: SECRETO })).toEqual({
      'x-cliente-ip': '10.0.0.5',
      'x-proxy-secreto': SECRETO,
    })
  })

  it('con la cabecera del borde configurada, la usa: detrás de Railway el par TCP es el borde', () => {
    expect(
      cabecerasDelCliente({ 'x-real-ip': '200.1.2.3' }, '100.64.0.2', {
        PROXY_SECRETO: SECRETO,
        IP_CABECERA_BORDE: 'X-Real-IP',
      }),
    ).toEqual({ 'x-cliente-ip': '200.1.2.3', 'x-proxy-secreto': SECRETO })
  })

  it('sin configurarla, no le cree a esa cabecera: la escribe cualquiera', () => {
    expect(
      cabecerasDelCliente({ 'x-real-ip': '200.1.2.3' }, '10.0.0.5', { PROXY_SECRETO: SECRETO })?.['x-cliente-ip'],
    ).toBe('10.0.0.5')
  })

  it('una lista en la cabecera del borde se descarta: su primer elemento lo pone el cliente', () => {
    expect(
      cabecerasDelCliente({ 'x-forwarded-for': '1.1.1.1, 200.1.2.3' }, '10.0.0.5', {
        PROXY_SECRETO: SECRETO,
        IP_CABECERA_BORDE: 'x-forwarded-for',
      })?.['x-cliente-ip'],
    ).toBe('10.0.0.5')
  })

  it('sin ninguna IP válida no manda x-cliente-ip, y el backend cae a su propia fuente', () => {
    expect(cabecerasDelCliente({}, undefined, { PROXY_SECRETO: SECRETO })).toBeNull()
  })
})
