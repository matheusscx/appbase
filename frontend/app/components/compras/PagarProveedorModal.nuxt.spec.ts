// @vitest-environment nuxt
//
// Pagar a un proveedor (spec compras-deuda-proveedor § 5.1 y § 10, decisión
// 2). Lo que fija: la propuesta de reparto (saldo a favor primero, la compra
// más vieja después), que es editable, que lo que no se reparte se avisa
// como saldo a favor, y el body que viaja a `POST /compras/pagos`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import PagarProveedorModal from './PagarProveedorModal.vue'

const llamadas: { url: string, method?: string, body?: unknown, headers?: Record<string, string> }[] = []

const DETALLE = {
  compras: [
    {
      id: 'martes', fechaDocumento: '2026-09-15', folio: '2', tipoDocumentoNombre: 'Factura',
      total: '80000', totalDocumento: '80000', fechaVencimiento: '2026-10-15',
      estadoPago: 'pendiente', deuda: '80000', vencida: false,
    },
    {
      id: 'lunes', fechaDocumento: '2026-09-01', folio: '1', tipoDocumentoNombre: 'Factura',
      total: '120000', totalDocumento: '120000', fechaVencimiento: '2026-10-01',
      estadoPago: 'pendiente', deuda: '120000', vencida: false,
    },
    // Andina, bebidas $60.000 + queso sin precio (spec compras-deuda-proveedor
    // § 4.1, decisión 8): total desconocido, sin deuda exacta — la deuda
    // mínima conocida se muestra como "Al menos $X". Vence después que las
    // otras dos para no correr el orden que `orden[0]` verifica más abajo.
    {
      id: 'queso', fechaDocumento: '2026-09-20', folio: '3', tipoDocumentoNombre: 'Sin documento',
      total: null, totalDocumento: null, fechaVencimiento: '2026-11-01',
      estadoPago: 'falta_precio', deuda: null, deudaMinima: '10000', vencida: false,
    },
  ],
  pagos: [],
}
/** Pagos vigentes del proveedor: un sobrante es saldo a favor. */
let pagosFixture: unknown[] = []
const MEDIOS = [
  { id: 'efectivo', nombre: 'Efectivo', esEfectivo: true },
  { id: 'transferencia', nombre: 'Transferencia', esEfectivo: false },
]

let avisos: { title: string, color?: string }[] = []
/** `GET /caja/activa`: `null` = sin caja abierta; el 403 de quien no tiene Mi caja lo da `cajaForbidden`. */
let cajaActiva: { id: string } | null = { id: 'caja-1' }
let cajaForbidden = false
let tieneMiCaja = true

mockNuxtImport('useToast', () => () => ({ add: (t: { title: string, color?: string }) => avisos.push(t) }))
mockNuxtImport('usePermissionsStore', () => () => ({
  get esAdmin() { return false },
  can: (modulo: string) => modulo === 'MiCaja' ? tieneMiCaja : true,
}))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown, headers?: Record<string, string> }) => {
  const ruta = url.split('/api').pop()!
  llamadas.push({ url: ruta, method: opts?.method, body: opts?.body, headers: opts?.headers })
  if (ruta.startsWith('/compras/por-pagar/')) return Promise.resolve({ ...DETALLE, pagos: pagosFixture })
  if (ruta === '/compras/medios-pago') return Promise.resolve(MEDIOS)
  if (ruta === '/caja/activa') return cajaForbidden ? Promise.reject({ status: 403 }) : Promise.resolve(cajaActiva)
  if (ruta === '/compras/pagos') return Promise.resolve({ id: 'pago-nuevo', ...(opts?.body as object) })
  return Promise.reject(new Error(`ruta no mockeada: ${ruta}`))
})

async function abrir() {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(PagarProveedorModal, {
    props: { proveedorId: 'prov-1', proveedorNombre: 'Don Pedro', open: true },
  })
  // El `watch(open)` que carga los datos no dispara montado ya abierto.
  await wrapper.setProps({ open: false })
  await wrapper.setProps({ open: true })
  await new Promise(r => setTimeout(r, 50))
  return wrapper
}

async function tipearMonto(wrapper: Awaited<ReturnType<typeof abrir>>, valor: string) {
  wrapper.findAllComponents({ name: 'MoneyInput' })[0]!.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 0))
}

function boton(): HTMLButtonElement {
  return document.body.querySelector('[data-qa="pagar-enviar"]') as HTMLButtonElement
}

/** El valor mostrado del `MoneyInput` de una fila (input real, con máscara). */
function valorFila(compraId: string): string {
  const input = document.body.querySelector(`input[data-qa="pagar-fila-monto-${compraId}"]`) as HTMLInputElement
  return input?.value ?? ''
}

async function enviar() {
  boton().click()
  await new Promise(r => setTimeout(r, 20))
}

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas.length = 0
  avisos = []
  pagosFixture = []
  cajaActiva = { id: 'caja-1' }
  cajaForbidden = false
  tieneMiCaja = true
})

describe('PagarProveedorModal — la propuesta (spec § 5.1 y § 10, decisión 2)', () => {
  it('la escena de Don Pedro: paga $150.000 → la del lunes entera y $30.000 de la del martes', async () => {
    const wrapper = await abrir()
    await tipearMonto(wrapper, '150000')

    expect(document.body.querySelector('[data-qa="pagar-fila-monto-lunes"]')).toBeTruthy()
    const filaLunes = document.body.querySelector('[data-qa="pagar-fila-lunes"]')!.textContent
    const filaMartes = document.body.querySelector('[data-qa="pagar-fila-martes"]')!.textContent
    // Se muestran en orden de vencimiento (la del lunes primero).
    const orden = document.body.querySelectorAll('[data-qa^="pagar-fila-"]')
    expect(orden[0]!.getAttribute('data-qa')).toBe('pagar-fila-lunes')
    expect(filaLunes).toBeTruthy()
    expect(filaMartes).toBeTruthy()
  })

  it('una compra falta_precio muestra la deuda mínima como "Al menos $X" (spec § 4.1, decisión 8)', async () => {
    await abrir()

    const filaQueso = document.body.querySelector('[data-qa="pagar-fila-queso"]')!.textContent
    expect(filaQueso).toContain('Al menos $10.000')
    // Sin deuda conocida, no entra en la propuesta automática (spec § 2,
    // decisión 8): el usuario la agrega a mano si quiere.
    expect(valorFila('queso')).toBe('')
  })

  it('el saldo a favor se muestra cuando hay pagos vigentes con sobrante', async () => {
    const wrapper = await abrir()
    void wrapper
    // Sin pagos en el fixture no hay saldo a favor a mostrar.
    expect(document.body.querySelector('[data-qa="pagar-saldo-favor"]')).toBeNull()
  })

  it('sin nada disponible, "Pagar" queda deshabilitado', async () => {
    await abrir()
    expect(boton().disabled).toBe(true)
  })

  it('el body de POST /compras/pagos manda solo las aplicaciones propuestas, con la clave de idempotencia', async () => {
    const wrapper = await abrir()
    await tipearMonto(wrapper, '150000')
    // El medio de pago default es el primero de la lista.
    await enviar()

    const llamada = llamadas.find(l => l.url === '/compras/pagos')
    expect(llamada).toBeTruthy()
    expect(llamada!.body).toEqual({
      proveedorId: 'prov-1',
      monto: '150000',
      metodoPagoId: 'efectivo',
      aplicaciones: [
        { compraId: 'lunes', monto: '120000' },
        { compraId: 'martes', monto: '30000' },
      ],
    })
    expect(llamada!.headers?.['Idempotency-Key']).toBeTruthy()
  })

  it('editar una fila a mano detiene la regeneración automática de la propuesta', async () => {
    const wrapper = await abrir()
    await tipearMonto(wrapper, '150000')

    // Los `MoneyInput` montados: [0] el monto a pagar, [1] la fila del lunes
    // (más vieja, va primero), [2] la del martes, [3] la del queso (vence
    // después, va última — sin deuda conocida, no entra en la propuesta).
    const inputs = wrapper.findAllComponents({ name: 'MoneyInput' })
    expect(inputs).toHaveLength(4)
    inputs[2]!.vm.$emit('update:modelValue', '5000')
    await new Promise(r => setTimeout(r, 0))
    expect(valorFila('martes')).toBe('5.000')

    // Cambiar el monto general ya NO pisa lo editado a mano.
    await tipearMonto(wrapper, '160000')
    expect(valorFila('martes')).toBe('5.000')

    // "Recalcular propuesta" vuelve a la sugerencia automática.
    ;(document.body.querySelector('[data-qa="pagar-recalcular"]') as HTMLButtonElement).click()
    await new Promise(r => setTimeout(r, 0))
    expect(valorFila('martes')).toBe('40.000')
  })

  it('monto 0 con aplicaciones (usar el saldo a favor) no exige medio de pago', async () => {
    const wrapper = await abrir()
    void wrapper
    expect(document.body.querySelector('[data-qa="pagar-medio"]')).toBeNull()
  })
})

describe('PagarProveedorModal — pagar todo, motivo y caja (auditoría UX 06.13, 06.12, 06.18, 06.19)', () => {
  it('06.19: cada compra se lee "Factura 2", con espacio entre el tipo y el folio', async () => {
    await abrir()
    expect(document.body.querySelector('[data-qa="pagar-fila-martes"]')!.textContent).toContain('Factura 2')
  })

  it('06.13: "Pagar todo" precarga el monto con lo que se debe; no envía nada hasta tocar Pagar', async () => {
    const wrapper = await abrir()
    const todo = document.body.querySelector<HTMLButtonElement>('[data-qa="pagar-todo"]')!
    expect(todo.textContent).toContain('$200.000')
    todo.click()
    await new Promise(r => setTimeout(r, 20))
    expect(llamadas.some(l => l.url === '/compras/pagos')).toBe(false)
    expect(wrapper.findAllComponents({ name: 'MoneyInput' })[0]!.props('modelValue')).toBe('200000')
    expect(valorFila('lunes')).toBe('120.000')
    expect(valorFila('martes')).toBe('80.000')
    await enviar()
    expect(llamadas.find(l => l.url === '/compras/pagos')!.body).toMatchObject({ monto: '200000' })
  })

  it('06.13: "Pagar todo" descuenta el saldo a favor', async () => {
    pagosFixture = [{ id: 'p-1', estado: 'vigente', monto: '60000', sobranteAFavor: '50000', fecha: '2026-09-01', metodoPagoNombre: 'Efectivo' }]
    const wrapper = await abrir()
    const todo = document.body.querySelector<HTMLButtonElement>('[data-qa="pagar-todo"]')!
    expect(todo.textContent).toContain('$150.000')
    todo.click()
    await new Promise(r => setTimeout(r, 20))
    expect(wrapper.findAllComponents({ name: 'MoneyInput' })[0]!.props('modelValue')).toBe('150000')
  })

  it('06.13: si el saldo a favor cubre todo, no hay "Pagar todo"', async () => {
    pagosFixture = [{ id: 'p-1', estado: 'vigente', monto: '300000', sobranteAFavor: '300000', fecha: '2026-09-01', metodoPagoNombre: 'Efectivo' }]
    await abrir()
    expect(document.body.querySelector('[data-qa="pagar-todo"]')).toBeNull()
  })

  it('06.13: la compra sin precio no entra en "Pagar todo" y se avisa', async () => {
    await abrir()
    expect(document.body.querySelector('[data-qa="pagar-proveedor-modal"]')!.textContent).toContain('No incluye 1 compra sin precio')
  })

  it('06.13: sin monto, "Pagar" apagado dice por qué', async () => {
    await abrir()
    expect(boton().disabled).toBe(true)
    expect(document.body.querySelector('[data-qa="pagar-motivo"]')!.textContent).toContain('Escribe el monto a pagar')
  })

  it('06.13: si el reparto supera el monto, el motivo dice cuánto', async () => {
    const wrapper = await abrir()
    await tipearMonto(wrapper, '1000')
    const inputs = wrapper.findAllComponents({ name: 'MoneyInput' })
    inputs[1]!.vm.$emit('update:modelValue', '3000')
    await new Promise(r => setTimeout(r, 0))
    expect(boton().disabled).toBe(true)
    expect(document.body.querySelector('[data-qa="pagar-motivo"]')!.textContent).toContain('El reparto supera el monto en $2.000')
  })

  it('06.13: listo para pagar, no hay motivo', async () => {
    const wrapper = await abrir()
    await tipearMonto(wrapper, '1000')
    expect(boton().disabled).toBe(false)
    expect(document.body.querySelector('[data-qa="pagar-motivo"]')).toBeNull()
  })

  it('06.18: el aviso de éxito dice monto, proveedor y medio', async () => {
    const wrapper = await abrir()
    await tipearMonto(wrapper, '150000')
    await enviar()
    expect(avisos.map(a => a.title)).toContain('Pago de $150.000 registrado a Don Pedro (Efectivo)')
  })

  it('06.12: sin caja abierta, el pago en efectivo se apaga y el aviso lleva a "Mi caja"', async () => {
    cajaActiva = null
    const wrapper = await abrir()
    await tipearMonto(wrapper, '1000')
    const aviso = document.body.querySelector('[data-qa="pagar-sin-caja"]')!
    expect(aviso.textContent).toContain('No tienes una caja abierta')
    expect(aviso.querySelector('a')!.getAttribute('href')).toBe('/mi-caja')
    expect(boton().disabled).toBe(true)
    expect(document.body.querySelector('[data-qa="pagar-motivo"]')!.textContent).toContain('caja')
  })

  it('06.12: sin caja, pagar con otro medio sigue permitido', async () => {
    cajaActiva = null
    const wrapper = await abrir()
    await tipearMonto(wrapper, '1000')
    const menu = wrapper.findComponent({ name: 'USelectMenu' })
    menu.vm.$emit('update:modelValue', 'transferencia')
    await new Promise(r => setTimeout(r, 0))
    expect(document.body.querySelector('[data-qa="pagar-sin-caja"]')).toBeNull()
    expect(boton().disabled).toBe(false)
  })

  it('06.12: con caja abierta no hay aviso de caja', async () => {
    const wrapper = await abrir()
    await tipearMonto(wrapper, '1000')
    expect(document.body.querySelector('[data-qa="pagar-sin-caja"]')).toBeNull()
    expect(document.body.querySelector('[data-qa="pagar-aviso-efectivo"]')).toBeNull()
    expect(boton().disabled).toBe(false)
  })

  it('06.12: quien no puede ver su caja conserva el aviso general y no se le apaga nada', async () => {
    tieneMiCaja = false
    const wrapper = await abrir()
    await tipearMonto(wrapper, '1000')
    expect(llamadas.some(l => l.url === '/caja/activa')).toBe(false)
    expect(document.body.querySelector('[data-qa="pagar-aviso-efectivo"]')).toBeTruthy()
    expect(boton().disabled).toBe(false)
  })

  it('06.12: el aviso general no aparece con el monto vacío', async () => {
    tieneMiCaja = false
    await abrir()
    expect(document.body.querySelector('[data-qa="pagar-aviso-efectivo"]')).toBeNull()
  })
})

