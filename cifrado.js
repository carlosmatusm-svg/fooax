// cifrado.js — utilidades de cifrado en reposo para datos personales sensibles
// (documentos, imágenes) del expediente. AES-256-GCM con el módulo `crypto`
// de Node: no agrega dependencias nuevas.
//
// La llave vive SOLO en la variable de entorno DOC_ENCRYPTION_KEY (32 bytes en
// base64). Nunca en el código ni en el repositorio. Generarla una vez:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// y guardarla en Railway (o en tu .env local) como DOC_ENCRYPTION_KEY.
//
// Si la variable no existe, las funciones fallan de forma explícita (nunca
// guardan un documento sensible sin cifrar "por si acaso" — fallar cerrado,
// no abierto).
const crypto = require("crypto");

function llave() {
  const b64 = process.env.DOC_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "DOC_ENCRYPTION_KEY no está configurada. No se puede guardar un documento " +
      "sensible sin cifrar. Genera una llave con scripts/generar-llave-cifrado.js " +
      "y agrégala como variable de entorno antes de continuar."
    );
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) {
    throw new Error("DOC_ENCRYPTION_KEY debe decodificar a 32 bytes exactos (AES-256).");
  }
  return buf;
}

// Cifra un Buffer (o texto) y devuelve las tres piezas que hay que guardar:
// el contenido cifrado, el vector de inicialización (IV) y la etiqueta de
// autenticación (auth tag) de GCM — sin las tres no se puede descifrar ni
// se puede confiar en que el contenido no fue alterado.
function cifrar(contenido) {
  const buf = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido, "utf8");
  const iv = crypto.randomBytes(12); // 96 bits, el tamaño recomendado para GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", llave(), iv);
  const cifrado = Buffer.concat([cipher.update(buf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    contenido_cifrado: cifrado,
    iv,
    auth_tag: authTag,
  };
}

function descifrar({ contenido_cifrado, iv, auth_tag }) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", llave(), iv);
  decipher.setAuthTag(auth_tag);
  return Buffer.concat([decipher.update(contenido_cifrado), decipher.final()]);
}

// ---------- contraseñas (hash con sal, scrypt) ----------
// Formato guardado: "scrypt$<salt-hex>$<hash-hex>". Cualquier valor que NO
// tenga ese prefijo se trata como contraseña heredada en texto plano — así la
// migración es progresiva (ver scripts/hash-password.js) y no rompe logins el
// día del despliegue.
function hashPassword(password) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, sal, 64);
  return `scrypt$${sal.toString("hex")}$${hash.toString("hex")}`;
}

function verificarPassword(password, guardado) {
  if (!guardado) return false;
  if (guardado.startsWith("scrypt$")) {
    const [, salHex, hashHex] = guardado.split("$");
    const sal = Buffer.from(salHex, "hex");
    const esperado = Buffer.from(hashHex, "hex");
    const calculado = crypto.scryptSync(password, sal, 64);
    if (calculado.length !== esperado.length) return false;
    return crypto.timingSafeEqual(calculado, esperado); // evita timing attacks
  }
  // Contraseña heredada sin hash — se avisa en el log para que se migre, pero
  // no se bloquea el acceso el día del despliegue.
  console.warn("[cifrado] contraseña en texto plano sin migrar — corre scripts/hash-password.js");
  return password === guardado;
}

module.exports = { cifrar, descifrar, hashPassword, verificarPassword };
