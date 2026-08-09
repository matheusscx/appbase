// @vitest-environment nuxt
//
// El modo personal del garzón (tablet propia) manda el PIN **vacío**: la
// pantalla no lo pide porque el JWT ya dice quién es, y `credencialGarzon`
// traduce ese `''` en "no mandes credencial".
//
// ⚠️ Lo que este spec fija es que los TRES endpoints de sesión hagan esa
// traducción. Dos de ellos no la hacían, y el resultado no era un detalle: el
// `@IsOptional()` de class-validator **no saltea el string vacío**, así que un
// `pin: ''` llegaba al `@Matches(/^\d{6}$/)` del DTO y volvía 400. Sin poder
// entrar a turno no se puede abrir ninguna cuenta, o sea que el modo personal
// quedaba inoperable de punta a punta.
//
// No lo cazó nada: el e2e ejercitaba `/activa` —el único de los tres que el
// frontend nunca llama— y los tests de pantalla cubrían abrir cuenta, que sí
// traducía.
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useSesionesGarzon } from './useSesionesGarzon'

let bodies: { url: string, body: Record<string, unknown> }[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { body?: Record<string, unknown> }) => {
    bodies.push({ url, body: opts?.body ?? {} })
    return Promise.resolve(null)
  }
})

describe('useSesionesGarzon — la credencial en modo personal', () => {
  beforeEach(() => {
    bodies = []
  })

  const PERSONAL = { garzonId: 'g1', pin: '' }
  const TOTEM = { garzonId: 'g1', pin: '123456' }

  it('iniciar no manda pin vacío: lo omite', async () => {
    await useSesionesGarzon().iniciar({ ...PERSONAL, turnoId: 't1' })

    expect(bodies[0]!.body).not.toHaveProperty('pin')
    expect(bodies[0]!.body).not.toHaveProperty('garzonId')
    // El turno sí viaja: no es parte de la credencial.
    expect(bodies[0]!.body).toHaveProperty('turnoId', 't1')
  })

  it('cerrar no manda pin vacío: lo omite', async () => {
    await useSesionesGarzon().cerrar(PERSONAL)

    expect(bodies[0]!.body).not.toHaveProperty('pin')
    expect(bodies[0]!.body).not.toHaveProperty('garzonId')
  })

  it('activa no manda pin vacío: lo omite', async () => {
    await useSesionesGarzon().activa(PERSONAL)

    expect(bodies[0]!.body).not.toHaveProperty('pin')
  })

  // La otra mitad: en el tótem la credencial tiene que viajar entera, o nadie
  // puede operar. Sin esto, un helper que devolviera siempre `{}` pasaría los
  // tres tests de arriba.
  it('con PIN real, los tres mandan la credencial completa', async () => {
    const api = useSesionesGarzon()
    await api.iniciar({ ...TOTEM, turnoId: 't1' })
    await api.cerrar(TOTEM)
    await api.activa(TOTEM)

    for (const { body } of bodies) {
      expect(body).toMatchObject({ garzonId: 'g1', pin: '123456' })
    }
  })
})
