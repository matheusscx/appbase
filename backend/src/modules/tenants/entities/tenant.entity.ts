import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type {
  ModoRedondeo,
  NivelRedondeo,
} from '../../calculo-precios/calculo-precios.engine';

@Entity('tenants')
@Check(
  'chk_tenants_nivel_redondeo',
  `"nivel_redondeo" IN ('linea','documento')`,
)
export class Tenant {
  @PrimaryGeneratedColumn('uuid', { name: 'tenant_id' })
  id: string;

  @Column({ name: 'provincia_id', type: 'uuid' })
  provinciaId: string;

  @Column()
  nombre: string;

  @Column({ unique: true })
  correo: string;

  @Column({ type: 'varchar', nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', nullable: true })
  direccion: string | null;

  @Column({ name: 'calculo_descuentos', default: 'base' })
  calculoDescuentos: string;

  @Column({ name: 'calculo_recargos', default: 'base' })
  calculoRecargos: string;

  @Column({ name: 'escala_calculo', type: 'smallint', default: 6 })
  escalaCalculo: number;

  /**
   * El `type` es explícito y NO se puede sacar. TypeORM infiere el tipo de
   * columna del metadato `design:type`, y `ModoRedondeo` entra por `import type`:
   * la referencia se borra al compilar, así que el metadato queda en `Object` y
   * Postgres corta con `DataTypeNotSupportedError` al construir el esquema.
   * Pasó de verdad al estrechar la columna de `string` a la unión — lo cazó solo
   * el e2e: unit, typecheck, lint y dos revisiones independientes lo dieron por
   * "cambio sin conducta". `nivel_redondeo`, abajo, se salvó por tener ya su
   * `type` declarado.
   */
  @Column({ name: 'modo_redondeo', type: 'varchar', default: 'HALF_UP' })
  modoRedondeo: ModoRedondeo;

  /**
   * Nivel al que se cuantiza a la escala de la moneda: 'linea' cuantiza cada
   * línea y el total es suma de enteros; 'documento' deja las líneas a
   * escala_calculo y cuantiza solo el total (la regla mexicana). Decisión (c) +
   * P1 del 2026-08-20: 'documento' está frenado para monedas de 0 decimales.
   */
  @Column({ name: 'nivel_redondeo', type: 'text', default: 'linea' })
  nivelRedondeo: NivelRedondeo;

  @Column({
    name: 'monto_tolerancia',
    type: 'numeric',
    precision: 18,
    scale: 6,
    default: 0,
  })
  montoTolerancia: string;

  @Column({ name: 'arqueo_ciego', type: 'boolean', default: false })
  arqueoCiego: boolean;

  /**
   * Si una promo puede convivir con un descuento en la misma línea o venta.
   * Conducta de precio, igual que fórmula y redondeo — viaja al motor por
   * `ConfigCalculo` y se congela en `ventas.config_calculo`
   * (docs/superpowers/specs/2026-08-27-motor-promociones-design.md).
   */
  @Column({
    name: 'promos_acumulan_descuentos',
    type: 'boolean',
    default: false,
  })
  promosAcumulanDescuentos: boolean;

  /**
   * Umbral de AVISO del descuadre al cierre, en plata de la moneda oficial. Si
   * el |diferencia| de alguna línea del arqueo lo **supera**, el cajero ve la
   * advertencia, confirma y cierra. Nunca bloquea (owner, 2026-08-23).
   *
   * `'0'` = **desactivado**, no "cero tolerancia". Es lo contrario de
   * `montoTolerancia` de arriba, y es deliberado: con `0` activo cualquier peso
   * de diferencia dispararía el aviso, y un control que avisa siempre deja de
   * avisar. Escala 4 (la de las columnas de plata), no la 6 de `montoTolerancia`:
   * esto se compara contra `caja_arqueo_medio.diferencia`, que es NUMERIC(18,4).
   */
  @Column({
    name: 'umbral_descuadre_aviso',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
  })
  umbralDescuadreAviso: string;

  /**
   * Umbral ALTO. Si el |diferencia| de alguna línea lo supera, el cierre queda
   * marcado `nivel_descuadre = 'alto'` y aparece en la bandeja de pendientes de
   * revisar del encargado. Tampoco bloquea: el cajero cierra y se va.
   *
   * `'0'` = desactivado, igual que el de aviso. Si los dos están activos,
   * `TenantsService.updatePreferenciasFinancieras` exige alto >= aviso.
   */
  @Column({
    name: 'umbral_descuadre_alto',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
  })
  umbralDescuadreAlto: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
