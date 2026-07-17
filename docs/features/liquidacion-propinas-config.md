# Feature: Liquidación de propinas — configuración de distribución (E2)

**Status**: Complete (E2)  
**Last Updated**: 2026-07-17

---

## Overview

### What is it?

El administrador del tenant configura cómo se reparte el pool de propinas entre
grupos de trabajo (Garzón / Cocina / Barra): porcentaje del pool, criterio de
reparto interno y, si aplica, pesos manuales. La configuración es **versionada**.

### Why does it exist?

Antes de liquidar (E3) hace falta una regla de negocio editable y auditable;
al liquidar se tomará un snapshot de esta config.

### Scope

- Incluido: tablas `propina_configuracion` / `propina_grupo_distribucion` /
  `propina_grupo_peso_manual`; GET/PUT; validación Σ activos = 100%; seed default
  al crear tenant + Paris; módulo RBAC `Propinas` (Leer, Configurar, Liquidar);
  UI en `/configuracion/propinas-distribucion`; **propina sugerida**
  (`porcentaje_sugerido`, default 10%) editable en la misma pantalla;
  `GET /propinas/porcentaje-sugerido` (`Salones:Operar`) para el cobro.
- NO incluido (ya en E3): motor de liquidación, UI de liquidar, tablas
  `liquidacion_propinas*`.

---

## API Endpoints

### `GET /propinas/distribucion`

Auth: JWT + tenant. Permiso: `Propinas:Leer`.

Si no hay config, crea el default (v1, grupo Garzones 100% `PARTES_IGUALES`,
`porcentajeSugerido: "0.10"`).

Respuesta incluye `porcentajeSugerido` (decimal string).

### `GET /propinas/porcentaje-sugerido`

Auth: JWT + tenant. Permiso: `Salones:Operar`.

```json
{ "porcentajeSugerido": "0.10" }
```

### `PUT /propinas/distribucion`

Auth: JWT + tenant. Permiso: `Propinas:Configurar`.

Reemplazo transaccional de grupos (soft-delete + recreate); `version++`.
Body requiere `porcentajeSugerido` (decimal `0`–`1`).

```json
{
  "porcentajeSugerido": "0.15",
  "grupos": [
    {
      "tipoGarzon": "garzon",
      "nombre": "Garzones",
      "porcentaje": "0.80",
      "criterio": "VENTAS_NETAS",
      "baseVentas": "TOTAL_FINAL",
      "activo": true,
      "orden": 0
    },
    {
      "tipoGarzon": "cocina",
      "nombre": "Cocina",
      "porcentaje": "0.20",
      "criterio": "PARTES_IGUALES",
      "activo": true,
      "orden": 1
    }
  ]
}
```

Reglas: Σ `porcentaje` de activos = `1`; un tipo activo a la vez; `MANUAL`
exige `manualModo`; pesos solo con `MANUAL` + `PESOS`.

---

## Backend

- **Module**: `src/modules/propinas/`
- **Service**: `propina-distribucion.service.ts`
- **Controller**: `propina-distribucion.controller.ts`
- Porcentajes en decimal (`0.80` = 80%), Decimal.js en validación.

---

## Frontend

- Composable: `usePropinaDistribucion`
- Página: `pages/configuracion/propinas-distribucion.vue`
- Nav: Configuración → Propinas (admin o `Propinas:Leer`/`Configurar`)
- Tras PUT: reemplaza el `ref` local con la respuesta (sin re-fetch).

---

## Related

- Spec: `docs/superpowers/specs/2026-07-17-liquidacion-propinas-design.md`
- Plan E2: `docs/superpowers/plans/2026-07-17-liquidacion-propinas-e2.md`
- E1 (modelo tip): `docs/ESTADO.md` fila Liquidación propinas E1
