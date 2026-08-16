import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

/**
 * Quiénes administran el tenant **de verdad**: membresía viva y algún rol
 * `es_fijo` vivo asignado.
 *
 * ⚠️ **El `JOIN` a `usuarios_tenants` no es decorativo, y es la diferencia con
 * `userIsTenantAdmin`.** `TenantsService.removeMember` da de baja la membresía
 * y **deja vivas** las filas de `roles_usuarios` a propósito (ver el docblock
 * de `fijarRolesExactos`), así que contar solo por `roles_usuarios` cuenta
 * gente que ya no es miembro. Con dos admins, dar de baja a uno y después
 * contar daría 2, y una validación de "no dejes al tenant sin admin" apoyada
 * en ese número dejaría pasar justo el caso que existe para atajar.
 *
 * `userIsTenantAdmin` puede prescindir del `JOIN` porque corre detrás de
 * `TenantGuard`, que ya exigió membresía viva. Un conteo no tiene ese guard
 * delante: cuenta a terceros.
 *
 * Una fila por (usuario, rol fijo): quien tenga dos roles fijos aparece dos
 * veces. `DISTINCT` no se puede combinar con `FOR UPDATE`, así que la
 * deduplicación la hace quien llama — a nadie le importa el número exacto,
 * solo si es cero.
 */
const ADMINISTRADORES_SQL = `
  SELECT ut.usuario_id
    FROM usuarios_tenants ut
    JOIN roles_usuarios ru
      ON ru.usuario_id = ut.usuario_id
     AND ru.tenant_id = ut.tenant_id
     AND ru.eliminado_el IS NULL
    JOIN roles r
      ON r.rol_id = ru.rol_id
     AND r.tenant_id = ru.tenant_id
     AND r.es_fijo = true
     AND r.eliminado_el IS NULL
   WHERE ut.tenant_id = $1
     AND ut.eliminado_el IS NULL
   ORDER BY ut.usuario_id, ru.rol_id`;

/**
 * Motor de permisos. Todas las consultas de acá parten de `roles_usuarios`
 * acotado por `ru.tenant_id = $2` —el tenant del token— y de ahí encadenan.
 *
 * ⚠️ **Invariante de estas cinco consultas: cada tabla que se une tiene que
 * quedar atada al MISMO tenant.** `roles_usuarios` puede tener una fila que
 * apunte a un rol de otro tenant (`RolesService.assignUser` no lo impedía), y
 * sin `r.tenant_id = ru.tenant_id` en el JOIN esa fila cruzada **se evalúa de
 * verdad**: no es inerte. Lo mismo con `tenant_modulos`, que decide qué
 * módulos tiene contratados la empresa.
 *
 * `roles.tenant_id` es nullable, así que un rol global (tenant_id NULL) no
 * matchearía. Hoy no existe ninguno —cero filas en la base, y los seis puntos
 * de inserción del seeder más `RolesService.create` siempre lo setean—, y si
 * algún día se quiere uno, que conceda permisos en todos los tenants es una
 * decisión de producto que hay que tomar a propósito, no heredar de un JOIN
 * que se olvidó de atar el tenant.
 */
@Injectable()
export class RbacService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async userHasPermiso(
    userId: string,
    tenantId: string,
    moduloNombre: string,
    permisoNombre: string,
  ): Promise<boolean> {
    // Short-circuit del rol fijo: el admin del tenant tiene TODOS los permisos…
    // **dentro de los módulos que la empresa contrató**. Los módulos son lo que
    // se vende, así que el borde es duro y también aplica al admin — antes esta
    // consulta no miraba `tenant_modulos` y el admin llegaba a cualquier ruta de
    // negocio con 200 mientras el frontend, que sí filtra por `getMisPermisos`,
    // ni le mostraba el link. `PRODUCTO.md` ya decía lo correcto ("cada ruta
    // valida rol + módulo contratado + permiso"); lo que no lo sostenía era esto.
    //
    // ⚠️ **No es un borde de aislamiento sino comercial:** nadie veía datos de
    // otro tenant, veía módulos que no pagó. Conviene no confundirlos.
    //
    // Lo que sigue diferenciando al admin del resto: no necesita que el módulo
    // esté colgado de su rol (`modulos_roles`) ni tener el permiso concreto
    // asignado (`roles_permisos_modulos`). Le basta con que el tenant lo tenga
    // contratado.
    //
    // `tm.estado` y `tm.expira_en` no se miran acá **a propósito**: la consulta
    // completa de abajo tampoco los mira, y hacer que la contratación caduque es
    // otra decisión. Que las dos ramas coincidan importa más que adivinarla.
    const fixedRole: unknown[] = await this.dataSource.query(
      `SELECT 1
       FROM roles_usuarios ru
       JOIN roles r ON r.rol_id = ru.rol_id AND r.tenant_id = ru.tenant_id
       JOIN tenant_modulos tm ON tm.tenant_id = ru.tenant_id AND tm.eliminado_el IS NULL
       JOIN modulos_app ma ON ma.modulo_app_id = tm.modulo_app_id AND ma.eliminado_el IS NULL
       WHERE ru.usuario_id = $1
         AND ru.tenant_id = $2
         AND ma.nombre = $3
         AND r.es_fijo = true
         AND ru.eliminado_el IS NULL
         AND r.eliminado_el IS NULL`,
      [userId, tenantId, moduloNombre],
    );
    if (fixedRole.length > 0) return true;

    // JOIN completo para verificar permiso específico
    const result: unknown[] = await this.dataSource.query(
      `SELECT 1
       FROM roles_usuarios ru
       JOIN roles r ON r.rol_id = ru.rol_id AND r.tenant_id = ru.tenant_id AND r.eliminado_el IS NULL
       JOIN modulos_roles mr ON mr.rol_id = r.rol_id AND mr.eliminado_el IS NULL
       JOIN tenant_modulos tm ON tm.modulo_tenant_id = mr.modulo_tenant_id AND tm.tenant_id = ru.tenant_id AND tm.eliminado_el IS NULL
       JOIN modulos_app ma ON ma.modulo_app_id = tm.modulo_app_id AND ma.eliminado_el IS NULL
       JOIN roles_permisos_modulos rpm ON rpm.rol_id = r.rol_id AND rpm.modulo_tenant_id = tm.modulo_tenant_id
       JOIN modulo_app_permisos map ON map.modulo_app_permiso_id = rpm.modulo_app_permiso_id AND map.eliminado_el IS NULL
       JOIN permisos p ON p.permiso_id = map.permiso_id AND p.eliminado_el IS NULL
       WHERE ru.usuario_id = $1
         AND ru.tenant_id = $2
         AND ma.nombre = $3
         AND p.nombre = $4
         AND ru.eliminado_el IS NULL`,
      [userId, tenantId, moduloNombre, permisoNombre],
    );
    return result.length > 0;
  }

  async userIsTenantAdmin(userId: string, tenantId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1
       FROM roles_usuarios ru
       JOIN roles r ON r.rol_id = ru.rol_id AND r.tenant_id = ru.tenant_id
       WHERE ru.usuario_id = $1
         AND ru.tenant_id = $2
         AND r.es_fijo = true
         AND ru.eliminado_el IS NULL
         AND r.eliminado_el IS NULL
       LIMIT 1`,
      [userId, tenantId],
    );
    return rows.length > 0;
  }

  /**
   * Los administradores del tenant, para decidir si una acción lo dejaría sin
   * ninguno. Criterio en `ADMINISTRADORES_SQL`.
   *
   * `manager` obligatorio y no opcional: las dos acciones que preguntan esto
   * —quitarle el rol a alguien y darlo de baja— tienen que contar y mutar en
   * la MISMA transacción, o el conteo no vale nada. Pedirlo por parámetro
   * hace imposible el descuido de contar por fuera con un repositorio
   * inyectado, que además sería una segunda conexión del pool tomada mientras
   * la transacción retiene la primera.
   *
   * **`lock: true` en la primera llamada de la transacción, `false` en la
   * verificación posterior.** El `FOR UPDATE` es lo que hace que la
   * validación valga bajo concurrencia: sin él, dos requests que sacan a los
   * dos últimos admins pasan los dos chequeos —cada transacción no ve el
   * borrado no commiteado de la otra— y el tenant queda huérfano igual.
   * Bloqueadas las filas, la segunda espera, y al reevaluar la calificación
   * ve el `eliminado_el` de la primera y cuenta uno menos.
   *
   * `FOR UPDATE OF ut, ru` y no a secas: sin el `OF`, Postgres también
   * bloquearía `roles`, que es catálogo compartido del tenant y no tiene por
   * qué serializarse acá (mismo criterio que `inventario.service.ts:94`).
   * El `ORDER BY` del SQL importa por lo mismo: los dos caminos que toman
   * este lock —`RolesService.removeUser` y `TenantsService.removeMember`—
   * usan esta única consulta, así que piden las filas en el mismo orden y no
   * pueden deadlockearse entre sí.
   */
  async administradoresDe(
    manager: EntityManager,
    tenantId: string,
    lock: boolean,
  ): Promise<string[]> {
    const filas: { usuario_id: string }[] = await manager.query(
      lock
        ? `${ADMINISTRADORES_SQL} FOR UPDATE OF ut, ru`
        : ADMINISTRADORES_SQL,
      [tenantId],
    );
    return [...new Set(filas.map((f) => f.usuario_id))];
  }

  async getMisPermisos(userId: string, tenantId: string): Promise<string[]> {
    // Caso 1: usuario tiene rol es_fijo = true → devolver TODOS los permisos del tenant
    const hasFixedRole: unknown[] = await this.dataSource.query(
      `SELECT 1
       FROM roles_usuarios ru
       JOIN roles r ON r.rol_id = ru.rol_id AND r.tenant_id = ru.tenant_id
       WHERE ru.usuario_id = $1
         AND ru.tenant_id = $2
         AND r.es_fijo = true
         AND ru.eliminado_el IS NULL
         AND r.eliminado_el IS NULL
       LIMIT 1`,
      [userId, tenantId],
    );

    if (hasFixedRole.length > 0) {
      // Devolver todos los permisos de los módulos contratados por el tenant
      const rows: { modulo: string; permiso: string }[] =
        await this.dataSource.query(
          `SELECT DISTINCT ma.nombre AS modulo, p.nombre AS permiso
           FROM tenant_modulos tm
           JOIN modulos_app ma ON ma.modulo_app_id = tm.modulo_app_id
           JOIN modulo_app_permisos map ON map.modulo_app_id = ma.modulo_app_id
           JOIN permisos p ON p.permiso_id = map.permiso_id
           WHERE tm.tenant_id = $1
             AND tm.eliminado_el IS NULL
             AND ma.eliminado_el IS NULL
             AND map.eliminado_el IS NULL
             AND p.eliminado_el IS NULL`,
          [tenantId],
        );
      return rows.map((r) => `${r.modulo}:${r.permiso}`);
    }

    // Caso 2: usuario sin rol fijo → devolver solo permisos asignados
    const rows: { modulo: string; permiso: string }[] =
      await this.dataSource.query(
        `SELECT DISTINCT ma.nombre AS modulo, p.nombre AS permiso
         FROM roles_usuarios ru
         JOIN roles r ON r.rol_id = ru.rol_id AND r.tenant_id = ru.tenant_id AND r.eliminado_el IS NULL
         JOIN modulos_roles mr ON mr.rol_id = r.rol_id AND mr.eliminado_el IS NULL
         JOIN tenant_modulos tm ON tm.modulo_tenant_id = mr.modulo_tenant_id AND tm.tenant_id = ru.tenant_id AND tm.eliminado_el IS NULL
         JOIN modulos_app ma ON ma.modulo_app_id = tm.modulo_app_id AND ma.eliminado_el IS NULL
         JOIN roles_permisos_modulos rpm ON rpm.rol_id = r.rol_id AND rpm.modulo_tenant_id = tm.modulo_tenant_id
         JOIN modulo_app_permisos map ON map.modulo_app_permiso_id = rpm.modulo_app_permiso_id AND map.eliminado_el IS NULL
         JOIN permisos p ON p.permiso_id = map.permiso_id AND p.eliminado_el IS NULL
         WHERE ru.usuario_id = $1
           AND ru.tenant_id = $2
           AND ru.eliminado_el IS NULL`,
        [userId, tenantId],
      );

    return rows.map((r) => `${r.modulo}:${r.permiso}`);
  }
}
