import { SetMetadata } from '@nestjs/common';

export const REQUIRES_PERMISO_KEY = 'requires_permiso';

export interface ParPermiso {
  modulo: string;
  permiso: string;
}

/**
 * El permiso que exige la ruta. La metadata guarda **siempre una lista**, aunque
 * el caso normal —y 152 de las 153 rutas— tenga un solo par: así el guard tiene
 * una sola forma que leer, en vez de ramificar por el shape de su propia
 * metadata.
 */
export const RequiresPermiso = (modulo: string, permiso: string) =>
  SetMetadata<string, ParPermiso[]>(REQUIRES_PERMISO_KEY, [
    { modulo, permiso },
  ]);

/**
 * Alternativas: alcanza con tener **una**.
 *
 * Existe para lo que le sirve a más de un módulo, y el caso que lo trajo es el
 * garzón: lo crea el alta de TODO tenant (`asegurarMostrador`), atiende mesas
 * en Salones y cobra propinas en Propinas. Colgarlo de un solo módulo dejaba
 * afuera al tenant que contrató el otro — con `Salones` a secas, un tenant que
 * solo cobra propina directa no podía ni abrir su pantalla de liquidación,
 * porque esa pantalla lista garzones.
 *
 * ⚠️ **No es un "OR" genérico para ahorrarse decidir el permiso de una ruta.**
 * Cada alternativa es una consulta más a RBAC, y sobre todo: dos módulos que
 * habilitan lo mismo tienen que ser dos módulos que de verdad comparten la
 * entidad. Si la duda es cuál de los dos corresponde, la respuesta es elegir,
 * no listar los dos.
 */
export const RequiresAlgunPermiso = (...alternativas: ParPermiso[]) =>
  SetMetadata<string, ParPermiso[]>(REQUIRES_PERMISO_KEY, alternativas);
