import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import {
  formatCostoDisplay,
  formatMontoDisplay,
  formatMontoManual,
  isIso4217Currency,
  parseMontoInput,
  parseMontoPegado,
} from './currency-format'
import type { MonedaDisplayConfig } from '~/types/moneda'

const clp: MonedaDisplayConfig = {
  monedaId: '1',
  codigoIso: 'CLP',
  nombre: 'Peso Chileno',
  locale: 'es-CL',
  prefix: '$',
  thousands: '.',
  decimal: ',',
  decimals: 0,
  habilitada: true,
  esOficial: true,
  valorDelDia: '1',
}

const usd: MonedaDisplayConfig = {
  monedaId: '2',
  codigoIso: 'USD',
  nombre: 'Dólar',
  locale: 'en-US',
  prefix: '$',
  thousands: ',',
  decimal: '.',
  decimals: 2,
  habilitada: true,
  esOficial: false,
  valorDelDia: '950',
}

const uf: MonedaDisplayConfig = {
  monedaId: '3',
  codigoIso: 'UF',
  nombre: 'UF',
  locale: 'es-CL',
  prefix: '$',
  thousands: '.',
  decimal: ',',
  decimals: 4,
  habilitada: true,
  esOficial: false,
  valorDelDia: null,
}

describe('isIso4217Currency', () => {
  it('CLP y USD son ISO', () => {
    expect(isIso4217Currency('CLP')).toBe(true)
    expect(isIso4217Currency('USD')).toBe(true)
  })

  it('UF no es ISO', () => {
    expect(isIso4217Currency('UF')).toBe(false)
  })
})

describe('formatMontoDisplay', () => {
  it('formatea CLP con símbolo pegado al monto', () => {
    expect(formatMontoDisplay('1500000', clp)).toBe('$1.500.000')
  })

  it('formatea USD con símbolo pegado al monto', () => {
    expect(formatMontoDisplay('1500.5', usd)).toBe('$1,500.50')
  })

  it('UF usa fallback manual con 4 decimales', () => {
    const result = formatMontoDisplay('1234.5678', uf)
    expect(result).toBe('$1.234,5678')
  })

  it('vacío devuelve em dash', () => {
    expect(formatMontoDisplay('', clp)).toBe('—')
    expect(formatMontoDisplay(null, clp)).toBe('—')
  })
})

describe('formatCostoDisplay', () => {
  // El caso que motiva la función: $1.500 por kilo son $1,5 por gramo, y en CLP
  // eso no es representable. Con `formatMontoDisplay` se vería "$2" —un 33% más
  // caro— al lado del campo donde se teclea el costo nuevo.
  it('muestra la fracción que la moneda no tiene, en vez de redondearla', () => {
    expect(formatCostoDisplay('1.5', clp)).toBe('$1,5')
    expect(formatMontoDisplay('1.5', clp)).toBe('$2')
  })

  it('un costo entero se ve igual que un monto: la moneda es el piso', () => {
    expect(formatCostoDisplay('1500', clp)).toBe('$1.500')
    expect(formatCostoDisplay('1500.0000', clp)).toBe('$1.500')
  })

  it('no recorta los decimales que la moneda sí tiene', () => {
    expect(formatCostoDisplay('1500.5', usd)).toBe('$1,500.50')
  })

  it('corta en la escala con que el backend guarda el costo', () => {
    expect(formatCostoDisplay('0.123456', clp)).toBe('$0,1235')
  })

  it('vacío devuelve em dash', () => {
    expect(formatCostoDisplay('', clp)).toBe('—')
    expect(formatCostoDisplay(null, clp)).toBe('—')
    expect(formatCostoDisplay(undefined, clp)).toBe('—')
  })

  it('acepta un Decimal, que es lo que devuelve la conversión de unidad', () => {
    expect(formatCostoDisplay(new Decimal('1500').div(1000), clp)).toBe('$1,5')
  })
})

describe('parseMontoInput', () => {
  it('parsea CLP con separadores chilenos', () => {
    expect(parseMontoInput('$1.500.000', clp).toString()).toBe('1500000')
  })

  it('parsea USD', () => {
    expect(parseMontoInput('$1,500.50', { ...usd, prefix: '$' }).toString()).toBe('1500.5')
  })

  it('round-trip manual UF', () => {
    const raw = formatMontoManual(new Decimal('99.1234'), uf)
    expect(parseMontoInput(raw, uf).toFixed(4)).toBe('99.1234')
  })
})

/**
 * El monto PEGADO es el único camino donde se puede saber qué quiso decir la
 * persona, y por eso existe esta función aparte.
 *
 * Tecleando no se puede: `1`,`.`,`5`,`0`,`0` (mil quinientos, el hábito chileno)
 * y `1`,`0`,`0`,`.`,`5` (ochocientos y medio) son el mismo gesto, y lo único que
 * los distingue son los dígitos que vienen DESPUÉS del punto — que para cuando
 * se teclean, maska ya colapsó el texto. Un intento de distinguirlos con memoria
 * de la última tecla rompió `1.500` → `1` y se revirtió (ver `MoneyInput.vue`).
 *
 * Pegando, en cambio, la cadena llega **entera**: `'1000.5'` tiene un punto
 * seguido de UN dígito, que en es-CL no es una agrupación posible. Ahí sí hay
 * información suficiente para decidir — con el límite de que `12.345` sigue
 * teniendo dos lecturas y gana siempre la de la moneda del campo.
 */
describe('parseMontoPegado', () => {
  describe('en una moneda de 0 decimales (CLP)', () => {
    it('deja pasar la agrupación válida: "1.500" es mil quinientos', () => {
      expect(parseMontoPegado('1.500', clp)).toEqual({ tipo: 'sin-cambios' })
    })

    it('deja pasar varias agrupaciones: "12.345.678"', () => {
      expect(parseMontoPegado('12.345.678', clp)).toEqual({ tipo: 'sin-cambios' })
    })

    it('deja pasar un entero pelado', () => {
      expect(parseMontoPegado('1500', clp)).toEqual({ tipo: 'sin-cambios' })
    })

    it('RECHAZA "1000.5": el punto no agrupa y el peso no tiene decimales', () => {
      // Hoy esto se guarda como 10005, diez veces lo pegado, sin que nadie avise.
      expect(parseMontoPegado('1000.5', clp)).toEqual({ tipo: 'rechazado' })
    })

    it('RECHAZA "1000,5": el decimal explícito tampoco cabe en el peso', () => {
      expect(parseMontoPegado('1000,5', clp)).toEqual({ tipo: 'rechazado' })
    })
  })

  describe('en un campo de 4 decimales (UF, separadores de es-CL)', () => {
    it('corrige "1000.5" al decimal de la moneda, que ahí sí cabe', () => {
      expect(parseMontoPegado('1000.5', uf)).toEqual({
        tipo: 'corregido',
        texto: '1000,5',
      })
    })

    it('la agrupación válida sigue siendo agrupación', () => {
      expect(parseMontoPegado('1.500', uf)).toEqual({ tipo: 'sin-cambios' })
    })

    it('el formato explícito con los dos separadores se deja como está', () => {
      expect(parseMontoPegado('1.234,56', uf)).toEqual({ tipo: 'sin-cambios' })
    })

    it('RECHAZA más decimales de los que la escala admite', () => {
      expect(parseMontoPegado('1000.56789', uf)).toEqual({ tipo: 'rechazado' })
    })
  })

  describe('en la moneda con los separadores al revés (USD)', () => {
    it('deja pasar "1000.5": ahí el punto ES el decimal y cabe en 2', () => {
      expect(parseMontoPegado('1000.5', usd)).toEqual({ tipo: 'sin-cambios' })
    })

    it('corrige "1000,5", donde la coma es el agrupador y no agrupa nada', () => {
      expect(parseMontoPegado('1000,5', usd)).toEqual({
        tipo: 'corregido',
        texto: '1000.5',
      })
    })
  })

  describe('el borde: lo que decide es el VALOR, no el largo de la cola', () => {
    it('"1.500,00" en pesos son mil quinientos y SÍ caben', () => {
      // Es como cualquier planilla escribe un entero, y es el caso que un
      // "rechazá si la cola mide más que la escala" descartaba de más. Se
      // reescribe igual, porque con `fraction: 0` la máscara leería `150000`.
      expect(parseMontoPegado('1.500,00', clp)).toEqual({
        tipo: 'corregido',
        texto: '1500',
      })
    })

    it('exactamente los decimales de la escala pasan derecho', () => {
      expect(parseMontoPegado('1000,1234', uf)).toEqual({ tipo: 'sin-cambios' })
    })

    it('uno más que la escala se rechaza', () => {
      expect(parseMontoPegado('1000,12345', uf)).toEqual({ tipo: 'rechazado' })
    })

    it('un separador al final es un monto a medio escribir, no un decimal', () => {
      // Y vale para los DOS separadores: el guard vive en las dos ramas. Sin el
      // de la rama decimal, `1000,` se rechazaba y `1000.` no, para la misma
      // cadena escrita a medias.
      expect(parseMontoPegado('1000.', clp)).toEqual({ tipo: 'sin-cambios' })
      expect(parseMontoPegado('1000,', clp)).toEqual({ tipo: 'sin-cambios' })
      expect(parseMontoPegado('1000.', usd)).toEqual({ tipo: 'sin-cambios' })
    })

    it('una cadena de otro locale ("1,234.56") se rechaza: tiene dos lecturas', () => {
      expect(parseMontoPegado('1,234.56', uf)).toEqual({ tipo: 'rechazado' })
    })
  })

  describe('lo que un copiado real arrastra', () => {
    it('el espacio duro de una página web no lo saca del análisis', () => {
      // Sin normalizarlo, `1 000,5` no pasaba por monto y seguía derecho al ×10.
      expect(parseMontoPegado('1 000,5', clp)).toEqual({ tipo: 'rechazado' })
      expect(parseMontoPegado('1 000.5', uf)).toEqual({
        tipo: 'corregido',
        texto: '1000,5',
      })
    })

    it('DOS celdas de una planilla no son un monto: eso lo decide la máscara', () => {
      // El tabulador es lo que deja Excel al copiar dos celdas. Colapsar todo
      // espacio las volvía un solo monto y esta función firmaba un `15002` que
      // parece plausible; sin colapsarlo no pasa por monto y sigue de largo.
      expect(parseMontoPegado('1.500\t2.000', clp)).toEqual({ tipo: 'sin-cambios' })
      expect(parseMontoPegado('1.500 2.000', clp)).toEqual({ tipo: 'sin-cambios' })
    })

    it('pero el espacio que SÍ agrupa se saca: "1 234 567"', () => {
      // Y sale `corregido`, no `sin-cambios`: si hubo que normalizar para poder
      // juzgar, dejar pasar el texto original le daría a la máscara los espacios
      // que esta función acaba de sacar.
      expect(parseMontoPegado('1 234 567', clp)).toEqual({
        tipo: 'corregido',
        texto: '1234567',
      })
      expect(parseMontoPegado('1 234 567,5', uf)).toEqual({
        tipo: 'corregido',
        texto: '1234567,5',
      })
    })

    it('el signo tampoco: la máscara es `unsigned` y lo iba a tirar igual', () => {
      expect(parseMontoPegado('-1000.5', clp)).toEqual({ tipo: 'rechazado' })
    })
  })

  it('el símbolo y los espacios no cambian el veredicto', () => {
    expect(parseMontoPegado(' $1.500 ', clp)).toEqual({ tipo: 'sin-cambios' })
  })

  it('lo que no es un monto se deja pasar: que lo descarte la máscara', () => {
    expect(parseMontoPegado('hola', clp)).toEqual({ tipo: 'sin-cambios' })
    expect(parseMontoPegado('', clp)).toEqual({ tipo: 'sin-cambios' })
  })
})
