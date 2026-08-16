import { describe, it, expect } from 'vitest'
import type { MesaResumen } from '~/composables/useSalones'
import { dimensionesMesaPx, mesasSePisan } from './mesa-dimensiones'

type Caja = Pick<MesaResumen, 'posX' | 'posY' | 'forma' | 'tamano'>

/** Plano de 1000×1000 px: la fracción se lee directo como píxeles. */
const PLANO = { width: 1000, height: 1000 }

const mesa = (
  posX: number,
  posY: number,
  over: Partial<Caja> = {},
): Caja => ({
  posX: String(posX),
  posY: String(posY),
  forma: 'cuadrada',
  tamano: 'mediano', // 80 px
  ...over,
})

describe('dimensionesMesaPx', () => {
  it('la rectangular es 1,5× de ancho y mantiene el alto', () => {
    expect(dimensionesMesaPx('rectangular', 'mediano')).toEqual({
      width: 120,
      height: 80,
    })
  })

  it('la redonda y la cuadrada son el cuadrado del tamaño', () => {
    expect(dimensionesMesaPx('redonda', 'pequeno')).toEqual({
      width: 64,
      height: 64,
    })
    expect(dimensionesMesaPx('cuadrada', 'extra_grande')).toEqual({
      width: 112,
      height: 112,
    })
  })
})

describe('mesasSePisan', () => {
  it('dos mesas en el mismo punto se pisan', () => {
    expect(mesasSePisan(mesa(0.5, 0.5), mesa(0.5, 0.5), PLANO)).toBe(true)
  })

  it('separadas de sobra, no', () => {
    expect(mesasSePisan(mesa(0.1, 0.1), mesa(0.9, 0.9), PLANO)).toBe(false)
  })

  it('solapadas a medias, sí', () => {
    // Centros a 40 px: dos mesas de 80 px se pisan justo en la mitad.
    expect(mesasSePisan(mesa(0.5, 0.5), mesa(0.54, 0.5), PLANO)).toBe(true)
  })

  // Dos mesas pegadas lado a lado es una distribución legítima, no un error:
  // avisar ahí volvería el aviso ruido y la gente dejaría de leerlo.
  it('pegadas por el borde exacto NO cuentan como solape', () => {
    // Centros a exactamente 80 px = ancho de una mesa: los bordes se tocan.
    expect(mesasSePisan(mesa(0.5, 0.5), mesa(0.58, 0.5), PLANO)).toBe(false)
  })

  it('el tamaño importa: la misma distancia pisa con mesas grandes y no con chicas', () => {
    const a = mesa(0.5, 0.5, { tamano: 'pequeno' }) // 64 px
    const b = mesa(0.57, 0.5, { tamano: 'pequeno' }) // centros a 70 px
    expect(mesasSePisan(a, b, PLANO)).toBe(false)

    const grandeA = mesa(0.5, 0.5, { tamano: 'extra_grande' }) // 112 px
    const grandeB = mesa(0.57, 0.5, { tamano: 'extra_grande' })
    expect(mesasSePisan(grandeA, grandeB, PLANO)).toBe(true)
  })

  // La razón por la que esto no puede vivir en el backend: el mismo par de
  // mesas se pisa o no según el ancho real del plano, que el servidor no conoce.
  it('el mismo par se pisa en un plano angosto y no en uno ancho', () => {
    const a = mesa(0.5, 0.5)
    const b = mesa(0.58, 0.5)
    expect(mesasSePisan(a, b, { width: 1000, height: 1000 })).toBe(false)
    expect(mesasSePisan(a, b, { width: 600, height: 1000 })).toBe(true)
  })

  it('la rectangular pisa a lo ancho donde la cuadrada no', () => {
    const cuadrada = mesa(0.5, 0.5)
    const vecina = mesa(0.59, 0.5)
    expect(mesasSePisan(cuadrada, vecina, PLANO)).toBe(false)

    const rect = mesa(0.5, 0.5, { forma: 'rectangular' }) // 120 px de ancho
    expect(mesasSePisan(rect, vecina, PLANO)).toBe(true)
  })
})
