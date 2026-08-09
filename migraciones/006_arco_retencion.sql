-- 006_arco_retencion.sql — Derechos ARCO (LFPDPPP) y retención PLD
-- (LFPIORPI). Documenta lo que store_expediente.js crea al arrancar.

-- Solicitudes de Derechos ARCO (Acceso, Rectificación, Cancelación,
-- Oposición) — trazabilidad de quién pidió qué y quién lo atendió, aparte de
-- la bitácora general (aquí queda agrupada toda una misma solicitud en un
-- solo renglón, con su resultado). "Cancelación" en este sistema SIEMPRE es
-- anonimización, nunca DELETE — mismo principio de "nunca se borra" que ya
-- rige movimientos y bitácora en el resto del sistema.
CREATE TABLE IF NOT EXISTS solicitudes_arco (
  id serial PRIMARY KEY,
  tipo text NOT NULL,              -- exportar | anonimizar
  entidad text NOT NULL,           -- clienta | responsable | aval | referencia
  entidad_id text NOT NULL,
  solicitado_por text,             -- quién ejerció su derecho (si se identificó); puede quedar vacío
  atendido_por text NOT NULL,      -- usuario del sistema que lo procesó
  motivo text,                     -- obligatorio para "anonimizar" (ver rutas_expediente.js)
  ts_solicitud bigint NOT NULL,
  resultado jsonb
);

-- Retención PLD (LFPIORPI): no crea tabla nueva — reporteRetencionPLD() en
-- store_expediente.js lee directamente de expedientes/firmas/documentos y el
-- plazo configurable (motor_reglas.js, clave "retencion_pld_anios", 10 años
-- por defecto). Es un reporte de SOLO LECTURA: señala candidatos para que
-- Dirección/Administración decidan caso por caso — nunca anonimiza ni borra
-- nada automáticamente. El endpoint es GET /api/retencion/pld.

-- ============================================================
-- RUNBOOK — bitácora verdaderamente de solo inserción (no ejecutable desde
-- código: requiere acceso directo a la base de producción en Railway, que
-- Claude no tiene). Hoy "de solo inserción" es una promesa del código
-- (registrarBitacora nunca hace UPDATE/DELETE) — esto la convierte en una
-- garantía de la base de datos, como ya señalaba la Estrategia de Desarrollo
-- Seguro FOOAX. Correr UNA VEZ contra la base de Railway, con un usuario con
-- permisos de administración (no el que usa la app día a día):
--
--   REVOKE UPDATE, DELETE ON bitacora_auditoria FROM <usuario_de_la_app>;
--   REVOKE UPDATE, DELETE ON solicitudes_arco FROM <usuario_de_la_app>;
--
-- Sustituir <usuario_de_la_app> por el rol de conexión real que usa
-- DATABASE_URL en Railway. Verificar después con:
--
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name IN ('bitacora_auditoria','solicitudes_arco');
--
-- Debe aparecer SELECT e INSERT para ese rol, pero NUNCA UPDATE ni DELETE.
-- ============================================================
