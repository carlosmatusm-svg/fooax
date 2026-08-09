// Genera el hash scrypt de una contraseña, para migrar los valores de
// PASS_* en Railway del texto plano actual al formato nuevo ("scrypt$...").
// El login (server.js) acepta ambos formatos mientras se migra, así que se
// puede hacer usuario por usuario sin tumbar sesiones de nadie.
//
//   node scripts/hash-password.js "la-contraseña-actual"
//
// Copia el resultado como el nuevo valor de la variable PASS_<USUARIO> en
// Railway. Después de cambiarla ahí, ese usuario ya entra con hash real.
const { hashPassword } = require("../cifrado");
const password = process.argv[2];
if (!password) {
  console.error("Uso: node scripts/hash-password.js \"la-contraseña\"");
  process.exit(1);
}
console.log(hashPassword(password));
