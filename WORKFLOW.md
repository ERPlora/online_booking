# WORKFLOW — Reservas online

Prefijo: ONLINE_BOOKING
Alcance MVP: fuera del MVP

## Para qué sirve y para quién
Lleva un libro de reservas de clientes (cita o mesa) con su referencia `BK-00001`, su estado
(pendiente, confirmada, completada, cancelada, no se presentó) y los ajustes de una «página de
reservas». Lo usan el **administrador** (todo, incluido borrar y los ajustes) y el **responsable**
(ver, crear, confirmar, cancelar, completar y marcar ausencia). El **empleado** solo ve la lista.

**Lo que hay hoy, dicho claro:** el módulo es un libro que se rellena **a mano desde dentro**. No existe
ninguna página pública ni formulario sin sesión propios, y no hay puerta por llave de API (`module.json`
no declara `expose_api` ni ranuras). Existe la puerta pública genérica del hub (`/p/:locator`), que deja
ejecutar sin sesión una orden concreta, una vez, si alguien con sesión y con el permiso de esa orden
acuñó antes un localizador; este módulo ni su pantalla acuñan ninguno, así que hoy no la usa nadie.
No es una «reserva desde la web» (la web de restaurante no existe aquí). Una clienta no puede reservar sola: alguien con
sesión teclea su reserva. Los ajustes de la «página pública» se guardan, pero casi ninguno lo lee nadie
(ver ONLINE_BOOKING-F07). Este documento describe eso y no lo amplía.

## Referencia adoptada
Reserva online de Fresha, Square Appointments y Odoo Appointments (página pública de la clienta, huecos
libres, confirmación, aviso). Ninguno está construido aquí: ver «Cobertura contra la referencia». El
documento técnico (`architecture/modules/online_booking.md`) y `docs/` son la semilla; no se contrasta
mercado nuevo en esta oleada.

## Antes de empezar
- Instalar **Clientes** (es el único `depends_on`; el módulo nunca consulta sus datos, solo escucha su aviso de fusión, ONLINE_BOOKING-F09).
- Abrir **Ajustes** y pulsar **Guardar** al menos una vez. Sin esa fila guardada **no se puede tomar
  ninguna reserva**: la orden se rechaza con «Este negocio aún no ha configurado su página de reservas…».
  La pantalla de Ajustes enseña valores por defecto aunque no haya fila, así que parece configurada y no lo está.
- Citas (`appointments`) y Reservas (`reservations`) no hacen falta: este módulo no habla con ellos.

## Pantallas

### Reservas
Entrada de menú «Reservas». Tabla de 50 filas por página con buscador («Buscar ref, cliente, servicio…»)
y filtros por columna: Ref, Cliente, Servicio, Personal, Fecha (rango), Hora y Estado. Cada fila lleva las
acciones Confirmar, Completar, No-show, Cancelar y Borrar (la pantalla las enseña todas; el servidor
rechaza las que no valen en ese estado o para ese perfil). El «+» abre el panel de alta: Cliente, Servicio,
Personal (opcional), Fecha, Hora y Min.; botón «Añadir». Vacía: «Sin reservas.»; cargando: «Cargando…»;
con error de carga: el aviso de carga de la tabla con reintento; un rechazo al guardar sale dentro del
panel, uno de una acción de fila sale encima de la tabla. Se refresca sola al llegar un aviso de
creada, confirmada, cancelada, completada, no-show o borrada.

### Ajustes
Entrada de menú «Ajustes» (componente propio; el módulo no declara el bloque `settings`). Título
«Configuración de la página de reservas». Campos: «Página pública activada», «Título de la página»,
«Color primario», «URL del logo», «Antelación mínima (horas)», «Antelación máxima (días)», «Duración de
slot (min)», «Buffer entre reservas (min)», «Teléfono obligatorio», «Email obligatorio», «Permitir elegir
personal», «Permitir notas», «Mensaje de bienvenida», «Mensaje de confirmación», «Política de
cancelación»; botón «Guardar» y, al acabar, «Configuración guardada.». Error: «Error cargando la
configuración» / «No se pudo guardar». Ver el formulario no exige permiso de administrador; guardar sí.

## Flujos

### ONLINE_BOOKING-F01 Tomar una reserva a mano
Estado: parcial — no comprueba si el hueco está libre (hay doble reserva posible), ignora «Página pública activada», no valida que cliente, servicio o personal existan y la pantalla solo crea tipo cita
Actor: administrador, responsable
Pantalla: Reservas
Pasos:
1. En Reservas, pulsar el «+».
2. Escribir Cliente, Servicio, Fecha y Hora (obligatorios); opcionalmente Personal y Min. (30 por defecto).
3. Pulsar «Añadir».
4. La reserva aparece en la tabla como Pendiente con su referencia `BK-00001`, correlativa por negocio.
En este mismo documento se apoya en: ONLINE_BOOKING-F07 (Configurar la página de reservas).
Entra: los textos que teclea la persona (nombre, servicio y personal son texto libre, sin enlazar a Clientes, Servicios ni Personal); la fecha y hora; el reloj del servidor y los ajustes de antelación. La orden también acepta por asistente o API correo, teléfono, notas, ids de cliente/servicio/personal y tipo mesa.
Sale: una fila pendiente con el nombre, correo y teléfono copiados, y el aviso `online_booking.booking.created` con los datos personales tecleados (nombre, correo, teléfono, notas, servicio, personal, fecha, hora) y **sin el identificador ni la referencia de la reserva** (el id nuevo del aviso no es el de la fila): una automatización no puede volver a encontrarla. Ningún módulo lo escucha, pero Automatizaciones ofrece como disparador todo aviso que declare un módulo instalado, así que esos datos pueden salir por una automatización. La pantalla nunca guarda el identificador de cliente. No crea cita, mesa, ficha de cliente ni aviso a la clienta.
Si falla: fecha y hora fuera de la ventana (menos de «Antelación mínima» o más de «Antelación máxima», medido con el reloj del servidor): «Esa fecha y hora quedan fuera de la ventana de reserva que permite este negocio.»; sin ajustes guardados: «Este negocio aún no ha configurado su página de reservas, así que no se puede aceptar ninguna reserva…»; ajustes no legibles: «No se han podido leer los ajustes de reservas, así que no se ha reservado nada. Inténtalo de nuevo.». En todos los casos no se escribe nada ni se gasta número de referencia. Un empleado no tiene la orden.
Implicados: pendiente
Pendiente de enlazar: appointments — APPOINTMENTS-F01 (Reservar una cita desde la agenda): la reserva online nunca mira la agenda de Citas ni crea la cita, así que puede solaparse con ella
Pendiente de enlazar: flows — FLOWS-F13 (Elegir cuándo arranca): el aviso de reserva creada es disparador elegible (con frase propia) y lleva datos personales; sale aunque la reserva no se pueda localizar después
Pendiente de enlazar: reservations — RESERVATIONS-F06 (Tomar una reserva a mano): igual con las mesas; tipo mesa se guarda pero no toca Reservas
QA: ninguno

### ONLINE_BOOKING-F02 Confirmar una reserva
Estado: hecho
Actor: administrador, responsable
Pantalla: Reservas
Pasos:
1. En la fila de una reserva Pendiente, pulsar «Confirmar».
2. El estado pasa a Confirmada y se anota la hora de confirmación.
Entra: la reserva elegida.
Sale: estado confirmada y el aviso `online_booking.booking.confirmed`; nada llega a la clienta.
Si falla: si ya no está pendiente, «Esta reserva ya no se puede confirmar: ya no está pendiente.»; no cambia nada y no sale aviso. Hace falta el permiso propio de confirmar (distinto del de modificar). Por el asistente la tarjeta de confirmación dice «Una acción que esta app no sabe nombrar» (sin etiqueta de orden en `locales/es.json`).
Implicados: pendiente
Pendiente de enlazar: flows — FLOWS-F13 (Elegir cuándo arranca): el aviso de confirmada es disparador elegible
QA: ninguno

### ONLINE_BOOKING-F03 Completar una reserva
Estado: hecho
Actor: administrador, responsable
Pantalla: Reservas
Pasos:
1. En una reserva Confirmada, pulsar «Completar».
2. El estado pasa a Completada.
Entra: la reserva elegida.
Sale: estado completada y el aviso `online_booking.booking.completed`. No cobra, no factura, no suma a la ficha del cliente.
Si falla: si no está confirmada, «Esta reserva no se puede completar: no se ha confirmado.»; una pendiente no se completa.
Implicados: pendiente
Pendiente de enlazar: flows — FLOWS-F13 (Elegir cuándo arranca): el aviso de completada es disparador elegible
QA: ninguno

### ONLINE_BOOKING-F04 Marcar que no se presentó
Estado: hecho
Actor: administrador, responsable
Pantalla: Reservas
Pasos:
1. En una reserva Pendiente o Confirmada, pulsar «No-show».
2. El estado pasa a No-show.
Entra: la reserva elegida.
Sale: estado no-show y el aviso `online_booking.booking.no_show`. No cobra ningún cargo ni lo apunta en la ficha del cliente.
Si falla: sobre una completada, cancelada o ya marcada, «Esta reserva no se puede marcar como no presentada en su estado actual.».
Implicados: pendiente
Pendiente de enlazar: flows — FLOWS-F13 (Elegir cuándo arranca): el aviso de no-show tiene frase propia en el catálogo de disparadores
QA: ninguno

### ONLINE_BOOKING-F05 Cancelar una reserva
Estado: parcial — la pantalla no pide motivo (siempre guarda vacío); solo por asistente o API se puede dar
Actor: administrador, responsable
Pantalla: Reservas
Pasos:
1. En una reserva que no esté Completada ni Cancelada, pulsar «Cancelar».
2. El estado pasa a Cancelada y se anota la hora.
Entra: la reserva elegida y, solo por asistente o API, un motivo.
Sale: estado cancelada y el aviso `online_booking.booking.cancelled`. No avisa a la clienta ni libera nada en Citas o Reservas.
Si falla: si ya estaba completada o cancelada, «Esta reserva ya no se puede cancelar: ya está completada o cancelada.». También cancela una en estado no-show. Por el asistente, la tarjeta dice «Una acción que esta app no sabe nombrar» y no hay confirmación reforzada (sin `ai.risk`).
Implicados: pendiente
Pendiente de enlazar: flows — FLOWS-F13 (Elegir cuándo arranca): el aviso de cancelada tiene frase propia en el catálogo de disparadores
QA: ninguno

### ONLINE_BOOKING-F06 Borrar una reserva
Estado: parcial — no avisa si no había nada que borrar y no tiene tarjeta de confirmación con riesgo para el asistente
Actor: administrador
Pantalla: Reservas
Pasos:
1. En la fila, pulsar «Borrar».
2. La reserva desaparece de la tabla.
Entra: la reserva elegida.
Sale: la fila queda marcada como borrada (no se pierde el dato) y sale `online_booking.booking.deleted`; vale en cualquier estado. La orden no comprueba que haya cambiado una fila: un identificador inexistente o ya borrado contesta bien y emite el aviso igualmente.
Si falla: sin el permiso de borrar (solo administrador), el hub rechaza la orden. `module.json` no declara `ai.risk` ni etiqueta de orden en `locales`, así que por el asistente se confirmaría con una tarjeta sin riesgo y con el texto genérico «Una acción que esta app no sabe nombrar».
Implicados: pendiente
Pendiente de enlazar: flows — FLOWS-F13 (Elegir cuándo arranca): el aviso de borrada sale aunque no haya cambiado ninguna fila (orden sin `expect_rows`)
QA: ninguno

### ONLINE_BOOKING-F07 Configurar la página de reservas
Estado: parcial — solo «Antelación mínima» y «Antelación máxima» cambian algo; el resto se guarda y nadie lo lee porque no existe la página pública
Actor: administrador
Pantalla: Ajustes
Pasos:
1. Abrir Ajustes y cambiar los campos.
2. Pulsar «Guardar»; sale «Configuración guardada.».
Entra: los campos del formulario, que viajan todos juntos.
Sale: una fila única por negocio (se crea la primera vez, después se actualiza) y el aviso `online_booking.settings.updated`. Solo lo leen F01 (antelación mínima y máxima) y la comprobación de que existe la fila. «Página pública activada», título, color, logo, teléfono/correo obligatorios, elegir personal, notas, duración de slot, buffer, mensajes y política de cancelación no los lee ningún código.
Si falla: sin permiso de administrador, el hub rechaza el guardado; la orden tampoco comprueba que cambie una fila y su aviso de ajustes actualizados sale siempre; un valor fuera de rango (antelación mínima 0–168 h, máxima 1–365 días, slot 5–480, buffer 0–120) lo rechaza el esquema.
Implicados: pendiente
Pendiente de enlazar: flows — FLOWS-F13 (Elegir cuándo arranca): el aviso de ajustes actualizados es disparador elegible
QA: ninguno

### ONLINE_BOOKING-F08 Ver y buscar las reservas
Estado: hecho
Actor: administrador, responsable, empleado, asistente
Pantalla: Reservas
Pasos:
1. Abrir Reservas.
2. Buscar por referencia, nombre, correo, teléfono, servicio o personal; filtrar en pantalla por Ref (exacta, no por fragmento), Cliente, Servicio, Personal, Fecha (rango), Hora y Estado; ordenar por columna. Filtrar por tipo solo con el asistente o la API. Sin ordenar, la lista sale por identificador ascendente, no por fecha de la reserva.
3. Un detalle por identificador lo da el asistente o la API.
Entra: el permiso de ver y el negocio de la sesión.
Sale: nada se escribe. La lista da nombre, correo, teléfono y notas de todas las reservas del negocio; el empleado también.
Si falla: sin permiso de ver, el hub rechaza la consulta; fallo de carga con reintento.
Implicados: ninguno
QA: ninguno

### ONLINE_BOOKING-F09 Seguir a la clienta cuando se fusionan dos fichas
Estado: hecho
Actor: sistema
Pantalla: ninguna
Pasos:
1. Alguien fusiona dos fichas en Clientes.
2. Este módulo re-apunta, sin que nadie haga nada, las reservas de la ficha absorbida a la superviviente.
Entra: el aviso `customer.merged` de Clientes con las dos fichas.
Sale: el identificador de cliente de todas las reservas del negocio de la absorbida (vivas o borradas, de cualquier estado) pasa a la superviviente; nombre, correo y teléfono copiados no se tocan. Repetir el aviso no hace nada.
Si falla: nada visible; el aviso se reentrega hasta que se aplique. Fusionar a quien nunca reservó no cambia ninguna fila.
Implicados: pendiente
Pendiente de enlazar: customers — CUSTOMERS-F13 (Unir dos fichas de la misma persona): emite el aviso que este módulo escucha
Pendiente de enlazar: appointments — APPOINTMENTS-F23 (Unir las citas al fusionar dos fichas de clienta): mismo aviso, otro módulo
QA: ninguno

## Cobertura contra la referencia

| Elemento | Estado | Flujo |
|---|---|---|
| Libro de reservas con estados y referencia | hecho | ONLINE_BOOKING-F01–F06, F08 |
| Ventana de antelación mínima y máxima | hecho (por el reloj del servidor) | ONLINE_BOOKING-F01 |
| Ajustes de la página | parcial | ONLINE_BOOKING-F07 |
| Seguir la fusión de clientes | hecho | ONLINE_BOOKING-F09 |
| Página pública sin sesión | no existe | — |
| Huecos libres y doble reserva | no existe | — |
| Convertir en cita o mesa | no existe | — |
| Avisos a la clienta, recordatorios, depósito | no existe | — |

## Datos: de quién es cada dato
- **Del módulo:** ajustes (una fila por negocio), reservas y el contador de referencias.
- **Nombres copiados, sin enlace:** cliente, servicio y personal se guardan como texto y como identificador opaco sin comprobar contra Clientes, Servicios ni Personal. Si la ficha cambia o se borra, la reserva conserva lo copiado.
- **Datos personales (para el borrado RGPD):** en cada reserva, nombre, correo, teléfono y notas libres, más `created_by`/`updated_by` (quién la tomó) y el motivo de cancelación. El módulo **no escucha** `customer.anonymized`: tras borrar los datos de una persona, sus reservas conservan nombre, correo, teléfono y notas para siempre. Solo Servicios y WhatsApp escuchan ese aviso. Como la pantalla no guarda el identificador de cliente, tampoco se limpia por ella la copia del aviso de creada que guarda el hub (se queda hasta la purga de 90 días).
- El aviso de creada lleva nombre, correo, teléfono, notas, servicio, personal, fecha, hora, duración, tipo y los identificadores de sistema, pero ni el id ni la referencia de la reserva.

## Reglas que no se rompen
- Toda lectura y escritura va con el negocio de la sesión; la fusión de clientes también filtra por negocio.
- La ventana de antelación se mide con el reloj del servidor, nunca con una fecha del cliente; una reserva rechazada no gasta número ni emite aviso.
- Cada transición exige su estado de origen y se rechaza con su código; no se sale de completada o cancelada.
- Nunca se borra físicamente una reserva.

## Lo que NO hace, a propósito
- No tiene página pública ni nada que una clienta pueda hacer sin sesión; tampoco ruta con llave de API.
- No mira disponibilidad ni evita la doble reserva contra Citas o Reservas; no lee Horarios ni Personal.
- No convierte la reserva en cita o mesa (`WASM-TODO.md` §6), ni propone huecos, ni aplica duración de slot o buffer (§4).
- No envía confirmación, recordatorio ni aviso de cancelación, no cobra depósito ni sincroniza calendarios.
- No tiene tareas programadas: una reserva pendiente no caduca nunca.
- No estadísticas del día (`WASM-TODO.md` §7); no crea la ficha de la clienta.

## Dudas abiertas
- Si este módulo debe seguir instalable mientras no exista la página pública, o retirarse o fusionarse con Citas y Reservas (decisión de producto con `market-decision`).
- Zona horaria de la ventana: la hora tecleada (local, sin zona) se interpreta en la zona de la sesión de Postgres, que el hub no fija, y se compara con el reloj en UTC. Con la base en UTC (sin confirmar en producción) la ventana se desplaza 1–2 h en España.
- Riesgo sin confirmar (haría falta ejecutar el asistente): con el módulo instalado, el asistente gana sus órdenes como herramientas, elegidas por sus descripciones en inglés; no se ha comprobado que ninguna se confunda con una de cobro.
- Si «Borrar» pide confirmación en la tabla: la pantalla lanza la orden directamente; sin confirmar si la tabla pinta un diálogo.

## Fuentes contrastadas
- `architecture/modules/online_booking.md` dice que no hay `handler/` ni `dist/` y que el Rust está planificado: hoy `handler/src/lib.rs` y `dist/handler.wasm` existen y llevan `create_booking`.
- El mismo documento y `WASM-TODO.md` §2 y §3 describen disparadores (triggers) y que la ventana está resuelta por disparadores; hoy lo hacen el `WHERE` de cada orden y la gate `expect_rows` (las migraciones 003 y 004 están vacías a propósito).
- `WASM-TODO.md` §2 dice «no_show: solo desde confirmed»; el código lo admite también desde pendiente.
- `reservations/WORKFLOW.md` atribuye a este módulo la «reserva desde la web del restaurante»: este módulo no tiene web ni página pública, es un libro interno que se rellena con sesión.
- El documento técnico dice que borrar es «permanentemente»; el código solo marca la fila como borrada.
- El documento técnico dice que la pestaña Ajustes nace del bloque `settings`; `module.json` no lo declara, es el componente propio.
- `docs/screens.md` dice «si no hay fila de ajustes, se aplican los valores por defecto»: para tomar una reserva es falso, se rechaza.
- `docs/screens.md` presenta «Página pública activada», el color o el slot como ajustes que controlan la página; ningún código los lee.
- `docs/screens.md` dice que el empleado no ve nada de Ajustes; la consulta de ajustes pide solo permiso de ver, así que el empleado la ve.
