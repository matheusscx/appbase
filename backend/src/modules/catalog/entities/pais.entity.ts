import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Check,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type {
  ModoRedondeo,
  NivelRedondeo,
} from '../../calculo-precios/calculo-precios.engine';

@Entity('pais')
@Check(
  'chk_pais_modo_redondeo_ley',
  '(NOT "modo_redondeo_es_ley") OR ("modo_redondeo_sugerido" IS NOT NULL)',
)
@Check(
  'chk_pais_nivel_redondeo_ley',
  '(NOT "nivel_redondeo_es_ley") OR ("nivel_redondeo_sugerido" IS NOT NULL)',
)
export class Pais {
  @PrimaryGeneratedColumn('uuid', { name: 'pais_id' })
  paisId: string;

  @Column()
  nombre: string;

  @Column({ name: 'codigo_iso', type: 'char', length: 2, unique: true })
  codigoIso: string;

  @Column({ name: 'zona_horaria_principal' })
  zonaHorariaPrincipal: string;

  @Column({ name: 'moneda_oficial_id', type: 'uuid', nullable: true })
  monedaOficialId: string | null;

  /**
   * El trío por perilla de redondeo: qué **sugiere** el país, si además es
   * **ley**, y cuál es la **norma** que lo dice. Son dos perillas
   * independientes: México fija el nivel y deja libre el modo, y Argentina al
   * revés — por eso el candado es por perilla y no por país.
   *
   * ⛔ El `type` explícito no se puede sacar: `ModoRedondeo` entra por
   * `import type`, la referencia se borra al compilar y el metadato
   * `design:type` queda en `Object` — Postgres corta el arranque con
   * `DataTypeNotSupportedError`. Ya pasó en este repo con
   * `tenants.modo_redondeo`, y solo lo cazó el e2e.
   *
   * `norma` NO es decorativa: es literalmente lo que la pantalla le muestra al
   * tenant cuando la perilla está bloqueada. Un candado sin motivo se lee como
   * un bug del sistema, no como una regla del país. Los dos `@Check` de arriba
   * son los que impiden declarar "es ley" sin un valor que imponer.
   */
  @Column({ name: 'modo_redondeo_sugerido', type: 'varchar', nullable: true })
  modoRedondeoSugerido: ModoRedondeo | null;

  @Column({ name: 'modo_redondeo_es_ley', type: 'boolean', default: false })
  modoRedondeoEsLey: boolean;

  @Column({ name: 'modo_redondeo_norma', type: 'text', nullable: true })
  modoRedondeoNorma: string | null;

  @Column({ name: 'nivel_redondeo_sugerido', type: 'text', nullable: true })
  nivelRedondeoSugerido: NivelRedondeo | null;

  @Column({ name: 'nivel_redondeo_es_ley', type: 'boolean', default: false })
  nivelRedondeoEsLey: boolean;

  @Column({ name: 'nivel_redondeo_norma', type: 'text', nullable: true })
  nivelRedondeoNorma: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date;
}
