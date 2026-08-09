-- 003_originacion_propuesta.sql — PROPUESTA de esquema para CU-011 (solicitud
-- de crédito), CU-012 (análisis y dictamen) y CU-013 (autorización).
--
-- A diferencia de 001 y 002, este archivo NO está conectado todavía a ningún
-- store.js/rutas.js — es la propuesta de base de datos que pide esta fase,
-- para que Dirección, Contaduría y control interno la revisen antes de que
-- se escriba la lógica de negocio encima (Anexo E: "este módulo no debe
-- entrar en operación hasta contar con la validación de Contaduría").
-- Aplicarla no activa ninguna pantalla nueva por sí sola.

CREATE TABLE IF NOT EXISTS grupos (
  id serial PRIMARY KEY,
  id_sucursal text,
  centro text,                        -- catálogo C-1 a C-88
  nombre text,
  jefa_centro_clienta_id text,
  creado_ts bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS grupos_integrantes (
  id serial PRIMARY KEY,
  grupo_id int NOT NULL REFERENCES grupos(id),
  clienta_id text NOT NULL,
  activo boolean NOT NULL DEFAULT true,  -- false cuando la integrante sale antes de tiempo
  desde bigint NOT NULL,
  hasta bigint
);

CREATE TABLE IF NOT EXISTS parametros_autorizacion (
  id serial PRIMARY KEY,
  monto_desde numeric NOT NULL,
  monto_hasta numeric,                 -- NULL = sin techo (excepción por escrito)
  puesto_autoriza text NOT NULL,
  requisitos text,
  vigente_desde bigint NOT NULL,
  vigente_hasta bigint                 -- editable por Dirección sin tocar código
);

CREATE TABLE IF NOT EXISTS solicitudes (
  id serial PRIMARY KEY,
  id_sucursal text,
  clienta_id text NOT NULL,
  grupo_id int REFERENCES grupos(id),   -- NULL si no es grupal
  producto text NOT NULL,               -- del catálogo único, nunca texto libre
  monto_solicitado numeric NOT NULL,
  plazo_solicitado int NOT NULL,
  destino text,
  centro text,
  ciclo_numero int,
  originado_por text NOT NULL,          -- usuario; el candado de producto-por-puesto se valida en la ruta
  creado_ts bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS visitas (
  id serial PRIMARY KEY,
  solicitud_id int NOT NULL REFERENCES solicitudes(id),
  gps text,
  fotos jsonb,                          -- referencias a documentos, no el binario
  semaforo text,                        -- verde | amarillo | rojo
  firma text,
  creado_ts bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS analisis_buro (
  id serial PRIMARY KEY,
  solicitud_id int NOT NULL REFERENCES solicitudes(id),
  firma_autorizacion_id int REFERENCES firmas(id), -- debe existir ANTES de consultar (Art. 28 LRSIC)
  deudas_externas jsonb,                -- [{institucion, saldo, cuota, frecuencia}], NUNCA el reporte íntegro
  indice_carga_externa numeric,
  clasificacion text,                   -- sana | candidata_consolidacion | sobreendeudada
  consultado_por text NOT NULL,
  consultado_ts bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS dictamenes (
  id serial PRIMARY KEY,
  solicitud_id int NOT NULL REFERENCES solicitudes(id),
  puntaje numeric,                      -- sobre 100
  decision text NOT NULL,               -- aprobado | condicionado | rechazado
  monto_sugerido numeric,
  nivel_autorizacion_requerido text,    -- calculado contra parametros_autorizacion
  alertas jsonb,
  propuesta_consolidacion jsonb,        -- si aplica: plazo extendido, ahorro mensual
  generado_ts bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS autorizaciones (
  id serial PRIMARY KEY,
  solicitud_id int NOT NULL REFERENCES solicitudes(id),
  decision text NOT NULL,               -- autoriza | rechaza | modifica
  monto_autorizado numeric,
  autorizado_por text NOT NULL,         -- candado: solo puesto direccion_general
  ts bigint NOT NULL
);
