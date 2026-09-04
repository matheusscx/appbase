import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';

const TENANT_DEMO = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)

interface TokenResponse {
  access_token: string;
}

/**
 * La nota de crédito deja de ser un monto suelto: se compone de líneas con neto
 * e IVA derivados del documento que corrige.
 */
describe('Nota de crédito compuesta (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin.paris@paris.cl', password: 'admin' });
    expect(resLogin.status).toBe(200);

    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: TENANT_DEMO });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('el ítem de sistema "Ajuste"', () => {
    it('es exactamente uno por tenant, de tipo servicio y sin stock', async () => {
      const filas: { item_id: string; tipo: string; activo: boolean }[] =
        await ds.query(
          `SELECT i.item_id, i.tipo, i.activo
             FROM items i
            WHERE i.tenant_id = $1 AND i.es_ajuste_nota_credito = true
              AND i.eliminado_el IS NULL`,
          [TENANT_DEMO],
        );
      expect(filas).toHaveLength(1);
      expect(filas[0].tipo).toBe('servicio');
      expect(filas[0].activo).toBe(false);

      // Solo `tipo='producto'` tiene stock: la línea de ajuste no repone nada.
      const producto: unknown[] = await ds.query(
        `SELECT 1 FROM item_producto WHERE item_id = $1`,
        [filas[0].item_id],
      );
      expect(producto).toHaveLength(0);

      // Y su fila de extensión sí existe: todo `servicio` la tiene.
      const servicio: unknown[] = await ds.query(
        `SELECT 1 FROM item_servicio WHERE item_id = $1`,
        [filas[0].item_id],
      );
      expect(servicio).toHaveLength(1);
    });

    it('no aparece en ningún listado del catálogo', async () => {
      // Nacer pausado NO alcanza: las pantallas de configuración que alimentan
      // los selectores del negocio —scope de promociones, componentes de
      // combo, opciones de un grupo de modificadores— piden el listado SIN
      // filtrar `activo`. Así que el ítem de sistema se excluye del listado
      // entero, igual que el garzón placeholder.
      const marcado: { item_id: string }[] = await ds.query(
        `SELECT item_id FROM items
          WHERE tenant_id = $1 AND es_ajuste_nota_credito = true
            AND eliminado_el IS NULL`,
        [TENANT_DEMO],
      );
      const ajusteId = marcado[0].item_id;

      // `ORDER BY nombre ASC`: si no se excluyera, 'Ajuste' sería de las
      // primeras filas de la primera página. La aserción sobre `length` es lo
      // que impide que este test pase por una lista vacía.
      const listado = await request(app.getHttpServer())
        .get('/api/items?pageSize=100')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const ids = (listado.body as { data: { id: string }[] }).data.map(
        (i) => i.id,
      );
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).not.toContain(ajusteId);

      // Tampoco por la papelera, que es el otro modo de este mismo listado.
      const papelera = await request(app.getHttpServer())
        .get('/api/items?pageSize=100&incluirEliminados=true')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const idsPapelera = (
        papelera.body as { data: { id: string }[] }
      ).data.map((i) => i.id);
      expect(idsPapelera).not.toContain(ajusteId);
    });

    it('no se puede eliminar: es de sistema', async () => {
      // Sin este corte queda un camino a un 500: borrarlo hace que la
      // siguiente nota de crédito cree otro, y restaurar el borrado dejaría
      // dos vivos contra `uq_item_ajuste_nc_tenant`.
      const marcado: { item_id: string }[] = await ds.query(
        `SELECT item_id FROM items
          WHERE tenant_id = $1 AND es_ajuste_nota_credito = true
            AND eliminado_el IS NULL`,
        [TENANT_DEMO],
      );
      const res = await request(app.getHttpServer())
        .delete(`/api/items/${marcado[0].item_id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('sistema');

      const sigueVivo: unknown[] = await ds.query(
        `SELECT 1 FROM items WHERE item_id = $1 AND eliminado_el IS NULL`,
        [marcado[0].item_id],
      );
      expect(sigueVivo).toHaveLength(1);
    });

    it('el índice único no deja dos ítems de ajuste en el mismo tenant', async () => {
      // Con dos filas marcadas, cuál se usa dependería del orden del planner.
      //
      // ⚠️ Transacción que SIEMPRE revierte, por el día en que este test tenga
      // que atrapar la regresión de verdad: sin el índice el INSERT pasa, y la
      // fila sobrante impediría CREAR el índice en el próximo arranque — el
      // backend no levantaría hasta limpiarla a mano. Mismo patrón que
      // `nota-credito-por-pais.e2e-spec.ts`.
      const moneda: { moneda_id: string }[] = await ds.query(
        `SELECT i.moneda_id FROM items i
          WHERE i.tenant_id = $1 AND i.es_ajuste_nota_credito = true
            AND i.eliminado_el IS NULL`,
        [TENANT_DEMO],
      );
      let errorDelInsert: unknown;
      await ds
        .transaction(async (m) => {
          try {
            await m.query(
              `INSERT INTO items
                 (item_id, tenant_id, moneda_id, nombre, precio_base,
                  precio_incluye_impuesto, activo, tipo,
                  clasificacion_tributaria, es_ajuste_nota_credito)
               VALUES ($1, $2, $3, 'Ajuste duplicado', 0, false, false,
                       'servicio', 'afecto', true)`,
              [randomUUID(), TENANT_DEMO, moneda[0].moneda_id],
            );
          } catch (e) {
            errorDelInsert = e;
          }
          throw new Error('rollback deliberado');
        })
        .catch(() => undefined);

      // Por el NOMBRE del índice: un INSERT puede fallar por una columna
      // faltante y dar la misma sensación de cobertura sin cobertura.
      expect((errorDelInsert as Error | undefined)?.message).toContain(
        'uq_item_ajuste_nc_tenant',
      );

      const sobrantes: unknown[] = await ds.query(
        `SELECT 1 FROM items WHERE tenant_id = $1 AND nombre = 'Ajuste duplicado'`,
        [TENANT_DEMO],
      );
      expect(sobrantes).toHaveLength(0);
    });
  });
});
