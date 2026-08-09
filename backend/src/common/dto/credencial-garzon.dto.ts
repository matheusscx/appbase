import { IsOptional, IsUUID, Matches } from 'class-validator';

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

/**
 * La misma credencial, **opcional**: la mandan las acciones del salón, donde el
 * garzón puede estar operando desde **su propia tablet**. Ahí el JWT ya probó
 * quién es y el PIN no se manda (modo personal, ver `resolverGarzonActuante`).
 *
 * ⚠️ **Que sean opcionales acá no las hace opcionales en el tótem.** El
 * `ValidationPipe` deja pasar el body sin credencial; quien decide si eso es
 * legítimo es `resolverGarzonActuante`, que sin vínculo personal **corta con
 * 400**. Si esa rama se toca, el PIN se vuelve salteable en los 6 lugares donde
 * se pide, a la vez. No es validación de forma: es control de acceso.
 *
 * Se declara aparte y no relajando la de arriba porque
 * `POST /garzones/verificar-pin` —el endpoint que solo comprueba un PIN— sí las
 * necesita obligatorias: sin garzón y sin PIN no hay nada que verificar.
 */
export class CredencialGarzonOpcionalDto {
  @IsOptional()
  @IsUUID('4', { message: 'garzonId debe ser un UUID' })
  garzonId?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin?: string;
}
