// @vitest-environment nuxt
//
// El número del comprobante al cobrar (spec `2026-10-01-emision-por-venta`,
// § 3.4). Lo que se prueba es lo que el cajero ve y lo que sale en el evento:
//   1. Los dos campos aparecen SOLO en un pago cuyo medio emite con la máquina.
//   2. Lo tipeado viaja en el pago; lo que no se tipeó no viaja.
//   3. Un número tipeado antes de cambiar a un medio que no es de la máquina no
//      viaja: quedaría pegado a un pago que ninguna máquina emite.
//   4. La pantalla no ofrece elegir quién emite.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CobroModal from './CobroModal.vue'
import { useIntentoCobro } from '~/composables/useIntentoCobro'

interface Metodo {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
  emisor: 'sistema' | 'maquina' | 'nadie'
}

const TARJETA: Metodo = { metodoPagoId: 'mp-tarjeta', nombre: 'Tarjeta de débito', permiteVuelto: false, habilitada: true, emisor: 'maquina' }
const EFECTIVO: Metodo = { metodoPagoId: 'mp-efectivo', nombre: 'Efectivo', permiteVuelto: true, habilitada: true, emisor: 'sistema' }
const TRANSFERENCIA: Metodo = { metodoPagoId: 'mp-transf', nombre: 'Transferencia', permiteVuelto: false, habilitada: true, emisor: 'nadie' }

function dialogo(): HTMLElement {
  const d = document.body.querySelector('[role="dialog"]')
  expect(d, 'el modal abierto').toBeTruthy()
  return d as HTMLElement
}

async function esperar(ms = 50) {
  await new Promise(r => setTimeout(r, ms))
}

/** Monta cerrado y lo abre: el pago por defecto nace en el `watch(open)`. */
async function montar(metodos: Metodo[]) {
  const wrapper = await mountSuspended(CobroModal, {
    props: { total: '100000', metodos, open: false },
  })
  await wrapper.setProps({ open: true })
  await esperar()
  return wrapper
}

function escribirNumero(valor: string, indice = 0) {
  const inputs = dialogo().querySelectorAll<HTMLInputElement>('[data-qa="comprobante-numero"]')
  const input = inputs[indice]
  expect(input, `el campo de número del pago ${indice}`).toBeTruthy()
  input!.value = valor
  input!.dispatchEvent(new Event('input', { bubbles: true }))
}

async function confirmar(wrapper: Awaited<ReturnType<typeof montar>>) {
  const boton = [...dialogo().querySelectorAll('button')]
    .find(b => /^\s*Cobrar \$/.test(b.textContent ?? '')) as HTMLButtonElement | undefined
  expect(boton, 'el botón Cobrar').toBeTruthy()
  expect(boton!.disabled, 'habilitado').toBe(false)
  boton!.click()
  await esperar()
  return wrapper.emitted('confirmar')!.at(-1) as [Record<string, unknown>[], string]
}

const MONEDA_CLP = {
  monedaId: 'clp', nombre: 'Peso chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
  separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true, esOficial: true, valorDelDia: null,
}

beforeEach(() => {
  document.body.innerHTML = ''
  // Sin moneda oficial `formatMonto` rinde "—" y no se puede leer ningún monto.
  useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
})

describe('CobroModal — el número del comprobante de la máquina', () => {
  it('con un medio de la máquina aparecen el número y la clase', async () => {
    await montar([TARJETA, EFECTIVO])

    expect(dialogo().querySelector('[data-qa="comprobante-numero"]')).toBeTruthy()
    expect(dialogo().textContent).toContain('¿Voucher o boleta?')
  })

  it.each([
    ['del sistema', EFECTIVO],
    ['de nadie', TRANSFERENCIA],
  ])('con un medio %s no aparece nada', async (_nombre, medio) => {
    await montar([medio])

    expect(dialogo().querySelector('[data-qa="comprobante-campos"]')).toBeNull()
    expect(dialogo().querySelector('[data-qa="comprobante-numero"]')).toBeNull()
  })

  it('el cajero no elige quién emite: la pantalla no lo ofrece', async () => {
    await montar([TARJETA, EFECTIVO])

    const texto = dialogo().textContent ?? ''
    expect(texto).not.toMatch(/emite|emisor|facturador/i)
  })

  it('el número tipeado y la clase viajan en el pago', async () => {
    const wrapper = await montar([TARJETA, EFECTIVO])

    escribirNumero('  445566  ')
    wrapper.findComponent({ name: 'VentasDocumentoNumeroCampos' }).vm.$emit('update:clase', 'voucher')
    await esperar()
    const [pagos] = await confirmar(wrapper)

    expect(pagos).toEqual([{
      metodoPagoId: 'mp-tarjeta',
      monto: '100000',
      numeroDocumento: '445566',
      claseDocumento: 'voucher',
    }])
  })

  it('es opcional: sin tipear nada el pago sale sin número ni clase', async () => {
    const wrapper = await montar([TARJETA, EFECTIVO])

    const [pagos] = await confirmar(wrapper)

    expect(pagos).toEqual([{ metodoPagoId: 'mp-tarjeta', monto: '100000' }])
  })

  it('un número tipeado y después cambiado a otro medio no viaja', async () => {
    const wrapper = await montar([TARJETA, EFECTIVO])
    escribirNumero('445566')
    await esperar()

    // El cajero se arrepiente y elige efectivo: el campo desaparece, y lo que
    // había escrito no puede quedar pegado al pago en efectivo.
    ;(wrapper.vm as unknown as { pagos: { metodoPagoId: string }[] }).pagos[0]!.metodoPagoId = 'mp-efectivo'
    await esperar()
    expect(dialogo().querySelector('[data-qa="comprobante-numero"]')).toBeNull()
    const [pagos] = await confirmar(wrapper)

    expect(pagos).toEqual([{ metodoPagoId: 'mp-efectivo', monto: '100000' }])
  })

  it('cobro mixto: solo el pago de la máquina lleva número; el efectivo no', async () => {
    const wrapper = await montar([TARJETA, EFECTIVO])
    const vm = wrapper.vm as unknown as {
      pagos: { metodoPagoId: string, monto: string }[]
      setMonto: (i: number, monto: string) => void
      agregarPago: () => void
    }
    // 60.000 en efectivo + 40.000 con la tarjeta: montos que no son iguales ni 1.
    vm.setMonto(0, '40000')
    vm.agregarPago()
    await esperar()
    vm.pagos[1]!.metodoPagoId = 'mp-efectivo'
    await esperar()
    escribirNumero('778899', 0)
    const [pagos] = await confirmar(wrapper)

    expect(pagos).toEqual([
      { metodoPagoId: 'mp-tarjeta', monto: '40000', numeroDocumento: '778899' },
      { metodoPagoId: 'mp-efectivo', monto: '60000' },
    ])
  })
})

// La boleta sobre el umbral de la Res. Ex. SII 44/2025 lleva nombre y RUT de
// quien paga (owner, 2026-10-04): el voucher se registra igual y se avisa; en
// salones el modal pide a quien paga.
describe('CobroModal — boleta sobre el umbral de identidad', () => {
  async function montarCon(metodos: Metodo[], extra: Record<string, unknown>) {
    const wrapper = await mountSuspended(CobroModal, {
      props: { total: '6000000', metodos, open: false, ...extra },
    })
    await wrapper.setProps({ open: true })
    await esperar()
    return wrapper
  }
  const botonConfirmar = () =>
    [...dialogo().querySelectorAll('button')]
      .find(b => /^\s*Cobrar \$/.test(b.textContent ?? '')) as HTMLButtonElement

  it('avisa del voucher solo con un pago de la máquina', async () => {
    await montarCon([TARJETA, EFECTIVO], { sobreUmbralIdentidad: true })
    expect(dialogo().querySelector('[data-qa="aviso-voucher-umbral"]')).toBeTruthy()

    document.body.innerHTML = ''
    await montarCon([EFECTIVO, TARJETA], { sobreUmbralIdentidad: true })
    expect(dialogo().querySelector('[data-qa="aviso-voucher-umbral"]')).toBeNull()
  })

  it('bajo el umbral no avisa, aunque pague con la máquina', async () => {
    await montarCon([TARJETA], { sobreUmbralIdentidad: false })
    expect(dialogo().querySelector('[data-qa="aviso-voucher-umbral"]')).toBeNull()
  })

  it('pidiendo a quien paga: sin nombre y RUT válido no confirma; con ellos, sí', async () => {
    const wrapper = await montarCon([EFECTIVO], { pedirPagador: true, rutChileno: true })
    expect(dialogo().querySelector('[data-qa="pagador"]')).toBeTruthy()
    expect(botonConfirmar().disabled).toBe(true)

    await wrapper.setProps({ pagador: { nombre: 'Juana Pérez', rut: '12.345.678-9' } })
    await esperar()
    expect(botonConfirmar().disabled).toBe(true)

    await wrapper.setProps({ pagador: { nombre: 'Juana Pérez', rut: '12.345.678-5' } })
    await esperar()
    expect(botonConfirmar().disabled).toBe(false)
  })

  it('sin pedirPagador no hay formulario ni bloqueo', async () => {
    await montarCon([EFECTIVO], {})
    expect(dialogo().querySelector('[data-qa="pagador"]')).toBeNull()
    expect(botonConfirmar().disabled).toBe(false)
  })
})

// Auditoría UX 01.8: el tacho de quitar un pago no tenía nombre.
describe('CobroModal — quitar pago tiene nombre', () => {
  it('cada pago ofrece "Quitar pago N"', async () => {
    await montar([EFECTIVO])
    expect(dialogo().querySelector('button[aria-label="Quitar pago 1"]')).toBeTruthy()
  })
})

// Auditoría UX, frente de plata del cobro (01.2/02.9, 01.3, 01.4, 01.6/02.8,
// 01.7, 01.19). La propina se ofrece con atajos y NO viene sumada (owner,
// 2026-10-16); lo demás es cómo se ve y qué respeta el modal.
describe('CobroModal — propina con atajos, sin sumarla (01.2, 02.9)', () => {
  async function montarPropina(metodos: Metodo[], extra: Record<string, unknown> = {}) {
    const wrapper = await mountSuspended(CobroModal, {
      props: { total: '10000', ventaTotal: '10000', modoPropina: true, porcentajeSugerido: '0.10', metodos, open: false, ...extra },
    })
    await wrapper.setProps({ open: true })
    await esperar()
    return wrapper
  }
  const boton = (texto: string) =>
    [...dialogo().querySelectorAll('button')].find(b => b.textContent?.includes(texto)) as HTMLButtonElement | undefined
  const totalAPagar = () => {
    const rotulo = [...dialogo().querySelectorAll('span')].find(s => s.textContent?.trim() === 'Total a pagar')
    return rotulo?.nextElementSibling?.textContent?.replace(/\s/g, '')
  }

  it('abre sin propina: el total a pagar es el de la venta y el pago lo cubre justo', async () => {
    const wrapper = await montarPropina([EFECTIVO])

    expect(wrapper.emitted('update:propinaMonto')?.at(-1) ?? ['0']).toEqual(['0'])
    expect(totalAPagar()).toContain('10.000')
    expect(dialogo().textContent).toContain('Propina sugerida 10 %')
    expect(boton('Sin propina')).toBeTruthy()
    expect(boton('10 %')).toBeTruthy()
    expect(boton('Otro monto')).toBeTruthy()
    const [pagos] = await (async () => {
      boton('Cobrar $')!.click()
      await esperar()
      return wrapper.emitted('confirmar')!.at(-1) as [Record<string, unknown>[], string]
    })()
    expect(pagos).toEqual([{ metodoPagoId: 'mp-efectivo', monto: '10000.0000' }])
  })

  it('"10 %" suma la sugerida y el efectivo sin tocar la sigue', async () => {
    const wrapper = await montarPropina([EFECTIVO])

    boton('10 %')!.click()
    await esperar()

    expect(wrapper.emitted('update:propinaMonto')?.at(-1)).toEqual(['1000'])
    expect(totalAPagar()).toContain('11.000')
  })

  it('"Sin propina" la saca otra vez', async () => {
    const wrapper = await montarPropina([EFECTIVO])
    boton('10 %')!.click()
    await esperar()
    boton('Sin propina')!.click()
    await esperar()

    expect(wrapper.emitted('update:propinaMonto')?.at(-1)).toEqual(['0'])
  })

  it('"Otro monto" muestra el campo para tipearla', async () => {
    await montarPropina([EFECTIVO])
    expect(dialogo().querySelector('[data-qa="propina-monto"]')).toBeNull()

    boton('Otro monto')!.click()
    await esperar()

    expect(dialogo().querySelector('[data-qa="propina-monto"]')).toBeTruthy()
  })

  it.each([
    ['sugerido en 0 %', { porcentajeSugerido: '0' }],
    ['total tan chico que el 10 % redondea a 0', { ventaTotal: '4', total: '4' }],
  ])('con la propina habilitada y %s, "Sin propina" y "Otro monto" siguen y no hay atajo del sugerido', async (_caso, extra) => {
    await montarPropina([EFECTIVO], extra)

    expect(boton('Sin propina')).toBeTruthy()
    expect(boton('Otro monto')).toBeTruthy()
    expect(dialogo().querySelector('[data-qa="propina-sugerida"]')).toBeNull()
    boton('Otro monto')!.click()
    await esperar()
    expect(dialogo().querySelector('[data-qa="propina-monto"]')).toBeTruthy()
  })

  it('01.19: si no se pudo leer la configuración de propina, no hay propina y se dice', async () => {
    await montarPropina([EFECTIVO], { modoPropina: false, propinaNoDisponible: true })

    expect(dialogo().querySelector('[data-qa="aviso-propina-no-disponible"]')).toBeTruthy()
    expect(boton('Otro monto')).toBeUndefined()
  })

  it('01.19: apagada a propósito no avisa nada', async () => {
    await montarPropina([EFECTIVO], { modoPropina: false })
    expect(dialogo().querySelector('[data-qa="aviso-propina-no-disponible"]')).toBeNull()
  })
})

describe('CobroModal — lo tecleado no se pisa (01.4)', () => {
  it('cambiar la propina deja el efectivo que la cajera ya escribió', async () => {
    const wrapper = await mountSuspended(CobroModal, {
      props: { total: '10000', ventaTotal: '10000', modoPropina: true, metodos: [EFECTIVO], open: false },
    })
    await wrapper.setProps({ open: true })
    await esperar()
    const vm = wrapper.vm as unknown as { pagos: { monto: string }[], setMonto: (i: number, m: string) => void }
    vm.setMonto(0, '20000')

    ;[...dialogo().querySelectorAll('button')].find(b => b.textContent?.includes('10 %'))!.click()
    await esperar()

    expect(vm.pagos[0]!.monto).toBe('20000')
  })
})

describe('CobroModal — saldo pendiente y billetes (01.3)', () => {
  const botonConfirmar = () =>
    [...dialogo().querySelectorAll('button')].find(b => /Confirmar|^\s*Cobrar \$/.test(b.textContent ?? '')) as HTMLButtonElement
  const botonDe = (texto: string) =>
    [...dialogo().querySelectorAll('button')].find(b => b.textContent?.trim() === texto) as HTMLButtonElement | undefined

  it('pagar menos del total dice "Falta $…" y el botón pasa a "Confirmar con saldo pendiente"', async () => {
    const wrapper = await montar([EFECTIVO])
    ;(wrapper.vm as unknown as { setMonto: (i: number, m: string) => void }).setMonto(0, '99000')
    await esperar()

    const falta = dialogo().querySelector('[data-qa="falta"]')
    expect(falta?.textContent).toContain('Falta')
    expect(falta?.textContent).toContain('1.000')
    expect(falta?.className).toContain('text-warning')
    expect(botonConfirmar().textContent).toContain('Confirmar con saldo pendiente')
  })

  it('con el total cubierto el botón dice "Cobrar $X" con el total', async () => {
    await montar([EFECTIVO])
    expect(botonConfirmar().textContent?.replace(/\s/g, '')).toBe('Cobrar$100.000')
    expect(dialogo().querySelector('[data-qa="falta"]')).toBeNull()
  })

  it('el efectivo ofrece Exacto, $5.000, $10.000 y $20.000; la tarjeta no', async () => {
    await montar([TARJETA, EFECTIVO])
    expect(dialogo().querySelector('[data-qa="billetes-0"]'), 'tarjeta: sin billetes').toBeNull()

    document.body.innerHTML = ''
    await montar([EFECTIVO])
    const billetes = dialogo().querySelector('[data-qa="billetes-0"]')!
    expect([...billetes.querySelectorAll('button')].map(b => b.textContent?.replace(/\s/g, ''))).toEqual(
      ['Exacto', '$5.000', '$10.000', '$20.000'],
    )
  })

  it('un billete fija lo que entrega el cliente y dice lo que falta; Exacto lo cubre', async () => {
    const wrapper = await montar([EFECTIVO])

    botonDe('$20.000')!.click()
    await esperar()

    expect((wrapper.vm as unknown as { pagos: { monto: string }[] }).pagos[0]!.monto).toBe('20000')
    expect(dialogo().querySelector('[data-qa="falta"]')?.textContent).toContain('80.000')
    botonDe('Exacto')!.click()
    await esperar()
    expect((wrapper.vm as unknown as { pagos: { monto: string }[] }).pagos[0]!.monto).toBe('100000')
  })
})

describe('CobroModal — lo que se dice en voz alta se ve (01.6, 02.8) y se toca (01.7)', () => {
  it('Total a pagar y Vuelto van en text-2xl', async () => {
    await montar([EFECTIVO])
    const rotulo = [...dialogo().querySelectorAll('span')].find(s => s.textContent?.trim() === 'Total a pagar')!
    expect(rotulo.parentElement!.className).toContain('text-2xl')
    expect(dialogo().querySelector('[data-qa="vuelto"]')!.className).toContain('text-2xl')
  })

  it('Confirmar, Cancelar, Agregar pago y quitar pago miden 44 px', async () => {
    await montar([EFECTIVO])
    const porTexto = (t: string) => [...dialogo().querySelectorAll('button')].find(b => b.textContent?.includes(t))!
    for (const t of ['Cobrar $', 'Cancelar', 'Agregar pago']) {
      expect(porTexto(t).className, t).toContain('min-h-11')
    }
    expect(dialogo().querySelector('button[aria-label="Quitar pago 1"]')!.className).toContain('size-11')
    expect(dialogo().querySelector('button[aria-label="Método del pago 1"]')!.className).toContain('min-h-11')
  })
})

// El botón final dice cuánto se cobra, con la propina adentro (owner, 2026-10-17); y un
// reintento tras un corte vuelve con la propina que se eligió en el primer intento.
describe('CobroModal — "Cobrar $X" y la propina del reintento', () => {
  async function montarPropina(extra: Record<string, unknown> = {}) {
    const wrapper = await mountSuspended(CobroModal, {
      props: {
        total: '10000', ventaTotal: '10000', modoPropina: true, porcentajeSugerido: '0.10',
        metodos: [EFECTIVO], open: false, ambitoIntento: 'cuenta:prueba', ...extra,
      },
    })
    await wrapper.setProps({ open: true })
    await esperar()
    return wrapper
  }
  const boton = (texto: string) =>
    [...dialogo().querySelectorAll('button')].find(b => b.textContent?.includes(texto)) as HTMLButtonElement | undefined

  beforeEach(() => useIntentoCobro().terminar('cuenta:prueba'))

  it('el rótulo suma la propina elegida: $10.000 sin propina, $11.000 con la sugerida', async () => {
    await montarPropina()
    expect(boton('Cobrar $')!.textContent?.replace(/\s/g, '')).toBe('Cobrar$10.000')
    boton('10 %')!.click()
    await esperar()
    expect(boton('Cobrar $')!.textContent?.replace(/\s/g, '')).toBe('Cobrar$11.000')
  })

  it('con saldo pendiente sigue diciendo "Confirmar con saldo pendiente"', async () => {
    await montarPropina()
    boton('10 %')!.click()
    await esperar()
    const monto = dialogo().querySelector<HTMLInputElement>('input[inputmode="decimal"], input[type="text"]')
    expect(monto).toBeTruthy()
    monto!.value = '5000'
    monto!.dispatchEvent(new Event('input', { bubbles: true }))
    await esperar()
    expect(boton('Confirmar con saldo pendiente')).toBeTruthy()
  })

  it('reabrir tras confirmar con la sugerida vuelve con la sugerida, no con "Sin propina"', async () => {
    const wrapper = await montarPropina()
    boton('10 %')!.click()
    await esperar()
    boton('Cobrar $')!.click()
    await esperar()
    expect(wrapper.emitted('confirmar')).toHaveLength(1)
    // Como la pantalla: el POST sale y pide su cabecera. Antes de eso la propina no está recordada.
    useIntentoCobro().cabecera('cuenta:prueba')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await esperar()

    expect(wrapper.emitted('update:propinaMonto')?.at(-1)).toEqual(['1000'])
    expect(boton('Cobrar $')!.textContent?.replace(/\s/g, '')).toBe('Cobrar$11.000')
    expect(boton('10 %')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('confirmar y cancelar el PIN (el POST nunca sale): al reabrir vuelve "Sin propina"', async () => {
    useIntentoCobro().cabecera('cuenta:prueba') // un corte anterior dejó la clave viva
    const wrapper = await montarPropina()
    boton('10 %')!.click()
    await esperar()
    boton('Cobrar $')!.click()
    await esperar()
    expect(wrapper.emitted('confirmar')).toHaveLength(1)
    // No se pide cabecera: el teclado del PIN se canceló.

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await esperar()

    expect(wrapper.emitted('update:propinaMonto')?.at(-1)).toEqual(['0'])
    expect(boton('Cobrar $')!.textContent?.replace(/\s/g, '')).toBe('Cobrar$10.000')
  })

  it('un monto "otro" también vuelve; y sin intento vivo se abre en "Sin propina"', async () => {
    const wrapper = await montarPropina()
    useIntentoCobro().recordarPropina('cuenta:prueba', { seleccion: 'otro', monto: '1500' })
    useIntentoCobro().cabecera('cuenta:prueba')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await esperar()
    expect(wrapper.emitted('update:propinaMonto')?.at(-1)).toEqual(['1500'])
    expect(dialogo().querySelector('[data-qa="propina-monto"]')).toBeTruthy()

    useIntentoCobro().terminar('cuenta:prueba')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await esperar()
    expect(wrapper.emitted('update:propinaMonto')?.at(-1)).toEqual(['0'])
  })
})
