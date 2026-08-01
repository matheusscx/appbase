// @vitest-environment nuxt
//
// Regresión del bug encontrado en el smoke test de Task 7: `eliminar()` sacaba
// la fila del array local incondicionalmente (`removeLocal`), incluso con "Ver
// eliminadas" activo. Resultado: borrar con el toggle prendido hacía
// desaparecer la fila del todo, justo el caso que el toggle existe para
// mostrar. El fix (`categorias.vue` → `eliminar()`) recarga desde el backend
// en vez de remover localmente cuando `verEliminados` está activo — este
// test prueba el síntoma observable, no la implementación.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Categorias from './categorias.vue'

mockNuxtImport('useImpresoras', () => {
  return () => ({ listar: () => Promise.resolve([]) })
})

const CATEGORIA_ID = 'cat-1'

function categoriaViva() {
  return {
    id: CATEGORIA_ID,
    nombre: 'Bebidas',
    aplicaA: 'ambos',
    activo: true,
    impresoraId: null,
    eliminadoEl: null as string | null,
    eliminadoPorNombre: null as string | null,
  }
}

// Estado del "backend" simulado: `DELETE` lo muta, `GET` lo lee filtrando por
// `incluirEliminados` igual que el controller real.
let categoriasBackend: ReturnType<typeof categoriaViva>[] = []

// Para el test de la carrera: retiene la respuesta de cada variante del `GET`
// (con/sin `incluirEliminados`) en una promesa que el test resuelve a mano, en
// el orden que quiera — mismo mecanismo que `impuestosPromiseOverride` en
// `items.nuxt.spec.ts` (a82bf72). `null` = comportamiento normal (resuelve
// contra `categoriasBackend`).
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string }) => {
    if (typeof url !== 'string' || !url.includes('/categorias')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      const cat = categoriasBackend.find(c => c.id === id)
      if (cat) {
        cat.eliminadoEl = '2026-07-31T21:00:00.000Z'
        cat.eliminadoPorNombre = 'admin.paris'
      }
      return Promise.resolve(undefined)
    }
    const incluirEliminados = url.includes('incluirEliminados=true')
    if (incluirEliminados && overrideConEliminados) return overrideConEliminados
    if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
    const data = incluirEliminados
      ? categoriasBackend
      : categoriasBackend.filter(c => !c.eliminadoEl)
    return Promise.resolve(data.map(c => ({ ...c })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Categorias)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

async function activarVerEliminadas(wrapper: Awaited<ReturnType<typeof montar>>) {
  await wrapper.find('[aria-label="Ver eliminadas"]').trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

/** El modal de confirmación lo teletransporta `UModal` fuera del wrapper. */
async function confirmarEnModal(texto: string) {
  const boton = [...document.body.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === texto)
  expect(boton, `botón "${texto}" en el modal`).toBeTruthy()
  boton!.click()
  await new Promise(r => setTimeout(r, 50))
}

describe('configuracion/categorias — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    categoriasBackend = [categoriaViva()]
  })

  it('con "Ver eliminadas" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    await activarVerEliminadas(wrapper)
    expect(wrapper.text()).toContain('Bebidas')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, esta aserción negativa de abajo pasaría vacuamente.
    expect(categoriasBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Bebidas')
    expect(wrapper.text()).toContain('Eliminada')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Bebidas')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Bebidas')

    wrapper.unmount()
  })
})

describe('configuracion/categorias — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    // Dos categorías: una viva y otra ya eliminada — así el `GET` con
    // `incluirEliminados=true` trae algo (Ropa, con badge) que el `GET` sin
    // el flag no trae, y las dos respuestas son distinguibles en el DOM.
    categoriasBackend = [
      categoriaViva(),
      {
        ...categoriaViva(),
        id: 'cat-2',
        nombre: 'Ropa',
        eliminadoEl: '2026-07-30T12:00:00.000Z',
        eliminadoPorNombre: 'admin.paris',
      },
    ]
    overrideConEliminados = null
    overrideSinEliminados = null
  })

  it('si la respuesta del primer toggle llega DESPUÉS que la del segundo, el listado final igual corresponde al último toggle', async () => {
    const wrapper = await montar()

    // 1) Prender "Ver eliminadas": dispara `cargar()` con `incluirEliminados=true`.
    //    Se retiene su respuesta con una promesa controlada — no resuelve todavía.
    let resolverConEliminados: (v: unknown[]) => void = () => {}
    overrideConEliminados = new Promise((resolve) => { resolverConEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminadas"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // 2) Apagar "Ver eliminadas" MIENTRAS la respuesta anterior sigue pendiente:
    //    dispara un segundo `cargar()`. Se retiene también su respuesta, para
    //    controlar a mano en qué orden "llegan" las dos.
    let resolverSinEliminados: (v: unknown[]) => void = () => {}
    overrideSinEliminados = new Promise((resolve) => { resolverSinEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminadas"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // 3) Resolver en el orden INVERSO al que se dispararon: la del segundo
    //    toggle (sin eliminados) responde primero; la del primero (con
    //    eliminados) responde después — el caso que la serialización tiene
    //    que blindar.
    resolverSinEliminados(
      categoriasBackend.filter(c => !c.eliminadoEl).map(c => ({ ...c })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(categoriasBackend.map(c => ({ ...c })))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado (solo categorías vivas), sin importar que la respuesta "con
    // eliminados" haya llegado después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Bebidas')
    expect(wrapper.text()).not.toContain('Ropa')
    expect(wrapper.text()).not.toContain('Eliminada')

    wrapper.unmount()
    overrideConEliminados = null
    overrideSinEliminados = null
  })
})
