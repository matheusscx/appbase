# Especificación de Diseño y Arquitectura de Boletas para POS

## 1. Objetivo del Documento
El objetivo de esta especificación es definir una **plantilla única de impresión** para el sistema de Punto de Venta (POS), capaz de adaptarse dinámicamente mediante bloques condicionales a dos escenarios operativos:
1. **Boleta Electrónica:** Documento con validez legal y tributaria ante el Servicio de Impuestos Internos (SII) de Chile.
2. **Boleta Interna (Comprobante):** Documento sin validez fiscal, utilizado cuando la facturación electrónica está deshabilitada o en entornos de prueba/contingencia.

Asimismo, se unifica el flujo correcto y la representación de la **propina (10% sugerido)** conforme a la normativa legal y la práctica habitual en el rubro gastronómico en Chile.

---

## 2. Flujo de Trabajo Gastronómico y Manejo de Propinas

El flujo transaccional en un restaurante difiere de un comercio común debido a la naturaleza voluntaria de la propina. Se debe respetar estrictamente el siguiente ciclo:

```
+--------------------+       +------------------------+       +-------------------------+       +-----------------------+
| 1. Petición Cuenta | ----> | 2. Precuenta (Interna) | ----> | 3. Decisión del Cliente | ----> | 4. Procesamiento Pago |
+--------------------+       +------------------------+       +-------------------------+       +-----------------------+
                                                                                                            |
                                                                                                            v
                                                                                                +-----------------------+
                                                                                                | 5. Impresión Boleta   |
                                                                                                +-----------------------+
```

### 2.1. La Precuenta o Comanda de Cobro
* **Momento:** Se imprime cuando el cliente solicita la cuenta, previo a la emisión del documento fiscal.
* **Validez:** **No tiene validez tributaria.**
* **Propósito:** Permite al cliente revisar su consumo y presenta de forma clara el cálculo de la propina sugerida.
* **Visualización de Totales en Precuenta:**
  ```text
  Subtotal Consumo       $45.000
  Propina sugerida (10%)  $4.500
  ------------------------------
  Total sugerido         $49.500
  
  * Propina sugerida (10%), de aceptación voluntaria.
  ```

### 2.2. Procesamiento del Pago y Modificación
El cliente tiene plena facultad de:
* Aceptar el 10% sugerido.
* Rechazar la propina ($0).
* Indicar un monto fijo diferente (ej. $3.000 o $5.000).

El POS registrará el monto final aceptado desglosando la venta del valor de la propina antes de enviar la transacción al terminal de pago (POS/Transbank/etc.).

### 2.3. Reglas Tributarias de la Propina en Chile
* **Base Imponible:** La propina **no forma parte** de la base imponible del documento fiscal.
* **Impuestos:** No genera IVA, no altera el valor Neto, ni modifica los impuestos calculados de la venta.
* **Ubicación Visual:** En la boleta final, se debe imprimir siempre **debajo** de la línea del `TOTAL BOLETA`, sumándose únicamente en el campo informativo `TOTAL A PAGAR`.

---

## 3. Estructura General y Layout de Caracteres (ASCII)

A continuación se detalla la estructura unificada de la plantilla. Los bloques entre corchetes angulares `[ ]` o indicados como condicionales dependen de la configuración del sistema.

```text
+------------------------------------------------+
|                 [LOGO OPCIONAL]                |
|                 Nombre Empresa                 |
|                 Giro Comercial                 |
|                                                |
| RUT: 76.123.456-7                              |
|------------------------------------------------|
|               TIPO DE DOCUMENTO                |
|         [BOLETA ELECTRÓNICA N° 00000123]       |
|               [DOCUMENTO INTERNO]              |
|------------------------------------------------|
| Dirección : Av. Providencia 1234, Santiago     |
| Sucursal  : Local 4 (Providencia)              |
| Teléfono  : +56 2 2345 6789                    |
| Fecha     : 18-07-2026 13:15                  |
| Cajero    : Juan Pérez                         |
| Caja      : CAJA-01                            |
| [Mesa]    : MESA-12       [Garzón]: Carlos M.  |
|                                                |
| [Cliente] : Alternativas Corp S.A.             |
| [RUT Cli] : 77.999.888-K                       |
|------------------------------------------------|
| CANT DESCRIPCIÓN              P.UNIT     TOTAL |
|------------------------------------------------|
| 1    Pisco Sour Catedral      $5.000    $5.000 |
| 2    Lomo Liso Término Medio $15.000   $30.000 |
| 1    Bebida Express           $2.000    $2.000 |
|------------------------------------------------|
|                             Subtotal   $37.000 |
|                             Descuento       $0 |
|                             Neto       $31.092 |
|                             IVA (19%)   $5.908 |
|------------------------------------------------|
|                      TOTAL BOLETA      $37.000 |
|------------------------------------------------|
| [Propina Aceptada]                      $3.700 |
|------------------------------------------------|
|                      TOTAL A PAGAR     $40.700 |
|------------------------------------------------|
|                                                |
|         [BLOQUE CONDICIONAL DE VALIDEZ]        |
|                                                |
+------------------------------------------------+
```

---

## 4. Lógica de Configuración y Bloques Condicionales

El comportamiento de la plantilla única está controlado por el flag de configuración global `facturacionElectronica`.

### 4.1. Flag: `facturacionElectronica = true`
El sistema opera en modo fiscal legal. Se deben activar obligatoriamente los siguientes componentes en el pie y encabezado del documento:

* **Encabezado:** Muestra el texto `BOLETA ELECTRÓNICA` acompañado del número de `Folio` asignado por el CAF (Código de Autorización de Folios).
* **Bloque de Validez (Pie de página):**
  ```text
  ------------------------------------------------
                 BOLETA ELECTRÓNICA
  
  [... Aquí se renderiza el código de barras ...]
  [...           en formato PDF417            ...]
  
                Timbre Electrónico SII
                
            Verifique documento en www.sii.cl
  ------------------------------------------------
  ```

### 4.2. Flag: `facturacionElectronica = false`
El sistema opera en modo interno/comprobante. Se modifican las secciones de la siguiente manera:

* **Encabezado:** Muestra el texto `DOCUMENTO INTERNO`.
* **Bloque de Validez (Pie de página):** Se ocultan por completo el Folio, el código PDF417 y la leyenda del SII, reemplazándose por el aviso de advertencia:
  ```text
  ------------------------------------------------
                  DOCUMENTO INTERNO
  
               *** SIN VALIDEZ FISCAL ***
  
         Este comprobante no constituye un
           documento de carácter tributario.
  ------------------------------------------------
  ```

---

## 5. Gestión de Campos Opcionales

Para optimizar el uso del papel térmico y mantener la limpieza visual, **los siguientes campos solo deben ocupar espacio e imprimirse si contienen información** en el objeto de datos de la venta:

1. **Datos de Operación Gastronómica:** `Mesa`, `Garzón`, `Pedido`, `Observaciones`.
2. **Datos del Cliente (B2B o Fidelización):** `Cliente` (Nombre/Razón Social), `RUT Cliente`, `Dirección Cliente`.
3. **Metadatos del Comercio:** `LOGO OPCIONAL`, `Teléfono`.

Si cualquiera de estos parámetros es nulo, una cadena vacía o cero (según corresponda), la línea completa debe ser omitida del renderizado físico.

---

## 6. Matriz de Componentes de la Plantilla Única

Esta matriz resume visualmente cómo se comporta el motor de renderizado de la plantilla según la bandera de facturación configurada:

| Bloque / Componente | Modo Electrónico (`true`) | Modo Interno (`false`) | Regla de Visualización |
| :--- | :---: | :---: | :--- |
| **Cabecera Empresa** | ✅ | ✅ | Fijo (Nombre, RUT emisor, Giro, Dirección, Sucursal). |
| **Identificador Fiscal** | `BOLETA ELECTRÓNICA` | `DOCUMENTO INTERNO` | Dinámico según parámetro. |
| **Campos Opcionales** | 👁️ *Condicional* | 👁️ *Condicional* | Solo si el campo posee datos (Mesa, Garzón, RUT Cliente). |
| **Detalle de Ítems** | ✅ | ✅ | Iteración estándar de productos (Cant, Desc, P.Unit, Total). |
| **Cálculo de Impuestos** | ✅ | ✅ | Desglose Informativo de Subtotal, Neto e IVA (19%). |
| **TOTAL BOLETA** | ✅ | ✅ | Monto total de la transacción comercial exento de propina. |
| **Propina Aceptada** | ✅ | ✅ | Se muestra si el valor es > 0. Si es 0, puede ocultarse o mostrar `$0`. |
| **TOTAL A PAGAR** | ✅ | ✅ | `TOTAL BOLETA` + `Propina Aceptada`. |
| **Timbre SII / PDF417** | ✅ | ❌ | Exclusivo para emisión electrónica regulada. |
| **Leyenda "SIN VALIDEZ"** | ❌ | ✅ | Exclusivo para evitar multas por simulación de documentos fiscales. |

---

## 7. Recomendaciones de Arquitectura de Software

1. **Separación de Capas:** Mantener las plantillas de impresión escritas en lenguajes de marcado limpios (como plantillas de texto enriquecido, layouts ESC/POS, o motores estilo Handlebars/Liquid). Evitar hardcodear strings directamente en el código fuente del backend.
2. **Cálculos de Precisión:** El cálculo del IVA debe realizarse aplicando la fórmula estándar chilena (`Neto = Round(Total / 1.19)`, `IVA = Total - Neto`). Asegurarse de que el redondeo a enteros se ejecute correctamente antes del renderizado para evitar discrepancias de $1 peso por redondeos decimales.
3. **Manejo de Cero en Propinas:** Si la propina aceptada es igual a `$0`, se aconseja ocultar la línea completa de `Propina` y hacer que `TOTAL A PAGAR` sea idéntico a `TOTAL BOLETA`, reduciendo ruido visual para el consumidor final.
