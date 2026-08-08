-- 004_pagare_propuesta.sql — PROPUESTA de esquema para CU-005 actualizado
-- (preparación del sobre, generación y firma del pagaré).
-- Igual que 003: propuesta de base de datos, sin lógica de negocio todavía.

CREATE TABLE IF NOT EXISTS plan_pagos (
  id serial PRIMARY KEY,
  solicitud_id int NOT NULL REFERENCES solicitudes(id),
  numero_pago int NOT NULL,
  fecha_programada text NOT NULL,
  capital numeric NOT NULL,
  interes numeric NOT NULL,
  iva numeric NOT NULL,
  cuota numeric NOT NULL,               -- capital + interes + iva
  metodo text NOT NULL                  -- "interes_fijo" | "saldo_insoluto" (Fórmulas de Cálculo Karina)
);

CREATE TABLE IF NOT EXISTS pagares (
  id serial PRIMARY KEY,
  solicitud_id int NOT NULL REFERENCES solicitudes(id),
  tipo text NOT NULL,                   -- individual | grupal
  producto text NOT NULL,               -- del catálogo único
  razon_social text NOT NULL DEFAULT 'FOOAX, S.A. de C.V.',
  monto numeric NOT NULL,
  tasa_interes numeric NOT NULL,
  dias_gracia int NOT NULL,             -- parámetro — ver discrepancia abierta en CU-005 §10
  integrantes_al_desembolso jsonb,      -- snapshot de firmas requeridas al momento exacto del desembolso
  generado_ts bigint NOT NULL,
  version_catalogo_productos text       -- para poder revisar después si el nombre del producto cambió
);

CREATE TABLE IF NOT EXISTS custodia_pagares (
  id serial PRIMARY KEY,
  pagare_id int NOT NULL REFERENCES pagares(id),
  evento text NOT NULL,                 -- entro | salio
  a_quien text,
  ts bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS sobres_dispersion (
  id serial PRIMARY KEY,
  solicitud_id int NOT NULL REFERENCES solicitudes(id),
  monto_autorizado numeric NOT NULL,
  comision_apertura numeric NOT NULL,
  neto numeric NOT NULL,                -- monto_autorizado - comision_apertura
  modalidad_entrega text NOT NULL,      -- efectivo | transferencia | cheque
  firma_recepcion_campo text,           -- cadena de custodia: Control Operativo -> Gerencia de Campo
  firma_entrega_clienta text,
  gps_entrega text,
  fecha_desembolso bigint,              -- HOY NO EXISTE en el sistema — es el dato crítico que faltaba
  creado_ts bigint NOT NULL
);
