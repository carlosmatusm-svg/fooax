// Genera una llave de 32 bytes para DOC_ENCRYPTION_KEY (cifrado de
// documentos del expediente). Correrla UNA vez y guardar el resultado como
// variable de entorno en Railway — nunca en el código ni en el repositorio.
//
//   node scripts/generar-llave-cifrado.js
const crypto = require("crypto");
console.log(crypto.randomBytes(32).toString("base64"));
