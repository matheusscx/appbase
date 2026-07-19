# Diseño de Boletas para POS (Documento de Diseño)

## Objetivo

Contar con una única plantilla de impresión que permita generar:

-   Boletas electrónicas.
-   Boletas internas (sin facturación electrónica).

La diferencia entre ambas estará dada únicamente por bloques
condicionales.

------------------------------------------------------------------------

# Estructura general

``` text
+------------------------------------------------+
|                 LOGO OPCIONAL                  |
|                 Nombre Empresa                 |
|                 Giro Comercial                 |
|                                                |
| RUT: 76.123.456-7                              |
|------------------------------------------------|
|              [TIPO DOCUMENTO]                  |
|          BOLETA ELECTRÓNICA                    |
|             N° 00000123                        |
|------------------------------------------------|
| Dirección :                                    |
| Sucursal  :                                    |
| Teléfono  :                                    |
| Fecha     :                                    |
| Cajero    :                                    |
| Caja      :                                    |
| Mesa      :            Garzón :                |
|                                                |
| Cliente   :                                    |
| RUT       :                                    |
|------------------------------------------------|
| CANT DESCRIPCIÓN              P.UNIT     TOTAL |
|------------------------------------------------|
| 1    Producto                 3.000     3.000  |
| 2    Producto                 5.000    10.000  |
|------------------------------------------------|
|                             Subtotal   13.000  |
|                             Descuento     500  |
|                             Neto      10.504   |
|                             IVA        1.996   |
|------------------------------------------------|
|                      TOTAL BOLETA    12.500    |
|------------------------------------------------|
| Propina                      1.250            |
|------------------------------------------------|
|                      TOTAL A PAGAR  13.750     |
|------------------------------------------------|
```

------------------------------------------------------------------------

# Bloques condicionales

## Facturación electrónica habilitada

Agregar:

``` text
---------------------------------------------
BOLETA ELECTRÓNICA
Folio: XXXXX

[PDF417]

Timbre Electrónico SII

Verifique documento en
www.sii.cl
```

## Facturación electrónica deshabilitada

Ocultar el bloque anterior y reemplazar por:

``` text
---------------------------------------------
        DOCUMENTO INTERNO

      *** SIN VALIDEZ FISCAL ***

Este comprobante no constituye
un documento tributario.
```

------------------------------------------------------------------------

# Configuración

    facturacionElectronica = true

Entonces:

-   Mostrar Folio.
-   Mostrar PDF417.
-   Mostrar Timbre SII.

Si:

    facturacionElectronica = false

Entonces:

-   Ocultar Folio.
-   Ocultar PDF417.
-   Ocultar Timbre.
-   Mostrar "SIN VALIDEZ FISCAL".

------------------------------------------------------------------------

# Campos opcionales

Solo imprimir si existen:

-   Mesa
-   Garzón
-   Cliente
-   RUT Cliente
-   Dirección Cliente
-   Teléfono
-   Pedido
-   Observaciones

------------------------------------------------------------------------

# Manejo de propinas

## Precuenta

La precuenta no posee validez tributaria.

Debe mostrar:

``` text
Subtotal Consumo       $45.000

Propina sugerida (10%)  $4.500

Total sugerido         $49.500
```

Puede incluir:

> Propina sugerida (10%), de aceptación voluntaria.

## Flujo

1.  Cliente solicita la cuenta.
2.  Se imprime la precuenta.
3.  Cliente acepta, rechaza o modifica la propina.
4.  Se procesa el pago.
5.  Se imprime la boleta definitiva.

## Boleta final

La propina aceptada debe imprimirse separada del documento tributario.

``` text
NETO              $16.807
IVA                $3.193
-------------------------
TOTAL BOLETA      $20.000

Propina            $2.000

-------------------------
TOTAL A PAGAR     $22.000
```

## Reglas

-   La propina no forma parte del neto.
-   No paga IVA.
-   No modifica el TOTAL BOLETA.
-   Solo incrementa el TOTAL A PAGAR.

------------------------------------------------------------------------

# Recomendación final

Mantener una única plantilla con bloques condicionales.

  Bloque                        Electrónica   Interna
  ---------------------------- ------------- ---------
  Cabecera                          ✅          ✅
  Detalle                           ✅          ✅
  Totales                           ✅          ✅
  Propina                           ✅          ✅
  PDF417                            ✅          ❌
  Timbre SII                        ✅          ❌
  Leyenda SIN VALIDEZ FISCAL        ❌          ✅

Con este diseño el mantenimiento es más simple y el formato permanece
consistente.
