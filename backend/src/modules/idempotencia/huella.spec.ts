import { huellaDe } from './huella';

describe('huellaDe', () => {
  it('no depende del orden de las claves, a ninguna profundidad', () => {
    const a = {
      lineas: [{ itemId: 'i1', cantidad: '2' }],
      pagos: [{ monto: '10', metodoPagoId: 'm' }],
    };
    const b = {
      pagos: [{ metodoPagoId: 'm', monto: '10' }],
      lineas: [{ cantidad: '2', itemId: 'i1' }],
    };
    expect(huellaDe('venta.crear', a)).toBe(huellaDe('venta.crear', b));
  });

  it('cambia con cualquier dato del cobro', () => {
    const tarjeta = { pagos: [{ metodoPagoId: 'tarjeta', monto: '12000' }] };
    const efectivo = { pagos: [{ metodoPagoId: 'efectivo', monto: '12000' }] };
    expect(huellaDe('venta.crear', tarjeta)).not.toBe(
      huellaDe('venta.crear', efectivo),
    );
  });

  it('el orden de un array sí importa: dos líneas no son intercambiables en el motor', () => {
    expect(huellaDe('venta.crear', { l: ['a', 'b'] })).not.toBe(
      huellaDe('venta.crear', { l: ['b', 'a'] }),
    );
  });

  it('la operación es parte de la huella', () => {
    expect(huellaDe('venta.crear', { x: 1 })).not.toBe(
      huellaDe('pago.abono', { x: 1 }),
    );
  });

  it('trata igual una instancia de clase que su objeto plano', () => {
    class Dto {
      monto = '10';
    }
    expect(huellaDe('pago.abono', new Dto())).toBe(
      huellaDe('pago.abono', { monto: '10' }),
    );
  });

  it('es un SHA-256 en hex', () => {
    expect(huellaDe('venta.crear', {})).toMatch(/^[0-9a-f]{64}$/);
  });
});
