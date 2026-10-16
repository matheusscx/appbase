import { describe, it, expect } from 'vitest'
import { hostImpresoraValido } from './host-impresora'

describe('hostImpresoraValido', () => {
  it.each(['192.168.1.50', '10.0.0.9', 'cocina.local', 'impresora-1.lan.local', 'cocina'])('acepta %s', (h) => {
    expect(hostImpresoraValido(h)).toBe(true)
  })
  it.each(['cocina principal', '999.1.1.1', '192.168.1', '192.168.1.50.7', 'con espacio.local', 'http://10.0.0.9', ''])('rechaza "%s"', (h) => {
    expect(hostImpresoraValido(h)).toBe(false)
  })
  it('ignora espacios al borde', () => {
    expect(hostImpresoraValido(' 192.168.1.50 ')).toBe(true)
  })
})
