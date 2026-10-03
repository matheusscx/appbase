import { describe, it, expect } from 'vitest'
import {
  avisoNotaRepetida,
  claveOpcion,
  comprobanteDelPago,
  cuerpoDevolucion,
  cuerpoCompletarNumero,
  documentoPreguntado,
  estadoDocumento,
  etiquetaEmisor,
  etiquetaTipo,
  FILTRO_DOCUMENTO_ITEMS,
  leyendaCorrige,
  leyendaDescarte,
  leyendaNumeroBorrado,
  puedeBorrarNumero,
  puedeCompletarNumero,
  registroQueQueda,
  topeDeOpcion,
  resumenEmisores,
  type DocumentoVenta,
  type OpcionDevolucion,
} from './useDocumentosVenta'

function doc(parcial: Partial<DocumentoVenta> = {}): DocumentoVenta {
  return {
    id: 'doc-1',
    ventaId: 'v-1',
    emisor: 'sistema',
    tipoDocumento: { id: 'td-39', codigo: '39', nombre: 'Boleta de Venta' },
    claseMaquina: null,
    numero: null,
    estadoEnvio: 'armado',
    monto: '60000.0000',
    pagoId: null,
    documentoCorregidoId: null,
    esDuplicado: false,
    descarte: null,
    descartadoEl: null,
    descartadoPorNombre: null,
    numerosBorrados: [],
    ...parcial,
  }
}

describe('etiquetas de los documentos', () => {
  it('quién lo emitió, con las palabras del comercio', () => {
    expect(etiquetaEmisor('sistema')).toBe('El sistema')
    expect(etiquetaEmisor('maquina')).toBe('La máquina')
    expect(etiquetaEmisor('externo')).toBe('Hecho por fuera')
    expect(etiquetaEmisor('nadie')).toBe('Nadie')
  })

  it('un emisor que el front no conoce se muestra crudo, no rompe', () => {
    expect(etiquetaEmisor('integracion')).toBe('integracion')
  })

  it('el tipo: la clase con la máquina, el del catálogo con el sistema o por fuera', () => {
    expect(etiquetaTipo(doc({ emisor: 'maquina', tipoDocumento: null, claseMaquina: 'voucher' }))).toBe('Voucher')
    expect(etiquetaTipo(doc({ emisor: 'maquina', tipoDocumento: null, claseMaquina: 'boleta' }))).toBe('Boleta de la máquina')
    expect(etiquetaTipo(doc({ emisor: 'maquina', tipoDocumento: null, claseMaquina: null }))).toBe('Comprobante')
    expect(etiquetaTipo(doc())).toBe('Boleta de Venta')
    expect(etiquetaTipo(doc({ emisor: 'externo', tipoDocumento: { id: 'td-33', codigo: '33', nombre: 'Factura' } }))).toBe('Factura')
    expect(etiquetaTipo(doc({ emisor: 'nadie', tipoDocumento: null }))).toBe('Sin documento')
  })
})

describe('estado del documento', () => {
  it('uno del sistema dice que está armado y no salió al SII', () => {
    expect(estadoDocumento(doc())).toBe('Armado, sin enviar al SII')
  })

  it('un descartado manda sobre cualquier otro estado', () => {
    expect(estadoDocumento(doc({ descarte: 'armado_sin_enviar' }))).toBe('Descartado al anular')
    expect(estadoDocumento(doc({ emisor: 'externo', descarte: 'afirmado_no_hecho' }))).toBe('Descartado al anular')
  })

  it('la máquina y lo hecho por fuera no llevan estado de envío', () => {
    expect(estadoDocumento(doc({ emisor: 'maquina', estadoEnvio: null }))).toBeNull()
    expect(estadoDocumento(doc({ emisor: 'externo', estadoEnvio: null }))).toBeNull()
  })

  it('quién afirmó que no estaba hecho, y cuándo', () => {
    const d = doc({ emisor: 'externo', descarte: 'afirmado_no_hecho', descartadoPorNombre: 'Ana Torres' })
    expect(leyendaDescarte(d, '2 oct 2026')).toBe('Ana Torres dijo que no estaba hecho, 2 oct 2026')
  })

  it('el descarte de un armado no cuenta quién lo dijo: nadie lo dijo', () => {
    expect(leyendaDescarte(doc({ descarte: 'armado_sin_enviar' }), '2 oct 2026')).toBeNull()
  })
})

describe('Completar número', () => {
  it('se ofrece en los de la máquina y los hechos por fuera sin número', () => {
    expect(puedeCompletarNumero(doc({ emisor: 'maquina', estadoEnvio: null }))).toBe(true)
    expect(puedeCompletarNumero(doc({ emisor: 'externo', estadoEnvio: null }))).toBe(true)
  })

  it('también en el voucher duplicado del abono: es de la máquina', () => {
    expect(puedeCompletarNumero(doc({ emisor: 'maquina', esDuplicado: true }))).toBe(true)
  })

  it('no en los del sistema ni en la fila "nadie"', () => {
    expect(puedeCompletarNumero(doc())).toBe(false)
    expect(puedeCompletarNumero(doc({ emisor: 'nadie' }))).toBe(false)
  })

  it('no si ya tiene número, ni si fue descartado (el backend responde 404)', () => {
    expect(puedeCompletarNumero(doc({ emisor: 'maquina', numero: '445566' }))).toBe(false)
    expect(puedeCompletarNumero(doc({ emisor: 'externo', descarte: 'afirmado_no_hecho' }))).toBe(false)
  })

  it('el body lleva el número sin espacios y la clase solo con la máquina y si se eligió', () => {
    const maquina = doc({ emisor: 'maquina' })
    expect(cuerpoCompletarNumero(maquina, '  445566  ', 'voucher')).toEqual({ numero: '445566', clase: 'voucher' })
    expect(cuerpoCompletarNumero(maquina, '445566', undefined)).toEqual({ numero: '445566' })
    // Con un documento hecho por fuera el servidor responde 400 si llega `clase`.
    expect(cuerpoCompletarNumero(doc({ emisor: 'externo' }), '77', 'voucher')).toEqual({ numero: '77' })
  })
})

describe('Borrar número', () => {
  it('se ofrece solo en un documento hecho por fuera, vigente y con número', () => {
    expect(puedeBorrarNumero(doc({ emisor: 'externo', numero: 'F-4471', estadoEnvio: null }))).toBe(true)
  })

  it('no en uno sin número: no hay nada que borrar (el backend responde 400)', () => {
    expect(puedeBorrarNumero(doc({ emisor: 'externo', numero: null }))).toBe(false)
    expect(puedeBorrarNumero(doc({ emisor: 'externo', numero: '   ' }))).toBe(false)
  })

  it('no en el de la máquina, el del sistema ni la fila "nadie": el backend responde 404', () => {
    expect(puedeBorrarNumero(doc({ emisor: 'maquina', numero: '445566' }))).toBe(false)
    expect(puedeBorrarNumero(doc({ emisor: 'sistema', numero: '1' }))).toBe(false)
    expect(puedeBorrarNumero(doc({ emisor: 'nadie', numero: '1' }))).toBe(false)
  })

  it('no en uno descartado al anular (el backend responde 404)', () => {
    expect(puedeBorrarNumero(doc({ emisor: 'externo', numero: 'F-1', descarte: 'afirmado_no_hecho' }))).toBe(false)
  })

  it('el registro dice quién lo borró, qué número era y cuándo', () => {
    const borrado = { numeroAnterior: 'F-4471', borradoEl: '2026-10-02T15:00:00.000Z', borradoPorNombre: 'Ana Torres' }
    expect(leyendaNumeroBorrado(borrado, '2 oct 2026')).toBe('Ana Torres borró el número F-4471, 2 oct 2026')
    // La cuenta de quien lo borró puede haberse dado de baja: se dice igual.
    expect(leyendaNumeroBorrado({ ...borrado, borradoPorNombre: null }, '2 oct 2026')).toBe('Alguien borró el número F-4471, 2 oct 2026')
  })
})

describe('el comprobante de un pago del cobro', () => {
  it('con un medio de la máquina viaja el número sin espacios y la clase', () => {
    expect(comprobanteDelPago('maquina', '  A-123  ', 'boleta'))
      .toEqual({ numeroDocumento: 'A-123', claseDocumento: 'boleta' })
  })

  it('es opcional: lo que el cajero no tipeó no viaja (ni vacío ni en blanco)', () => {
    expect(comprobanteDelPago('maquina', undefined, undefined)).toEqual({})
    expect(comprobanteDelPago('maquina', '   ', undefined)).toEqual({})
    expect(comprobanteDelPago('maquina', '', 'voucher')).toEqual({ claseDocumento: 'voucher' })
  })

  it('con cualquier otro medio no viaja nada, aunque se haya tipeado antes de cambiar', () => {
    expect(comprobanteDelPago('sistema', 'A-123', 'voucher')).toEqual({})
    expect(comprobanteDelPago('nadie', 'A-123', 'voucher')).toEqual({})
    expect(comprobanteDelPago(undefined, 'A-123', 'voucher')).toEqual({})
  })
})

describe('qué corrige una corrección', () => {
  const original = doc({ id: 'doc-m', emisor: 'maquina', tipoDocumento: null, claseMaquina: 'voucher', numero: '4455' })

  it('dice el documento corregido, con su número', () => {
    const nc = doc({ id: 'doc-nc', documentoCorregidoId: 'doc-m' })
    expect(leyendaCorrige(nc, [original, nc])).toBe('Corrige: La máquina · Voucher · N° 4455')
  })

  it('si el corregido no vino en la lista, lo dice igual', () => {
    expect(leyendaCorrige(doc({ documentoCorregidoId: 'otro' }), [])).toBe('Corrige otro documento')
  })

  it('un documento que no corrige nada no dice nada', () => {
    expect(leyendaCorrige(original, [original])).toBeNull()
  })
})

describe('la pregunta de anular', () => {
  it('"esta factura" si el tipo no es boleta, "este documento" si lo es', () => {
    expect(documentoPreguntado(false)).toBe('esta factura')
    expect(documentoPreguntado(true)).toBe('este documento')
  })

  it('sin dato del backend, lo seguro es nombrarla factura', () => {
    expect(documentoPreguntado(null)).toBe('esta factura')
    expect(documentoPreguntado(undefined)).toBe('esta factura')
  })
})

describe('la devolución interna se rotula como lo que es', () => {
  it('la fila nadie que corrige algo es una "Devolución interna", no "Sin documento"', () => {
    expect(etiquetaTipo(doc({ emisor: 'nadie', tipoDocumento: null, documentoCorregidoId: 'orig' })))
      .toBe('Devolución interna')
  })

  it('la fila nadie de una venta sigue siendo "Sin documento"', () => {
    expect(etiquetaTipo(doc({ emisor: 'nadie', tipoDocumento: null }))).toBe('Sin documento')
  })
})

describe('por dónde vuelve la plata (opcionesDevolucion)', () => {
  const opcion = (parcial: Partial<OpcionDevolucion> = {}): OpcionDevolucion => ({
    pagoId: 'pago-1',
    sinPlata: false,
    metodo: 'Efectivo',
    monto: '60000.0000',
    mueveCaja: true,
    registro: 'nota_credito_sistema',
    ...parcial,
  })

  it('manda el pago elegido, o sinPlata: nunca el documento', () => {
    expect(cuerpoDevolucion(opcion())).toEqual({ pagoId: 'pago-1' })
    expect(cuerpoDevolucion(opcion({ pagoId: null, sinPlata: true, metodo: null }))).toEqual({ sinPlata: true })
  })

  it('una opción rota (ni pago ni sinPlata) no se manda', () => {
    expect(() => cuerpoDevolucion(opcion({ pagoId: null }))).toThrow()
  })

  it('la clave distingue cada pago y "no vuelve plata"', () => {
    expect(claveOpcion(opcion({ pagoId: 'a' }))).toBe('a')
    expect(claveOpcion(opcion({ pagoId: null, sinPlata: true }))).toBe('sin-plata')
  })

  it('el tope de una opción es lo menor entre lo disponible y lo que ella admite', () => {
    // La tarjeta trajo 40.000 y por ella ya volvieron 15.000: quedan 25.000.
    expect(topeDeOpcion('85000.0000', opcion({ monto: '25000.0000' }))).toBe('25000')
    // Lo disponible de la venta manda si es menor.
    expect(topeDeOpcion('11900.0000', opcion({ monto: '60000.0000' }))).toBe('11900')
    // Sin opción elegida, lo disponible.
    expect(topeDeOpcion('11900.0000', null)).toBe('11900')
  })

  it('dice en una línea qué registro va a quedar, por cada tipo', () => {
    expect(registroQueQueda('nota_credito_sistema')).toMatch(/armada por el sistema/)
    expect(registroQueQueda('nota_maquina')).toMatch(/máquina.*después/)
    expect(registroQueQueda('nota_externa')).toMatch(/hecha por fuera/)
    expect(registroQueQueda('devolucion_interna')).toMatch(/sin documento tributario/)
    expect(registroQueQueda('nota_credito')).toBe('Una nota de crédito.')
  })

  it('un registro que este front no conoce no rompe', () => {
    expect(registroQueQueda('otro')).toBe('Una corrección de la venta.')
  })
})

describe('filtro y resumen de emisores del listado de ventas', () => {
  it('las opciones del filtro son los seis valores del backend, en ese orden', () => {
    expect(FILTRO_DOCUMENTO_ITEMS.map(o => o.value)).toEqual([
      'sistema', 'maquina', 'externo', 'sin_numero', 'sin_documento', 'duplicado',
    ])
    expect(FILTRO_DOCUMENTO_ITEMS.map(o => o.label)).toEqual([
      'Del sistema', 'De la máquina', 'Hecho por fuera', 'Sin número', 'Sin documento', 'Voucher duplicado',
    ])
  })

  it('resumenEmisores une los emisores y avisa solo cuando alguno es "nadie"', () => {
    expect(resumenEmisores(['maquina', 'sistema'])).toEqual({ label: 'Máquina + Sistema', color: 'neutral' })
    expect(resumenEmisores(['externo'])).toEqual({ label: 'Por fuera', color: 'neutral' })
    expect(resumenEmisores(['nadie'])).toEqual({ label: 'Sin documento', color: 'warning' })
    expect(resumenEmisores(['nadie', 'sistema'])?.color).toBe('warning')
  })

  it('sin emisores no hay nada que decir, y un emisor que el front no conoce se muestra crudo', () => {
    expect(resumenEmisores([])).toBeNull()
    expect(resumenEmisores(['otro'])?.label).toBe('otro')
  })
})

describe('avisoNotaRepetida — la nota ya había entrado: qué falta hacer (owner, 2026-10-03)', () => {
  const opcion = (o: Partial<OpcionDevolucion>): OpcionDevolucion => ({
    pagoId: 'p-1',
    sinPlata: false,
    metodo: 'Efectivo',
    monto: '3000.0000',
    mueveCaja: true,
    registro: 'nota_credito_sistema',
    ...o,
  })

  it('en efectivo: la salida ya está en la caja, entregar los billetes si no se entregaron', () => {
    const aviso = avisoNotaRepetida(opcion({}), '$3.000')
    expect(aviso).toContain('no se emitió dos veces')
    expect(aviso).toContain('La salida de $3.000 ya está registrada')
    expect(aviso).toContain('entregale los billetes')
  })

  it('por otro pago: la devolución en ese medio, una sola vez', () => {
    const aviso = avisoNotaRepetida(opcion({ metodo: 'Tarjeta de débito', mueveCaja: false }), '$3.000')
    expect(aviso).toContain('por Tarjeta de débito, hacelo una sola vez')
    expect(aviso).not.toContain('billetes')
  })

  it('sin plata (o sin opción): solo que no se emitió dos veces', () => {
    const base = 'Esta nota de crédito ya estaba emitida, no se emitió dos veces.'
    expect(avisoNotaRepetida(opcion({ sinPlata: true, pagoId: null, metodo: null, mueveCaja: false }), '$3.000')).toBe(base)
    expect(avisoNotaRepetida(null, '$3.000')).toBe(base)
  })
})
