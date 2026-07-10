# Diseño Base - Pasarela de Pagos Multitenant opcion 2

## Objetivo

Diseñar una arquitectura base para una pasarela de pagos multitenant capaz de soportar múltiples proveedores (Transbank Oneclick, Webpay Plus, MercadoPago, Stripe, etc.) sin modificar el modelo de datos al incorporar nuevas integraciones.

El sistema asume que las siguientes entidades ya existen en la plataforma:

- `cliente_id`
- `usuario_id`
- `pago_id`
- `venta_id`

Estas entidades no forman parte del diseño y únicamente serán referenciadas mediante sus identificadores.

---

# Principios de diseño

- Modelo desacoplado de cualquier proveedor.
- Configuración independiente por cliente.
- Soporte para múltiples ambientes (Pruebas / Producción).
- Soporte para comercio Mall o Comercio Individual.
- Historial completo de transacciones.
- Preparado para tokenización y pagos recurrentes.
- Preparado para futuras pasarelas sin cambios estructurales.

---

# Modelo de datos

```text
                          +----------------+
                          |   Pasarelas    |
                          +----------------+
                                  |
                                  |
                     +------------+-------------+
                     |                          |
                     |                          |
          +----------v----------+               |
          | Cliente Pasarelas   |               |
          +----------+----------+               |
                     |                          |
                     |                          |
          +----------v----------+               |
          | Usuarios Pasarela   |              |
          +----------+----------+               |
                     |                          |
                     |                          |
          +----------v----------+               |
          |  Medios de Pago     |              |
          +----------+----------+               |
                     |                          |
                     +------------+-------------+
                                  |
                                  |
                         +--------v--------+
                         | Transacciones   |
                         +--------+--------+
                                  ^
                                  |
                         +--------+--------+
                         | Ordenes Compra  |
                         +-----------------+
```

---

# 1. ordenes_compra

Representa la intención de pago generada por el sistema.

Una orden puede generar múltiples transacciones debido a:

- Reintentos
- Autorizaciones
- Capturas
- Reversiones
- Reembolsos

## Campos

| Campo | Tipo | Descripción |
|--------|------|-------------|
| id | PK | Identificador |
| cliente_id | FK | Cliente (Colegio) |
| usuario_id | FK | Usuario que realiza el pago |
| pago_id | FK | Pago interno |
| venta_id | FK | Venta interna |
| codigo_orden | varchar | Identificador único enviado a la pasarela |
| descripcion | varchar | Descripción del pago |
| monto | numeric | Monto |
| moneda | varchar(3) | CLP, USD, etc |
| estado | varchar | Estado actual |
| fecha_expiracion | timestamp | Expiración de la orden |
| metadata | jsonb | Información adicional |
| created_at | timestamp | Fecha creación |
| updated_at | timestamp | Fecha actualización |

---

# 2. pasarelas

Catálogo de proveedores soportados por la plataforma.

## Campos

| Campo | Tipo |
|--------|------|
| id | PK |
| codigo | varchar |
| nombre | varchar |
| soporta_tokenizacion | boolean |
| soporta_cobro_recurrente | boolean |
| soporta_mall | boolean |
| url_produccion | varchar |
| url_pruebas | varchar |
| configuracion_produccion | jsonb |
| configuracion_pruebas | jsonb |
| activo | boolean |
| created_at | timestamp |
| updated_at | timestamp |

## Ejemplos

```text
oneclick
webpay_plus
mercadopago
stripe
adyen
```

La configuración almacena información propia del proveedor.

Ejemplo:

```json
{
    "commerceCode": "...",
    "apiKey": "...",
    "certificate": "..."
}
```

---

# 3. cliente_pasarelas

Relaciona un cliente con una pasarela.

Permite definir qué pasarela utiliza cada cliente y cómo debe operar.

## Campos

| Campo | Tipo |
|--------|------|
| id | PK |
| cliente_id | FK |
| pasarela_id | FK |
| ambiente | enum |
| modo_integracion | enum |
| configuracion | jsonb |
| activo | boolean |
| prioridad | integer |
| created_at | timestamp |
| updated_at | timestamp |

## Ambiente

```text
PRUEBAS
PRODUCCION
```

## Modo de integración

```text
MALL
INDIVIDUAL
```

Cuando el modo es **INDIVIDUAL**, la configuración contendrá las credenciales del cliente.

Cuando el modo es **MALL**, utilizará la configuración definida en la tabla `pasarelas`.

---

# 4. usuarios_pasarela

Representa la inscripción de un usuario dentro de una pasarela.

No representa al usuario del sistema.

Representa el identificador generado por el proveedor después de registrar un medio de pago.

## Campos

| Campo | Tipo |
|--------|------|
| id | PK |
| cliente_id | FK |
| usuario_id | FK |
| cliente_pasarela_id | FK |
| identificador_externo | varchar |
| identificador_usuario_externo | varchar |
| estado | varchar |
| metadata | jsonb |
| created_at | timestamp |
| updated_at | timestamp |

## Ejemplo

Para Oneclick:

```text
identificador_externo = tbkUser
identificador_usuario_externo = username
```

Para Stripe:

```text
identificador_externo = customer_id
```

La tabla permanece igual independientemente del proveedor.

---

# 5. medios_pago

Representa los instrumentos de pago registrados por un usuario.

Un usuario puede tener múltiples medios registrados.

## Campos

| Campo | Tipo |
|--------|------|
| id | PK |
| usuario_pasarela_id | FK |
| tipo | varchar |
| marca | varchar |
| ultimos_4 | varchar |
| fecha_expiracion | varchar |
| token_externo | varchar |
| estado | varchar |
| metadata | jsonb |
| created_at | timestamp |
| updated_at | timestamp |

Ejemplos de tipos:

```text
TARJETA_CREDITO
TARJETA_DEBITO
CUENTA_BANCARIA
BILLETERA_DIGITAL
```

---

# 6. transacciones

Es el historial de todas las operaciones realizadas contra una pasarela.

Debe mantenerse como un historial inmutable.

Cada autorización, captura, reversa o devolución debe registrarse como una nueva fila.

## Campos

| Campo | Tipo |
|--------|------|
| id | PK |
| cliente_id | FK |
| usuario_id | FK |
| orden_compra_id | FK |
| cliente_pasarela_id | FK |
| usuario_pasarela_id | FK |
| medio_pago_id | FK |
| transaccion_padre_id | FK |
| tipo | varchar |
| estado | varchar |
| monto | numeric |
| moneda | varchar |
| token_externo | varchar |
| codigo_orden | varchar |
| identificador_sesion | varchar |
| codigo_autorizacion | varchar |
| identificador_transaccion_externo | varchar |
| codigo_respuesta | varchar |
| tipo_pago | varchar |
| numero_cuotas | integer |
| monto_cuota | numeric |
| request | jsonb |
| response | jsonb |
| metadata | jsonb |
| fecha_transaccion | timestamp |
| created_at | timestamp |
| updated_at | timestamp |

---

# Estados sugeridos

```text
CREATED
TOKENIZED
AUTHORIZED
CAPTURED
FAILED
REVERSED
REFUNDED
VOIDED
```

---

# Tipos de transacción

```text
INSCRIPTION
AUTHORIZATION
CAPTURE
REVERSAL
VOID
REFUND
RECURRENT_PAYMENT
```

---

# Uso de nombres genéricos

Para mantener el modelo independiente del proveedor se utilizan nombres neutros.

| Nombre Genérico | Ejemplo Oneclick |
|-----------------|------------------|
| identificador_externo | tbkUser |
| identificador_usuario_externo | username |
| token_externo | token |
| identificador_transaccion_externo | transactionId |
| codigo_orden | buyOrder |
| identificador_sesion | sessionId |
| codigo_autorizacion | authorizationCode |
| codigo_respuesta | responseCode |

De esta forma la estructura permanece inalterada al incorporar nuevas pasarelas.

---

# Beneficios del diseño

- Escalable para múltiples proveedores.
- Totalmente multitenant.
- Compatible con comercio Mall e Individual.
- Compatible con tokenización y pagos recurrentes.
- No requiere cambios estructurales para nuevas pasarelas.
- Permite almacenar información específica de cada proveedor mediante `jsonb`.
- Facilita auditorías gracias al historial completo de transacciones.
- Reduce el acoplamiento entre la lógica del negocio y la implementación de cada proveedor de pagos.