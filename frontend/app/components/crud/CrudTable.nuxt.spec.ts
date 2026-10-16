// @vitest-environment nuxt
//
// Lote 7 (07.3): la tarjeta de una lista distingue cargando, error, sin permiso y vacío.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CrudTable from './CrudTable.vue'

const columns = [{ accessorKey: 'nombre', header: 'Nombre' }]

function montar(props: Record<string, unknown>, slots: Record<string, string> = {}) {
  return mountSuspended(CrudTable, { props: { data: [], columns, ...props }, slots })
}

describe('CrudTable — estados sin filas', () => {
  it('cargando y sin filas: no dice "No hay …" todavía', async () => {
    const w = await montar({ loading: true }, { empty: '<p>No hay categorías registradas.</p>' })
    expect(w.text()).not.toContain('No hay categorías registradas.')
    expect(w.find('[data-qa="crud-cargando"]').exists()).toBe(true)
  })

  it('con la carga terminada y sin error, sí dice el vacío de la pantalla', async () => {
    const w = await montar({ loading: false }, { empty: '<p>No hay categorías registradas.</p>' })
    expect(w.text()).toContain('No hay categorías registradas.')
  })

  it('con error NO dice el vacío de la pantalla: dice que no pudo cargar y ofrece Reintentar', async () => {
    const w = await montar(
      { error: true, recurso: 'las categorías' },
      { empty: '<p>No hay categorías registradas.</p>' },
    )
    expect(w.text()).not.toContain('No hay categorías registradas.')
    expect(w.text()).toContain('No pudimos cargar las categorías')
    await w.find('[data-qa="estado-reintentar"]').trigger('click')
    expect(w.emitted('reintentar')).toHaveLength(1)
  })

  it('sin permiso dice "Sin acceso a …"', async () => {
    const w = await montar({ error: true, sinPermiso: true, recurso: 'las categorías' })
    expect(w.text()).toContain('Sin acceso a las categorías. Pídele al administrador que te lo habilite.')
  })

  it('el error pesa aunque queden filas viejas: las filas no se muestran como vigentes', async () => {
    const w = await montar({ error: true, recurso: 'las categorías', data: [{ nombre: 'Viejas' }] })
    expect(w.text()).not.toContain('Viejas')
  })
})

describe('CrudTable — filtro sin resultados', () => {
  it('con filtro activo dice que el filtro no encontró nada, no que no hay datos', async () => {
    const w = await montar(
      { filtrado: true, vacio: 'No hay compras registradas.' },
      { empty: '<p>No hay compras registradas.</p>' },
    )
    expect(w.text()).not.toContain('No hay compras registradas.')
    expect(w.text()).toContain('Ningún resultado con esos filtros.')
  })

  it('sin filtro y sin slot usa el texto `vacio` de la pantalla', async () => {
    const w = await montar({ vacio: 'No hay compras registradas.' })
    expect(w.text()).toContain('No hay compras registradas.')
  })

  it('Quitar filtros emite quitarFiltros', async () => {
    const w = await mountSuspended(CrudTable, {
      props: { data: [], columns, filtrado: true, onQuitarFiltros: () => {} },
    })
    await w.find('[data-qa="estado-quitar-filtros"]').trigger('click')
    expect(w.emitted('quitarFiltros')).toHaveLength(1)
  })

  it('sin handler de quitarFiltros no ofrece el botón', async () => {
    const w = await montar({ filtrado: true })
    expect(w.find('[data-qa="estado-quitar-filtros"]').exists()).toBe(false)
  })
})
