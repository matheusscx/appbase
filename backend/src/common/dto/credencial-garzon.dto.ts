import { IsUUID, Matches } from 'class-validator';

/**
 * Las dos cosas que identifican a un garzón en un dispositivo compartido:
 * **a quién dice ser** y **la prueba**.
 *
 * Vive en `common/` por la misma razón que
 * [`RestaurarDto`](./restaurar.dto.ts): el par es contrato entre **5 endpoints
 * de 2 módulos** (`turnos` → iniciar/cerrar/consultar sesión; `salones` →
 * abrir, cobrar y tomar cuenta) y las pantallas que los llaman. Si cada módulo
 * lo escribiera por su cuenta, dos podrían discrepar en el nombre del campo sin
 * ningún error visible.
 *
 * **Por qué `garzonId` y no solo el PIN.** Antes la identificación era
 * `resolverGarzonPorPin(tenantId, pin)`: traía **todos** los garzones activos
 * del tenant y los comparaba con bcrypt uno por uno, porque el hash está
 * salteado y no se puede buscar por índice. Medido: bcryptjs a coste 10 tarda
 * 62,5 ms por comparación, así que 20 garzones son 1,3 s de CPU **por intento**,
 * y 5 intentos concurrentes dieron 6,3 s con hasta 309 ms de lag del event loop
 * — que en un solo proceso Node lo pagan todos los tenants.
 * Con el garzón ya elegido en pantalla, la verificación es **1 bcrypt**.
 *
 * El PIN sigue siendo la prueba: `garzonId` solo dice a quién comparar.
 */
export class CredencialGarzonDto {
  @IsUUID('4', { message: 'garzonId debe ser un UUID' })
  garzonId: string;

  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin: string;
}
