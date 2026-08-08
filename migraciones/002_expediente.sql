-- 002_expediente.sql — CU-009 (alta y captura) y CU-010 (armado y validación
-- del expediente). Documenta lo que store_expediente.js crea al arrancar.

CREATE TABLE IF NOT EXISTS responsables (
  id serial PRIMARY KEY,
  id_sucursal text,
  nombre text NOT NULL,
  curp text,
  telefono text,
  domicilio text,
  ocupacion text,
  identificacion text,
  creado_ts bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS avales (
  id serial PRIMARY KEY,
  id_sucursal text,
  nombre text NOT NULL,
  curp text,
  telefono text,
  domicilio text,
  ocupacion text,
  identificacion text,
  creado_ts bigint NOT NULL
);

-- Tablas de vínculo: permiten contar cuántas clientas ACTIVAS respalda cada
-- responsable/aval (tope de 2 y 1 respectivamente) con un simple COUNT, en
-- vez de repetir el nombre de la responsable en cada crédito como texto
-- libre (que es como se pierde la posibilidad de contar el tope).
CREATE TABLE IF NOT EXISTS clientas_responsables (
  id serial PRIMARY KEY,
  clienta_id text NOT NULL,
  responsable_id int NOT NULL REFERENCES responsables(id),
  credito_id text,
  activo boolean NOT NULL DEFAULT true,
  creado_ts bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS clientas_avales (
  id serial PRIMARY KEY,
  clienta_id text NOT NULL,
  aval_id int NOT NULL REFERENCES avales(id),
  credito_id text,
  activo boolean NOT NULL DEFAULT true,
  creado_ts bigint NOT NULL
);

-- Referencias: son TERCEROS, no la clienta — requieren su propio
-- consentimiento antes de guardar sus datos (columna `consentimiento`).
CREATE TABLE IF NOT EXISTS referencias (
  id serial PRIMARY KEY,
  clienta_id text NOT NULL,
  nombre text NOT NULL,
  relacion text,
  curp text,
  telefono text,
  consentimiento boolean NOT NULL DEFAULT false,
  creado_ts bigint NOT NULL
);

-- Documentos: SIEMPRE cifrados en reposo (AES-256-GCM, ver cifrado.js). La
-- llave vive solo en la variable de entorno DOC_ENCRYPTION_KEY, nunca en la
-- base ni en el código.
CREATE TABLE IF NOT EXISTS documentos (
  id serial PRIMARY KEY,
  clienta_id text NOT NULL,
  tipo text NOT NULL,              -- ine | comprobante_domicilio | curp | foto_negocio
  propietario text NOT NULL,       -- solicitante | responsable | aval
  contenido_cifrado bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  creado_ts bigint NOT NULL,
  creado_por text
);

-- Expediente: un renglón por clienta, con el checklist calculado y el
-- candado de validación. `estatus` = 'completo' solo cuando no falta ningún
-- documento requerido; `validado_por` solo lo llena Administración y
-- Finanzas (candado por puesto, ver rutas_expediente.js).
CREATE TABLE IF NOT EXISTS expedientes (
  clienta_id text PRIMARY KEY,
  id_sucursal text,
  checklist jsonb NOT NULL DEFAULT '{}',
  estatus text NOT NULL DEFAULT 'incompleto',
  validado_por text,
  validado_ts bigint,
  motivo_rechazo text
);

-- Las TRES firmas, siempre separadas (LFPDPPP 2025 + Art. 28 LRSIC). Nunca
-- una casilla de verificación — cada firma lleva su propio sello.
CREATE TABLE IF NOT EXISTS firmas (
  id serial PRIMARY KEY,
  clienta_id text NOT NULL,
  tipo text NOT NULL,               -- solicitud | buro | datos_sensibles
  ts bigint NOT NULL,
  gps text,
  dispositivo text,
  version_aviso text
);
