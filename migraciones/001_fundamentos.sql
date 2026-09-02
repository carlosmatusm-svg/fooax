-- 001_fundamentos.sql — bitácora única y modelo de puestos.
-- Documenta EXACTAMENTE lo que store_expediente.js ejecuta como
-- "CREATE TABLE IF NOT EXISTS" al arrancar. No es necesario correrlo a mano
-- en Railway: el propio servidor lo crea si no existe. Sirve para que
-- Dirección y el asesor legal puedan revisar el esquema sin leer JavaScript.

-- Bitácora única (Requerimiento Maestro, sección 11): un solo registro para
-- auditoría interna, bitácora de sucursal y evidencia ante autoridad.
CREATE TABLE IF NOT EXISTS bitacora_auditoria (
  id serial PRIMARY KEY,
  ts bigint NOT NULL,              -- fecha/hora en milisegundos
  usuario text NOT NULL,           -- quién
  rol text,                        -- rol clásico (ejecutivo/direccion/admin)
  puesto text,                     -- puesto (control_operativo_sucursal, etc.)
  id_sucursal text,                -- multi-sucursal desde el día uno
  accion text NOT NULL,            -- qué se hizo (ej. "expediente.validar.aprobado")
  entidad text,                    -- sobre qué tipo de cosa (ej. "clienta")
  entidad_id text,                 -- id de esa cosa
  detalle jsonb,                   -- contexto adicional
  ip text
);

-- IMPORTANTE — no se puede expresar en SQL de creación de tabla, hay que
-- hacerlo aparte en Railway: revocar UPDATE y DELETE sobre esta tabla al rol
-- con el que la aplicación se conecta, para que "de solo inserción" sea una
-- garantía de la base de datos y no solo una promesa del código.
--   REVOKE UPDATE, DELETE ON bitacora_auditoria FROM <rol_de_la_app>;

-- Puestos (principio de arquitectura: el sistema conoce puestos, no
-- personas). Hoy los puestos viven también como texto en USUARIOS
-- (server.js) por simplicidad; esta tabla es el siguiente paso cuando se
-- quiera administrar puestos y su vigencia desde una pantalla, en vez de
-- código. No se usa todavía en las rutas — se deja lista, sin lógica encima,
-- para no construir una pantalla que aún no se pidió.
CREATE TABLE IF NOT EXISTS puestos (
  id text PRIMARY KEY,             -- ej. "control_operativo_sucursal"
  nombre text NOT NULL,            -- ej. "Control Operativo de Sucursal"
  descripcion text
);

-- Asignación de personas a puestos, con soporte de la "regla de suplencia":
-- una fila con titular=true es la dueña del puesto; una cobertura temporal es
-- otra fila con titular=false y cubre_a apuntando al usuario titular.
CREATE TABLE IF NOT EXISTS usuarios_puestos (
  id serial PRIMARY KEY,
  usuario text NOT NULL,
  puesto_id text NOT NULL REFERENCES puestos(id),
  titular boolean NOT NULL DEFAULT true,
  cubre_a text,                    -- usuario del titular, si esta fila es una cobertura
  desde bigint NOT NULL,
  hasta bigint                     -- NULL = sigue vigente
);
