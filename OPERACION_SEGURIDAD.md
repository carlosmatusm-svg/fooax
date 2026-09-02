# Operación de seguridad — tareas que Carlos debe correr a mano

Estas dos cosas no se pueden hacer desde código ni desde este entorno: requieren
acceso directo al dashboard de Railway y a GitHub, que Claude no tiene. Quedan
aquí como runbook para que no dependan de la memoria de una sola persona.

## 1 · Rotación de secretos

Qué hay hoy: `DOC_ENCRYPTION_KEY` (cifra documentos del expediente) y las
contraseñas de cada usuario (`PASS_KARINA`, `PASS_ANEL`, etc.), todas como
variables de entorno en Railway — nunca en el código ni en el repositorio.
Eso ya es correcto; lo que falta es un CUÁNDO.

- **`DOC_ENCRYPTION_KEY`**: rotarla implica volver a cifrar todos los
  documentos ya guardados (la llave vieja no puede descifrar lo cifrado con
  la nueva) — no es un cambio trivial de una variable. Mientras el volumen de
  documentos sea manejable, revisar/rotar **una vez al año**, o de inmediato
  si se sospecha que la llave se filtró (alguien con acceso a Railway ya no
  debería tenerlo, un repositorio se hizo público por error, etc.).
- **Contraseñas de usuarios**: cada persona debería cambiar la suya
  **cada 6 meses**, y de inmediato si alguien deja el equipo o hay sospecha
  de que alguien más la conoce. Generar con
  `node -e "console.log(require('crypto').randomBytes(9).toString('base64'))"`
  y guardarla directo como hash con `scripts/hash-password.js` — nunca en
  texto plano, ni siquiera de forma temporal en un chat o correo.
- **Después de rotar cualquier secreto**: actualizar la variable en Railway y
  reiniciar el servicio — Railway no relee variables de entorno sin
  reiniciar.

## 2 · Respaldos de Railway — probar una restauración real

La Estrategia de Desarrollo Seguro ya lo señaló: *"un respaldo que nunca se
restauró no es un respaldo."* Pasos para confirmarlo (hazlo en un ambiente de
prueba, nunca sobre la base de producción):

1. En el dashboard de Railway, entra a la base de PostgreSQL → pestaña
   **Backups** → confirma que hay respaldos automáticos recientes (Railway
   los hace diario en la mayoría de los planes, pero hay que verificarlo, no
   asumirlo).
2. Crea una base de datos NUEVA y desechable en Railway (o local).
3. Restaura ahí uno de los respaldos existentes.
4. Verifica que los datos restaurados tengan sentido: cuenta cuántas clientas
   hay, revisa que un crédito conocido aparezca con su saldo correcto.
5. Borra la base desechable cuando termines.

Si el paso 3 falla o los datos restaurados no cuadran, el respaldo no sirve
de nada aunque Railway diga que existe — mejor descubrirlo ahora que el día
que de verdad se necesite.

Repetir esta prueba cada vez que cambie de forma importante el esquema de la
base (como con este mismo lote de cambios: `reglas`, `solicitudes_arco`,
columnas nuevas en `expedientes`).
