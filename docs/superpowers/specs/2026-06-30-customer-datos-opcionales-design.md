# Spec: Datos del comprador opcionales en el POS

**Status:** Approved  
**Date:** 2026-06-30  
**Owner:** Cesar Matheus

---

## Context

El POS tiene un flag `requiere_customer` en `tipos_documento_tributario` que controlaba si se mostraba o no el formulario de datos del comprador. El problema: el flag mezclaba dos responsabilidades distintas:

1. Si el documento exige identificación fiscal del comprador (ej: factura → RUT obligatorio)
2. Si se capturan datos del comprador en absoluto

Esto impedía que el cajero registrara datos del comprador en ventas de boleta, aunque fueran necesarios por otras razones (ej: garantía de un producto).

---

## Scope

**Dentro:**
- Renombrar columna `requiere_customer` → `customer_requerido` en BD y backend
- Cambiar comportamiento frontend: cuando es opcional, mostrar botón para expandir el form en lugar de ocultarlo
- Validación: si el form opcional está abierto, el nombre es obligatorio

**Fuera:**
- Vincular datos del comprador con un `tercero` registrado (fase futura)
- Campos adicionales en `venta_customer`
- Cambios en el flujo de ventas online

---

## Backend

### Entidad — `tipo-documento-tributario.entity.ts`
```typescript
// antes
@Column({ name: 'requiere_customer', default: false })
requiereCustomer: boolean;

// después
@Column({ name: 'customer_requerido', default: false })
customerRequerido: boolean;
```

TypeORM `synchronize: true` recrea la columna automáticamente al levantar en dev. No se necesita archivo de migración separado.

### `ventas.service.ts`
- Query SQL: `td.customer_requerido` (antes `td.requiere_customer`)
- Objeto mapeado: `customerRequerido: r.customer_requerido === true`

### `seeder.service.ts`
- Boleta/Ticket: `customerRequerido: false`
- Factura: `customerRequerido: true`

### `startup-pos.sql`
- Actualizar referencia documental: `"customer_requerido" BOOLEAN NOT NULL DEFAULT false`

### Respuesta del endpoint `/tipos-documento`
```json
{ "id": "...", "nombre": "Boleta", "customerRequerido": false }
```

---

## Frontend

### `CarritoPanel.vue`

**Interfaz y computed:**
```typescript
interface TipoDoc { id: string; nombre: string; customerRequerido: boolean }
const customerRequerido = computed(() => docSeleccionado.value?.customerRequerido ?? false)
```

**Nuevo modelo para estado del form opcional:**
```typescript
const customerExpandido = defineModel<boolean>('customerExpandido', { default: false })
```

**Template — lógica de visualización:**
- `customerRequerido = true` → `<VentasClienteForm>` siempre visible (igual que hoy)
- `customerRequerido = false` → mostrar botón "Agregar datos del cliente"; al hacer clic `customerExpandido = true`; mostrar form + botón "Quitar" para cerrar (resetea form y pone `customerExpandido = false`)

### `ventas/index.vue`

**Nuevo ref:**
```typescript
const customerExpandido = ref(false)
```

**Payload — incluir customer si:**
```typescript
const incluirCustomer = docSel?.customerRequerido || customerExpandido.value
if (incluirCustomer) body.customer = { ... }
```

**Validación antes de submit:**
```typescript
if (customerExpandido.value && !customer.value.nombre) {
  // mostrar error: "El nombre del cliente es requerido"
  return
}
```

**Reset al confirmar venta:**
```typescript
customerExpandido.value = false
customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '' }
```

**Reset al cambiar tipo de documento** (watcher en `ventas/index.vue`):
```typescript
watch(tipoDocumentoId, () => {
  customerExpandido.value = false
  customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '' }
})
```

### `ClienteForm.vue`
Sin cambios.

---

## Verification

- [ ] `docker-compose down -v && docker-compose up --build` → BD levanta limpia con columna `customer_requerido`
- [ ] Seleccionar Factura → form de datos siempre visible, nombre obligatorio al cobrar
- [ ] Seleccionar Boleta → botón "Agregar datos del cliente" visible
- [ ] Abrir form opcional → rellenar nombre → venta se guarda con `venta_customer`
- [ ] Abrir form opcional → no rellenar nombre → submit bloqueado con mensaje de error
- [ ] Abrir form opcional → presionar "Quitar" → form se cierra, datos se limpian
- [ ] Venta de boleta sin abrir el form → se guarda sin `venta_customer`
- [ ] Cambiar tipo de documento (boleta ↔ factura) → estado de `customerExpandido` se resetea

---

## Decisions

- **Renombrar, no agregar flag:** se descartó un segundo flag `customer_habilitado` por sobre-ingeniería. La semántica de un solo campo `customer_requerido` (true = obligatorio, false = opcional con botón) cubre todos los casos actuales.
- **`customerExpandido` como `defineModel`:** permite que el padre (`ventas/index.vue`) controle la validación y el payload sin acoplar lógica en `CarritoPanel`.
