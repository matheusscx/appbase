import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * Recorre TODAS las páginas de un listado paginado (`page` + `pageSize`, máx.
 * 100, `common/utils/pagination.util.ts`) y junta su `data`. Para afirmar que
 * ninguna fila cumple algo: mirar solo la primera página deja pasar la fila
 * que el orden del listado mandó a la segunda.
 *
 * Los listados paginan con OFFSET sobre un `ORDER BY` sin desempate
 * (`nombre`, `creado_el`): entre dos páginas, dos filas empatadas pueden
 * cambiar de lugar y una quedar sin mirar. Por eso cierra afirmando que vio
 * `meta.total` ids distintos.
 *
 * `url` trae sus demás query params (`estado=pendiente`, `pageSize=100`…) sin
 * `page`, que lo agrega este helper.
 */
export async function todasLasPaginas<T extends { id: string }>(
  app: INestApplication<App>,
  token: string,
  url: string,
): Promise<T[]> {
  const separador = url.includes('?') ? '&' : '?';

  const primera = await request(app.getHttpServer())
    .get(`${url}${separador}page=1`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const { total, totalPages } = (
    primera.body as { meta: { total: number; totalPages: number } }
  ).meta;
  let datos = (primera.body as { data: T[] }).data;

  for (let page = 2; page <= totalPages; page++) {
    const res = await request(app.getHttpServer())
      .get(`${url}${separador}page=${page}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    datos = datos.concat((res.body as { data: T[] }).data);
  }

  expect(new Set(datos.map((d) => d.id)).size).toBe(total);
  return datos;
}
