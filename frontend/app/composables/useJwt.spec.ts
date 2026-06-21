import { describe, it, expect } from 'vitest'
import { decodeJwt } from './useJwt'

// Token JWT de ejemplo con payload { sub: 'user-1', email: 'a@b.com', tenant_id: null, es_superadmin: false }
// Generado con: btoa(JSON.stringify({sub:'user-1',email:'a@b.com',tenant_id:null,es_superadmin:false,iat:1000,exp:9999}))
const makeToken = (payload: object) => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${header}.${body}.fake-signature`
}

describe('decodeJwt', () => {
  it('devuelve el payload de un token válido', () => {
    const token = makeToken({
      sub: 'user-1',
      email: 'a@b.com',
      tenant_id: null,
      es_superadmin: false,
      iat: 1000,
      exp: 9999,
    })
    const result = decodeJwt(token)
    expect(result).not.toBeNull()
    expect(result!.sub).toBe('user-1')
    expect(result!.email).toBe('a@b.com')
    expect(result!.tenant_id).toBeNull()
    expect(result!.es_superadmin).toBe(false)
  })

  it('devuelve el tenant_id cuando está presente', () => {
    const token = makeToken({
      sub: 'user-2',
      email: 'b@c.com',
      tenant_id: '550e8400-e29b-41d4-a716-446655440001',
      es_superadmin: false,
      iat: 1000,
      exp: 9999,
    })
    const result = decodeJwt(token)
    expect(result!.tenant_id).toBe('550e8400-e29b-41d4-a716-446655440001')
  })

  it('devuelve es_superadmin true cuando el token lo indica', () => {
    const token = makeToken({
      sub: 'admin-1',
      email: 'admin@sistema.com',
      tenant_id: null,
      es_superadmin: true,
      iat: 1000,
      exp: 9999,
    })
    const result = decodeJwt(token)
    expect(result!.es_superadmin).toBe(true)
  })

  it('devuelve null para un token corrupto', () => {
    expect(decodeJwt('no.es.un.jwt')).toBeNull()
    expect(decodeJwt('')).toBeNull()
    expect(decodeJwt('solo-un-segmento')).toBeNull()
  })
})
