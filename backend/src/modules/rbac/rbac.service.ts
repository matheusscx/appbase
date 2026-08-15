import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

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
    // Short-circuit: si el usuario tiene algún rol es_fijo=true en este tenant → acceso total
    const fixedRole: unknown[] = await this.dataSource.query(
      `SELECT 1
       FROM roles_usuarios ru
       JOIN roles r ON r.rol_id = ru.rol_id AND r.tenant_id = ru.tenant_id
       WHERE ru.usuario_id = $1
         AND ru.tenant_id = $2
         AND r.es_fijo = true
         AND ru.eliminado_el IS NULL
         AND r.eliminado_el IS NULL`,
      [userId, tenantId],
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
