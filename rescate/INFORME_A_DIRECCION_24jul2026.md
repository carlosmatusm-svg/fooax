# INFORME TÉCNICO A DIRECCIÓN

**Para:** Lic. Anel Aydee Díaz Silva — Dirección General, FOOAX
**De:** Ing. Karina Matus
**Fecha:** Oaxaca de Juárez, 24 de julio de 2026
**Asunto:** Resultado del rescate de información del sistema ESHLIDER y hallazgos sobre la entrega recibida del desarrollador anterior

---

## 1. Resumen ejecutivo

En atención a la solicitud urgente de la Gerencia de Administración y Finanzas del 23 de julio, informo que **la información de FOOAX ya fue respaldada en su totalidad**. Se descargaron las 61 tablas de la base de datos del sistema ESHLIDER, incluyendo lo solicitado: el reporte de garantías de abril y mayo, y el respaldo completo de las entrevistas de crédito.

El respaldo se realizó **únicamente en modo lectura**: no se modificó, borró ni alteró nada en el sistema en operación.

Sin embargo, al revisar el código fuente entregado por el desarrollador anterior encontré **cuatro situaciones que requieren la atención de Dirección**, detalladas en el apartado 3. La más importante: **la entrega recibida no incluye los datos de la empresa**.

---

## 2. Lo que ya está resguardado

### 2.1 Garantías — abril y mayo 2026

| Mes | Concepto | Movimientos | Monto |
|---|---|---:|---:|
| Abril | Depósitos | 1,051 | $60,681.00 |
| Abril | Retiros | 52 | $25,902.00 |
| Abril | Aperturas | 362 | — |
| Mayo | Depósitos | 1,150 | $72,357.00 |
| Mayo | Retiros | 97 | $41,308.50 |
| Mayo | Aperturas | 51 | — |
| **Total del periodo** | | **2,763** | **$200,248.50** |

**Saldo de garantías vigente:** $97,449.40 distribuidos en 473 cuentas, con desglose individual por socia.

### 2.2 Entrevistas de crédito

Se resguardaron **3,788 registros** del expediente socioeconómico completo:

| Componente | Registros |
|---|---:|
| Clientas | 659 |
| Vivienda | 593 |
| Ingresos | 592 |
| Familiares | 592 |
| Referencias | 593 |
| Beneficiarios | 597 |
| Avales | 162 |

### 2.3 Respaldo integral

Adicionalmente se resguardó **la base de datos completa** (61 tablas): préstamos, pagos, mora, capital, centros, grupos, pagarés, movimientos y auditoría. Esto cubre a FOOAX ante cualquier requerimiento futuro, no solo el actual.

---

## 3. Hallazgos sobre la entrega recibida

### 3.1 La entrega **no incluye los datos de la empresa** — *crítico*

El repositorio entregado contiene la **estructura** de la base de datos, pero **ningún dato de operación**. La carpeta destinada a los respaldos está vacía, y la documentación del propio repositorio indica que la información de producción "se entrega por separado, por un canal acordado con la empresa".

**Solicito confirmar si FOOAX recibió alguna vez ese archivo.** Si no fue así, la entrega está incompleta en lo más importante: los datos son el activo de la empresa, el programa es solo la herramienta que los administra.

De no haberse recibido, el respaldo que acabo de tomar es hoy **la única copia de la información de FOOAX fuera del servidor del desarrollador**.

### 3.2 No existe historial de desarrollo — *importante*

El repositorio tiene **únicamente 2 registros de cambios, ambos con fecha 8 de julio de 2026**, el primero titulado "entrega inicial".

Esto significa que todo el trabajo realizado a lo largo del proyecto fue comprimido en un solo envío el día de la entrega. **El historial real del desarrollo no fue transferido a FOOAX**: quedó en el repositorio original del desarrollador.

La consecuencia práctica es que la empresa **no tiene forma de verificar qué se construyó, cuándo, ni en qué periodo** — información relevante si en algún momento se requiere auditar el tiempo facturado o entender por qué ciertos módulos quedaron incompletos.

### 3.3 La titularidad de las cuentas no está aclarada — *importante*

- La cuenta de GitHub donde está el código (`sistemaFooax`) fue **creada el 7 de julio de 2026**, un día después de la reunión en la que se solicitó la entrega de accesos.
- No está confirmado si FOOAX posee el **correo y la contraseña** de esa cuenta, o si únicamente fue invitada como colaboradora.
- Tampoco está confirmado si la cuenta de **Railway** (donde vive el sistema en operación y la base de datos) está a nombre de FOOAX o del desarrollador.

**Mientras esas dos cuentas no estén a nombre de la empresa, el acceso de FOOAX a su propio sistema depende de la voluntad de un tercero** — que es justamente lo que originó la solicitud urgente de la Gerencia.

### 3.4 Sin mantenimiento desde el 8 de julio — *a considerar*

No se registran cambios en el código desde esa fecha, pese a que el sistema continúa en operación con información real de las socias. Si surge una falla, hoy no hay nadie dando mantenimiento.

---

## 4. Lo que sí está correctamente hecho

Por objetividad, y porque conviene a FOOAX saberlo:

- **Las contraseñas de los usuarios están debidamente cifradas** (algoritmo bcrypt). No están expuestas ni son legibles, ni siquiera para quien tenga acceso a la base.
- **Las credenciales del servidor no fueron expuestas** en el código entregado; están correctamente excluidas.
- **La documentación técnica es amplia y de buena calidad**: incluye el mapa de los módulos, las reglas financieras y el catálogo de servicios del sistema.
- **El sistema es un desarrollo real y a la medida**, con lógica de negocio propia: préstamos grupales e individuales, mora automática, capital, pagarés y cerca de 30 reportes.

Los hallazgos del apartado 3 se refieren a **cómo se entregó** el trabajo, no a la calidad técnica de lo construido.

---

## 5. Observaciones sobre la información resguardada

Dos precisiones para que la Gerencia interprete correctamente los archivos:

1. **La sección de "muebles" del expediente está vacía** (0 registros). No se trata de información perdida: esa parte del formato de entrevista nunca se capturó en el sistema.

2. **El registro de garantías inicia en abril de 2026.** Verifiqué el resto de la base y sí contiene historia desde febrero de 2024, por lo que **no hay pérdida de datos**: el módulo de garantías simplemente comenzó a operar en abril, lo cual coincide con el cambio de figura de cooperativa a financiera.

---

## 6. Lo que solicito a Dirección

| # | Acción | Urgencia |
|---|---|---|
| 1 | Confirmar si FOOAX recibió el archivo de datos de producción por el "canal separado" que menciona la entrega | Inmediata |
| 2 | Confirmar si FOOAX posee usuario y contraseña de la cuenta de GitHub `sistemaFooax`, o solo acceso como invitada | Inmediata |
| 3 | Confirmar la titularidad de la cuenta de **Railway** y, de no estar a nombre de FOOAX, gestionar su transferencia | Inmediata |
| 4 | Solicitar formalmente al desarrollador el **respaldo completo de la base de datos** y el **historial de desarrollo**, como cierre de la entrega | Alta |
| 5 | Autorizar el resguardo de una **segunda copia** del respaldo fuera de mi equipo (Drive de FOOAX o medio físico bajo custodia de la empresa) | Alta |
| 6 | Que la Ing. Monserrat confirme cuál pantalla corresponde a lo que la Gerencia denomina "entrevista de crédito", para validar que lo entregado es exactamente lo requerido | Media |

---

## 7. Conclusión

**La información de FOOAX está a salvo.** El objetivo de la solicitud urgente se cumplió y la empresa ya no depende de que el enlace siga disponible.

Lo que queda pendiente no es técnico sino de titularidad: mientras las cuentas de GitHub y Railway no estén a nombre de FOOAX, la empresa seguirá operando sobre una infraestructura que no controla. Recomiendo resolver ese punto antes de cualquier otro paso.

Quedo atenta a sus instrucciones.

**Ing. Karina Matus**
