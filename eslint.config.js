// eslint.config.js — configuración mínima, pensada para atrapar errores
// reales (variables no declaradas, comparaciones sueltas, código
// inalcanzable) sin generar cientos de advertencias de ESTILO sobre código
// que ya funciona en producción. No es para imponer un estilo nuevo sobre
// miles de líneas que nadie va a reescribir solo por esto — para eso está
// Prettier (.prettierrc), que solo formatea, nunca cambia lógica.
//
// A propósito NO cubre las apps de cobranza (apps/*.html) ni las pantallas
// (vistas/*.html, public/login.html): son HTML con <script> embebido, no
// archivos .js — ESLint no las toca por diseño de este config. El código
// embebido de esas pantallas ya tiene su propia verificación de sintaxis en
// tests/tablero_render.js y tests/expediente_render.js (compilan el <script>
// con vm.Script antes de cada corrida).
const globals = require("globals");

module.exports = [
  {
    // Todo lo que corre en Node: el servidor, las capas de datos, los
    // scripts de mantenimiento y las pruebas.
    files: ["*.js", "scripts/**/*.js", "tests/**/*.js", "migraciones/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      eqeqeq: ["warn", "smart"],
      "no-var": "warn",
      "no-fallthrough": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-const-assign": "error",
    },
  },
  {
    // El service worker y los scripts de sincronización offline
    // (public/*.js) corren en el NAVEGADOR del teléfono, no en Node — llevan
    // sus propios globals (self, caches, indexedDB, fetch...).
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      "no-fallthrough": "error",
      "no-unreachable": "error",
    },
  },
  {
    ignores: ["node_modules/**", "*.bak*", "**/*.bak*", "rescate/**", "public/*.bak*"],
  },
];
