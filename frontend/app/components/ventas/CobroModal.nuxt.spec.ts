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
    .find(b => b.textContent?.includes('Confirmar venta')) as HTMLButtonElement | undefined
  expect(boton, 'el botón Confirmar venta').toBeTruthy()
  expect(boton!.disabled, 'habilitado').toBe(false)
  boton!.click()
  await esperar()
  return wrapper.emitted('confirmar')!.at(-1) as [Record<string, unknown>[], string]
}

beforeEach(() => {
  document.body.innerHTML = ''
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
      .find(b => b.textContent?.includes('Confirmar venta')) as HTMLButtonElement

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
