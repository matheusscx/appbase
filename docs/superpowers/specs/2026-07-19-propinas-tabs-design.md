# Tabs en la página de Propinas

**Status:** Approved
**Date:** 2026-07-19

## Contexto

`frontend/app/pages/propinas/index.vue` apila en una sola página, uno debajo
del otro: métricas del mes, selector de período + reparto en vivo, y la
tabla de "Liquidaciones cerradas". Esto hace la página larga y mezcla dos
flujos distintos (trabajar el período actual vs. revisar liquidaciones ya
cerradas). Se pide separar ambos flujos en tabs.

## Diseño

Reusar el patrón ya existente en `frontend/app/pages/sesiones-garzon.vue`
(`UTabs` con `:content="false"` + bloques `v-if` debajo, sin usar los slots
de contenido de `UTabs`).

- Estado: `const tab = ref('propinas')`.
- Items:
  ```ts
  const tabs = computed(() => [
    { label: 'Propinas', value: 'propinas', icon: 'i-lucide-hand-coins' },
    {
      label: 'Liquidaciones cerradas',
      value: 'liquidaciones',
      icon: 'i-lucide-history',
      badge: historial.value.length || undefined,
    },
  ])
  ```
- `<UTabs v-model="tab" :items="tabs" :content="false" />` se ubica
  inmediatamente debajo de `CrudPageHeader`.
- **Tab "propinas"** (`v-if="tab === 'propinas'"`): agrupa, sin cambios de
  lógica, todo lo que hoy está entre las métricas y el historial:
  - Las 2 `UCard` de métricas ("Pendiente por liquidar", "Cobrado (mes)").
  - El `UCard` "Selector de período" (fechas, turnos, botón "Ver reparto").
  - El `<template v-if="reparto">` con el reparto en vivo y el botón
    "Liquidar período".
- **Tab "liquidaciones"** (`v-if="tab === 'liquidaciones'"`): el `UCard` del
  historial con la `UTable`, quitando el `<template #header>` interno
  ("Liquidaciones cerradas") porque el título ya lo da la tab activa.
- No cambia ninguna llamada API, `onMounted`, computeds de negocio ni
  columnas de la tabla — es un cambio puramente de layout/wrapping.

## Verificación

- `npm run lint` en `frontend/` sin errores nuevos.
- Visual en `http://localhost:5173/propinas`: la tab "Propinas" muestra
  métricas + selector + reparto en vivo; la tab "Liquidaciones cerradas"
  muestra la tabla de historial; cambiar de tab no dispara llamadas API
  adicionales (los datos ya están cargados en `onMounted`).
- Confirmar que "Ver reparto" y "Liquidar período" siguen funcionando igual
  dentro de la tab "Propinas".
