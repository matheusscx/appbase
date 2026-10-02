import { devueltoSql } from './devuelto-venta';

describe('devueltoSql', () => {
  const sql = devueltoSql({
    idxTenant: 1,
    ventanas: {
      hoy: (columna) => `${columna} >= HOY`,
      siempre: () => 'TRUE',
    },
  });

  it('efectivo: la salida de caja atada a una corrección, no cualquier salida', () => {
    expect(sql).toMatch(
      /FROM movimientos_caja dv_mc\s+JOIN ventas dv_nc[\s\S]*?dv_nc\.venta_referencia_id IS NOT NULL[\s\S]*?dv_nc\.tenant_id = \$1[\s\S]*?dv_nc\.eliminado_el IS NULL[\s\S]*?dv_mc\.tipo = 'salida'[\s\S]*?dv_mc\.eliminado_el IS NULL/,
    );
  });

  it('máquina: la corrección por un pago que NO dejó salida de caja (cada filtro impide contar dos veces)', () => {
    expect(sql).toMatch(
      /FROM ventas dv_nc\s+WHERE dv_nc\.tenant_id = \$1[\s\S]*?dv_nc\.venta_referencia_id IS NOT NULL[\s\S]*?dv_nc\.devolucion_via = 'pago'[\s\S]*?dv_nc\.eliminado_el IS NULL[\s\S]*?AND NOT EXISTS \([\s\S]*?FROM movimientos_caja dv_mc[\s\S]*?dv_mc\.venta_id = dv_nc\.venta_id[\s\S]*?dv_mc\.tipo = 'salida'[\s\S]*?dv_mc\.eliminado_el IS NULL/,
    );
  });

  it('REFUND: aprobado, de una orden con venta, ambos lados sin borrar', () => {
    expect(sql).toMatch(
      /FROM pasarela_transacciones dv_t\s+JOIN pasarela_ordenes dv_o[\s\S]*?dv_o\.venta_id IS NOT NULL[\s\S]*?dv_o\.eliminado_el IS NULL[\s\S]*?dv_t\.tenant_id = \$1[\s\S]*?dv_t\.tipo = 'REFUND'[\s\S]*?dv_t\.estado = 'aprobada'[\s\S]*?dv_t\.eliminado_el IS NULL/,
    );
  });

  it('cada ventana filtra cada bloque por SU fecha y suma los tres en una columna', () => {
    expect(sql).toContain(
      'FILTER (WHERE dv_mc.fecha >= HOY), 0) AS efectivo_hoy',
    );
    expect(sql).toContain(
      'FILTER (WHERE dv_nc.fecha >= HOY), 0) AS maquina_hoy',
    );
    expect(sql).toContain(
      'FILTER (WHERE dv_t.fecha_transaccion >= HOY), 0) AS pasarela_hoy',
    );
    expect(sql).toContain(
      '(dv_e.efectivo_hoy + dv_m.maquina_hoy + dv_r.pasarela_hoy)::text AS devuelto_hoy',
    );
    expect(sql).toContain('FILTER (WHERE TRUE), 0) AS efectivo_siempre');
    expect(sql).toContain(
      '(dv_e.efectivo_siempre + dv_m.maquina_siempre + dv_r.pasarela_siempre)::text AS devuelto_siempre',
    );
  });

  describe('con alcance', () => {
    const conAlcance = devueltoSql({
      idxTenant: 1,
      ventanas: { hoy: () => 'TRUE' },
      alcance: (f) => `MIO(${f.ventaId}, ${f.cajaId}, ${f.tenantId})`,
    });

    it('una devolución es del pago que reversa; sin él, de la venta que corrige y su caja (efectivo y máquina)', () => {
      const porCorreccion =
        /CASE\s+WHEN dv_nc\.devolucion_pago_id IS NOT NULL THEN EXISTS \(\s*SELECT 1 FROM pagos dv_dp\s+WHERE dv_dp\.pago_id = dv_nc\.devolucion_pago_id[\s\S]*?dv_dp\.eliminado_el IS NULL\s+AND MIO\(dv_dp\.venta_id, dv_dp\.caja_id, dv_dp\.tenant_id\)\s*\)\s*ELSE MIO\(dv_nc\.venta_referencia_id, dv_nc\.caja_id, dv_nc\.tenant_id\)\s*END/g;
      // Una vez en el bloque del efectivo y otra en el de la máquina.
      expect(conAlcance.match(porCorreccion)).toHaveLength(2);
    });

    it('un REFUND entra solo por la venta: la caja va en NULL', () => {
      expect(conAlcance).toContain(
        'AND MIO(dv_o.venta_id, NULL, dv_t.tenant_id)',
      );
    });

    it('sin alcance no se agrega ninguna condición', () => {
      expect(sql).not.toContain('dv_dp');
    });
  });
});
