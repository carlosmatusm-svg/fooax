# PLAN DE RESCATE DE DATOS — Sistema FOOAX anterior

**Situación:** el desarrollador anterior (Ing. José Manuel) va a ser dado de baja. Su
sistema (`fooaxclient/fooaxserver-production.up.railway.app`) contiene datos reales de
FOOAX: préstamos, clientes, centros, pagos, ahorros, mora. Hay que asegurar una copia
**antes** de que se corte cualquier acceso.

## Regla de oro
**Primero la copia, después el corte. Nunca al revés.**
Mientras FOOAX tenga acceso válido (un usuario admin que funcione), tiene derecho a
exportar sus propios datos. El día que se cambie una contraseña o se apague el Railway,
esa ventana se cierra. No cortes nada hasta tener el respaldo verificado en mano.

## Los datos son de FOOAX (no del desarrollador)
Los préstamos, clientes y pagos son información del negocio de FOOAX. Un desarrollador
entrega el sistema y los datos al cliente; retenerlos no es defendible. Pero *la posesión
manda*: consigue la copia por las buenas mientras se pueda, sin depender de su buena fe.

---

## Plan por capas (de lo mejor a lo mínimo)

### Capa 1 — La entrega ordenada (lo ideal, pídelo ANTES de despedir)
Solicita al Ing. José Manuel, como cierre profesional normal (no como pelea):
1. **Respaldo de la base de datos** (un archivo `pg_dump` / `.sql` de la BD de Railway).
2. **El código fuente** (el repositorio completo).
3. **Transferencia del proyecto de Railway** a la cuenta de FOOAX (o al menos las
   credenciales de la base).

Amárralo a su último pago si queda algo pendiente: *el finiquito se entrega contra estos
3 archivos*. Es la práctica estándar y nadie puede ofenderse por pedirla. Si coopera,
con esto tienes TODO y las otras capas sobran.

### Capa 2 — Auto-exportación con la cuenta de FOOAX (no depende de él)
El sistema tiene un botón de **exportar todo a Excel** y ~30 reportes. Con un usuario
admin de FOOAX se baja todo sin ayuda del desarrollador:

- **Opción fácil (sin técnica):** entra a la página con la cuenta admin, ve a Reportes,
  y descarga cada Excel — sobre todo el "export completo". Guarda los archivos.
- **Opción automática:** el script `backup_fooax_anterior.js` (en esta carpeta) hace
  login con la cuenta de FOOAX y baja los ~30 reportes + tablas de un jalón. Lo corres
  tú, con permiso de tu prima:
  ```
  cd /Users/karinamatus/fooax-cobranza/rescate
  FOOAX_USER="correo_admin" FOOAX_PASS="clave" node backup_fooax_anterior.js
  ```

### Capa 3 — Grabación del navegador (red de seguridad, cero técnica)
Si algo de lo anterior falla, entra a la página logueada, abre las Herramientas de
Desarrollador del navegador (F12) → pestaña **Network/Red** → marca "Preserve log" →
navega por TODAS las pantallas (clientes, préstamos, centros, mora, reportes) →
click derecho → **"Save all as HAR"**. Ese archivo `.har` contiene los datos de cada
pantalla que abriste. No es lo más limpio, pero rescata lo que hayas visto.

---

## Qué necesito de ti para ejecutar
1. **Usuario y contraseña de un admin de FOOAX** en el sistema anterior (para las capas 2 y 3).
2. **¿La cuenta de Railway es de FOOAX o de él?** Es la pregunta clave:
   - Si es de FOOAX → tienen el control, solo hay que tomar el respaldo y cambiar contraseñas.
   - Si es de él → capa 1 y 2 URGENTES antes de cortar; asuman que el acceso puede cerrarse
     cualquier día.
3. **Confirma con tu prima** que autoriza bajar los datos (es su información; solo para tener
   el consentimiento explícito por escrito).

## Orden de acción sugerido
1. Hoy: pide a José Manuel el respaldo + código + Railway (capa 1), con tono de cierre normal.
2. En paralelo, sin avisar ni esperar: baja todo con la cuenta admin (capa 2).
3. Verifica que los archivos abren y traen datos reales.
4. Solo entonces: cambien contraseñas / transfieran Railway / den de baja el acceso.
5. Guarda 2 copias del respaldo (una en la compu de Monse, otra en el Drive de FOOAX).

## Después del rescate
Estos datos alimentan la migración de la Fase 1 del sistema nuevo: los reactivamos a la
base PostgreSQL nueva con `credito_id` único, y así los 22 meses del sistema anterior no
se pierden — se heredan limpios al sistema que sí captura offline.
