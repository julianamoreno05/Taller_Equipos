# TurnoMonitores — Especificación inicial
**Universidad de Caldas · Sedes Lans y Central**

---

## 1. Vision statement

TurnoMonitores es un sistema web y móvil que automatiza la solicitud, asignación y seguimiento de turnos de monitoría en las salas de la Universidad de Caldas, permitiendo a coordinadores, monitores y estudiantes gestionar la disponibilidad de espacios académicos en tiempo real. Su implementación elimina el registro manual en papel y hojas de cálculo, reduciendo errores operativos, garantizando el cumplimiento de las reglas de negocio del programa de monitorías y liberando tiempo del coordinador para tareas de mayor valor.

---

## 2. User stories

### US-01 — Asignación de turno de monitoría
**Como coordinador**, quiero asignar un turno de monitoría a un monitor en una sala disponible, para garantizar la cobertura de espacios académicos extraclase respetando todas las restricciones del programa.

**Prioridad:** Alta  
**Dependencias:** US-03 (registro de monitores por Admin), módulo de horarios de clase por sala

**Criterios de aceptación:**

| # | Dado | Cuando | Entonces |
|---|------|--------|----------|
| 1 | El coordinador selecciona un monitor, una sala y un rango horario dentro del turno permitido por sede | Confirma la asignación | El sistema registra el turno, notifica al monitor por correo institucional y actualiza la disponibilidad de la sala en tiempo real |
| 2 | El monitor ya tiene un turno activo en el mismo rango horario, o ha alcanzado el límite de 7 h/día o 160 h/semestre | El coordinador intenta asignarlo | El sistema bloquea la acción y muestra el motivo específico del conflicto antes de permitir guardar |
| 3 | La sala ya tiene dos monitores asignados en el horario solicitado | El coordinador intenta asignar un tercer monitor | El sistema rechaza la operación, marca la sala como bloqueada automáticamente y lo comunica en pantalla |

---

### US-02 — Consulta de disponibilidad y panel de turnos del monitor
**Como monitor académico**, quiero consultar las salas disponibles por franja horaria y visualizar mi turno asignado con sala y horas acumuladas, para planear mi jornada y verificar mi progreso en el semestre.

**Prioridad:** Alta  
**Dependencias:** US-01 (asignación de turnos)

**Criterios de aceptación:**

| # | Dado | Cuando | Entonces |
|---|------|--------|----------|
| 1 | El monitor accede al sistema | Consulta la vista de disponibilidad de salas | Visualiza una lista filtrable por sede, fecha y franja horaria que muestra únicamente las salas sin turno completo (menos de 2 monitores) y no bloqueadas |
| 2 | El coordinador ya le asignó un turno | El monitor ingresa a su panel de turnos | Ve el nombre de la sala, fecha, hora de inicio y fin, duración exacta del turno en horas y el acumulado de horas del semestre |
| 3 | El monitor alcanza las 60 h mínimas del semestre | Consulta su resumen | El sistema muestra una indicación visual diferenciada (mínimo cumplido / en progreso / máximo alcanzado) con el porcentaje completado |

---

### US-03 — Cierre de turno y registro de inventario
**Como coordinador**, quiero confirmar o finalizar anticipadamente el turno de un monitor y registrar el inventario de la sala al cierre, para garantizar que las horas se contabilicen correctamente y el estado de los equipos quede documentado.

**Prioridad:** Alta  
**Dependencias:** US-01 (asignación de turnos), módulo de inventario de salas

**Criterios de aceptación:**

| # | Dado | Cuando | Entonces |
|---|------|--------|----------|
| 1 | Un turno está activo | El coordinador lo finaliza anticipadamente indicando la hora real de cierre | El sistema recalcula las horas efectivas del turno, actualiza el acumulado del monitor y libera la sala para nueva asignación |
| 2 | El turno llega a su hora de fin programada | El coordinador confirma su realización completa | El sistema registra el turno como cumplido, suma las horas al historial del monitor y envía confirmación por correo institucional |
| 3 | El coordinador cierra un turno | Completa el formulario de cierre | El sistema exige registrar el estado del inventario de la sala (equipos con sticker, componentes presentes/ausentes) antes de permitir guardar el cierre |

---

## 3. Out of scope — v1

- **App nativa móvil.** La versión móvil es diseño web responsivo; no se publica en App Store ni Google Play.
- **Liquidación o pago de honorarios.** El sistema registra horas pero no genera órdenes de pago ni se integra con nómina o sistema financiero.
- **Proceso de selección de monitores.** El administrador solo carga los ya admitidos; la convocatoria y selección ocurre fuera del sistema.
- **Inventario fotográfico o con QR/NFC.** El registro de inventario en v1 es textual con base en los stickers existentes; no hay escaneo de activos.
- **Reportes avanzados de analítica.** No hay predicción de demanda ni históricos de ocupación; solo vistas básicas de horas acumuladas por monitor.
- **Sedes adicionales.** Solo Sede Lans y Sede Central en esta versión; no se habilitan otras sedes de la universidad.

---

## 4. Riesgos del proyecto

### R-01 — Integración con sistemas universitarios existentes
**Descripción:** La universidad puede no tener APIs documentadas o estables para horarios de clase, correo institucional e inventario. Una integración bloqueada obliga a desarrollar adaptadores propios o posponer funcionalidades críticas, comprometiendo el cronograma de un semestre.  
**Probabilidad:** Alta  
**Mitigación:** Realizar un spike técnico en la primera semana — una reunión con el área de sistemas para confirmar qué existe, qué está disponible y en qué formato — antes de diseñar los módulos dependientes. Si las APIs no existen, definir un plan B (importación manual via CSV) y ajustar el alcance del sprint 1 en consecuencia.

---

### R-02 — Adopción y cambio de hábito de los coordinadores
**Descripción:** El coordinador es el actor más crítico del flujo. Si prefiere continuar usando Excel por familiaridad o desconfianza, la trazabilidad se rompe. Con un único coordinador por sede, cualquier resistencia detiene la operación completa del sistema.  
**Probabilidad:** Alta  
**Mitigación:** Involucrar al coordinador desde el diseño UX (co-diseño de la pantalla de asignación). Planificar una sesión de demo y capacitación antes del go-live. Mantener una vista de exportación a Excel durante el primer mes de operación como red de seguridad.

---

### R-03 — Alcance subestimado para el tiempo disponible
**Descripción:** El sistema cubre cuatro roles, dos sedes con reglas distintas, tres integraciones externas y soporte web y móvil en un semestre. Sin disciplina de priorización, el equipo puede llegar a la entrega con integraciones incompletas o reglas de negocio mal implementadas.  
**Probabilidad:** Media  
**Mitigación:** Definir un MVP estricto en la primera semana (flujo de asignación + consulta de disponibilidad sin integraciones externas). Las integraciones entran como historias de segunda iteración. Realizar demos cada dos semanas para detectar desviaciones de alcance antes de que sean críticas.

---

## 5. Pregunta de validación

> ¿El sistema debe permitirle al monitor **solicitar** un turno directamente (y que el coordinador apruebe o rechace), o el flujo siempre inicia con el coordinador asignando el turno de forma unilateral?

Esta decisión cambia significativamente la arquitectura del módulo de asignación (un flujo de aprobación vs. asignación directa) y debe resolverse antes de iniciar el desarrollo de US-01.

---

## 6. Entregable mínimo del taller (2 horas)

**Story priorizada: US-02 — Consulta de disponibilidad de salas**

Justificación: es el único flujo end-to-end demostrable en 2 horas sin lógica compleja de conflictos, sin autenticación de roles y sin integraciones externas. Produce algo visible en el navegador, un endpoint real y un flujo n8n ejecutable con datos reales.

---

### Backend

**Endpoint:**
```
GET /salas/disponibles?fecha=YYYY-MM-DD&hora_inicio=HH:MM&hora_fin=HH:MM&sede=lans|central
```

**Respuesta esperada (200 OK):**
```json
[
  {
    "id": "sala-01",
    "nombre": "Sala MAC 1",
    "sede": "lans",
    "tipo": "mac",
    "monitores_asignados": 1,
    "capacidad_monitores": 2,
    "disponible": true
  }
]
```

**Respuesta vacía (sin salas disponibles):**
```json
[]
```

**Validaciones mínimas:**
- Si `sede` no es `lans` o `central`, responder `400` con mensaje de error.
- Si el rango horario está fuera del horario permitido por sede (`lans`: 07:00–15:00, `central`: 07:00–18:00), responder `400` indicando la restricción.
- Los datos pueden ser seed estático; no se requiere base de datos persistente.

---

### Frontend

**Pantalla:** Vista de disponibilidad de salas

**Campos visibles:**
- Selector de sede (Lans / Central)
- Selector de fecha (date picker)
- Campos de hora de inicio y hora de fin
- Botón "Consultar"
- Lista de resultados con nombre de sala, tipo (MAC / normal), monitores asignados y estado (disponible / llena)

**Comportamiento:**
- Al hacer clic en "Consultar", llama al endpoint real con los parámetros del formulario.
- Los resultados se actualizan sin recargar la página.
- Al cambiar el selector de sede, los resultados se limpian y se espera nueva consulta.

**Manejo de errores:**
- Si el endpoint responde `400`, mostrar el mensaje de error del backend debajo del formulario.
- Si la lista de resultados está vacía (`[]`), mostrar mensaje: *"No hay salas disponibles para ese horario."* — no pantalla en blanco.
- Si el servidor no responde, mostrar: *"Error al consultar. Intenta de nuevo."*

---

### Flujo n8n

**Trigger:** Manual (botón "Execute workflow" en n8n)

**Nodo 1 — HTTP Request:**
- Método: `GET`
- URL: `http://localhost:{puerto}/salas/disponibles`
- Parámetros: `fecha`, `hora_inicio`, `hora_fin`, `sede` con valores reales (no hardcodeados como texto fijo)

**Nodo 2 — IF (condicional):**
- Condición: `{{ $json.length }} > 0`
- Rama verdadera: continúa al nodo de notificación
- Rama falsa: termina el flujo sin enviar correo

**Nodo 3 — Send Email (o webhook):**
- Destino: correo institucional de prueba del monitor
- Asunto: `Salas disponibles — {{ $now.toFormat('dd/MM/yyyy') }}`
- Cuerpo: lista con el nombre de cada sala disponible tomada del response real del endpoint
- El log de n8n debe mostrar los datos reales del array recibido, no datos de prueba hardcodeados

---

## 7. Criterios de aceptación del taller

- [ ] El endpoint `GET /salas/disponibles` responde con `200` y un array JSON con al menos un objeto de sala, o `[]` si no hay disponibilidad, consumido desde el frontend y desde n8n con la misma URL real.
- [ ] La pantalla en el navegador muestra los resultados de una consulta real al endpoint (no datos mockeados en el frontend), filtra por sede y muestra un mensaje de estado vacío cuando el array es `[]`.
- [ ] El flujo n8n se ejecuta manualmente, el log muestra el array de datos reales devuelto por el endpoint, y envía una notificación (correo o webhook) con el nombre de al menos una sala cuando hay disponibilidad.
