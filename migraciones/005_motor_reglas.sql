-- 005_motor_reglas.sql — motor de reglas de negocio (motor_reglas.js).
-- Documenta lo que ese módulo crea al arrancar.
--
-- Reglas COMO DATOS, versionadas — nunca se hace UPDATE sobre una fila
-- vigente. Cada cambio cierra la anterior (vigente_hasta) y crea una nueva
-- (version + 1). Así se puede reconstruir qué valor de una regla aplicaba en
-- cualquier fecha pasada, y quién la aprobó y por qué.
CREATE TABLE IF NOT EXISTS reglas (
  id serial PRIMARY KEY,
  clave text NOT NULL,             -- "tope_responsable", "tope_aval", "checklist_base", "checklist_aval"...
  valor jsonb NOT NULL,             -- forma libre por clave — { maximo: 2 } o { documentos: [...] }
  version int NOT NULL,
  vigente_desde bigint NOT NULL,
  vigente_hasta bigint,             -- NULL = esta es la versión vigente ahora mismo
  aprobado_por text,                -- usuario que autorizó el cambio ("sistema" para el valor sembrado al instalar)
  motivo text,                      -- por qué se cambió — obligatorio desde la API (ver rutas_reglas.js)
  creado_ts bigint NOT NULL
);

-- Garantía a nivel de base de datos: nunca dos versiones "vigentes" a la vez
-- para la misma clave (además de que el código ya lo respeta al escribir).
CREATE UNIQUE INDEX IF NOT EXISTS reglas_vigente_unica
  ON reglas (clave) WHERE vigente_hasta IS NULL;

-- Reglas ya migradas aquí (antes vivían como constantes en
-- store_expediente.js — CHECKLIST_BASE, CHECKLIST_AVAL, y los literales 2/1
-- dentro de vincularResponsable/vincularAval):
--   tope_responsable   { maximo: 2, nota: "..." }
--   tope_aval          { maximo: 1, nota: "..." }
--   checklist_base     { documentos: [...6 documentos...], nota: "..." }
--   checklist_aval     { documentos: [...2 documentos...], nota: "..." }
-- Se siembran automáticamente al arrancar (sembrarSiFaltan() en
-- motor_reglas.js) SOLO si la clave todavía no existe, con los mismos
-- valores que el sistema ya usaba como constantes — instalar el motor de
-- reglas no cambia ningún comportamiento el día que se despliega.
--
-- Candidato futuro (no construido todavía): la escalera de autorización por
-- monto y los bloqueos automáticos de CU-012 (Anexo E) — hoy documentados
-- como "parámetros provisionales" pendientes de validar con Contadora
-- Consuelo / Ing. Emmanuel. Cuando se construya CU-012, sus reglas deben
-- vivir aquí desde el primer día, no como constantes que habría que migrar
-- después.
