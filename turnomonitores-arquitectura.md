# TurnoMonitores — Arquitectura técnica
**Stack: NestJS · PostgreSQL (Neon) · Next.js + Vite · fly.io · JWT · n8n**

---

## Respuestas a dudas técnicas

**¿Cómo se maneja la disponibilidad de salas?**
No se calcula en tiempo real con queries complejos. La tabla `salas` tiene una columna `estado ENUM('disponible', 'bloqueada', 'llena')`. El estado se actualiza en el mismo transaction que persiste un turno: si al insertar el turno la sala llega a 2 monitores activos en ese horario, el backend ejecuta `UPDATE salas SET estado = 'llena'` en la misma transacción. La consulta de disponibilidad es un simple `WHERE estado = 'disponible'` más validación de solapamiento horario.

**¿Cómo se maneja la liberación o bloqueo de salas?**
El coordinador llama a `PATCH /salas/:id/estado` con `{ "estado": "bloqueada" | "disponible" }`. El backend no permite cambiar a `disponible` una sala que tiene turnos activos solapados — eso requeriría un chequeo previo. El estado `llena` solo lo escribe el sistema automáticamente; el coordinador no puede setearlo manualmente.

**¿Los turnos tendrán estados?**
Sí. `ENUM('pendiente', 'activo', 'completado', 'cancelado', 'finalizado_anticipado')`. Esto es necesario para que el cálculo de horas acumuladas solo cuente turnos `completado` o `finalizado_anticipado`, y para que la lógica de conflicto de horarios solo revise turnos en estado `pendiente` o `activo`.

**¿La validación de conflicto de horarios será en el backend o en la BD?**
En el backend, no en la BD. Una constraint de BD no puede expresar "mismo monitor en rango horario solapado" de forma mantenible. El servicio `TurnosService` ejecuta una query explícita antes de insertar:
```sql
SELECT id FROM turnos
WHERE monitor_id = $1
  AND estado IN ('pendiente', 'activo')
  AND hora_inicio < $3
  AND hora_fin > $2;
```
Si retorna filas, lanza `ConflictException` con mensaje descriptivo. La BD tiene un índice sobre `(monitor_id, hora_inicio, hora_fin)` para que ese query sea rápido.

**Regla de máximo 7 horas diarias y 160 horas semestrales**
Se resuelve con dos queries de agregación en `TurnosService.validarLimites()` antes de insertar:
```sql
-- Horas del día
SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (hora_fin - hora_inicio))/3600), 0)
FROM turnos
WHERE monitor_id = $1
  AND DATE(hora_inicio) = DATE($2)
  AND estado IN ('pendiente', 'activo', 'completado');

-- Horas del semestre (filtrando por semestre activo)
SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (hora_fin - hora_inicio))/3600), 0)
FROM turnos
WHERE monitor_id = $1
  AND semestre_id = $3
  AND estado IN ('pendiente', 'activo', 'completado', 'finalizado_anticipado');
```
Si `horas_dia + duracion_nuevo_turno > 7` o `horas_semestre + duracion > 160`, el backend lanza `UnprocessableEntityException` indicando cuál límite se viola.

**¿Qué pasa si n8n falla al notificar?**
El turno ya fue persistido antes de llamar a n8n. La notificación es fire-and-forget con reintentos. El backend llama al webhook de n8n de forma asíncrona (sin `await` que bloquee la respuesta al cliente) y registra en una tabla `notificaciones_pendientes(turno_id, intentos, ultimo_error, enviado)`. Un cron job de NestJS (`@Cron`) reintenta cada 5 minutos los registros con `enviado = false AND intentos < 3`. Después de 3 intentos fallidos, marca `enviado = false` y lo deja para revisión manual — el turno sigue siendo válido.

**¿Despliegues automáticos?**
Sí, con GitHub Actions. Pipeline por rama:
- `push` a `main` → deploy a producción en fly.io (`flyctl deploy`)
- `push` a `develop` → deploy a staging
- El workflow corre `npm run test` y `npm run build` antes del deploy; si falla, no despliega.
- Las variables de entorno (DB URL, JWT secret, n8n webhook URL) viven en fly.io secrets, nunca en el repo.

**¿Qué arquitectura y es Clean Architecture?**
Arquitectura en capas dentro de NestJS — no Clean Architecture completa (demasiado overhead para un semestre). Estructura recomendada:
```
src/
  modules/
    salas/       → controller · service · repository · dto · entity
    turnos/      → controller · service · repository · dto · entity
    monitores/   → controller · service · repository · dto · entity
  common/
    guards/      → JwtAuthGuard · RolesGuard
    decorators/  → @Roles()
    filters/     → HttpExceptionFilter global
  config/        → database · jwt · env validation (Joi)
```
La regla es: los controllers no tienen lógica de negocio, los services no importan de otros módulos directamente (usan interfaces), los repositories son la única capa que toca TypeORM/Postgres.

**¿Backup de base de datos?**
Neon PostgreSQL incluye Point-in-Time Recovery (PITR) con retención de 7 días en el plan gratuito y 30 días en planes pagos — no hay que configurar nada adicional. Para el taller es suficiente. En producción real se agregaría un `pg_dump` diario a S3 vía GitHub Actions como segunda capa.

---

## 1. Diagrama de arquitectura

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENTE                                                            │
│                                                                     │
│  ┌─────────────────────────┐    ┌──────────────────────────────┐   │
│  │  Next.js + Vite         │    │  Mobile (PWA / responsive)   │   │
│  │  - /salas/disponibles   │    │  - misma app, viewport móvil │   │
│  │  - /mis-turnos          │    │                              │   │
│  │  - /coordinador/turnos  │    │                              │   │
│  └────────────┬────────────┘    └──────────────┬───────────────┘   │
│               │  HTTPS + JWT Bearer token       │                   │
└───────────────┼─────────────────────────────────┼───────────────────┘
                │                                 │
                ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  API  —  fly.io (NestJS)                                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Guards: JwtAuthGuard · RolesGuard(@Roles('coordinador'))    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐   │
│  │  SalasModule    │  │  TurnosModule   │  │  AuthModule      │   │
│  │  GET disponibles│  │  POST /         │  │  POST /login     │   │
│  │  PATCH :id/est. │  │  PATCH :id/est. │  │  → JWT           │   │
│  └────────┬────────┘  └────────┬────────┘  └──────────────────┘   │
│           │                    │                                    │
│           │            ┌───────┴──────────────────────┐            │
│           │            │  TurnosService               │            │
│           │            │  validarConflictoHorario()   │            │
│           │            │  validarLimitesDiarios()     │            │
│           │            │  validarLimiteSemestral()    │            │
│           │            │  notificarAsync() → n8n      │            │
│           │            └───────────────────────────── ┘            │
│           │                    │                                    │
│  ┌────────┴────────────────────┴──────────────────────────────┐    │
│  │  CronService (@Cron cada 5 min)                            │    │
│  │  Reintenta notificaciones_pendientes donde enviado = false │    │
│  └─────────────────────────────────────────────────────────── ┘    │
│                                                                     │
└───────────────────────┬──────────────────────┬──────────────────────┘
                        │                      │
          TypeORM       │                      │  HTTP POST (webhook)
                        ▼                      ▼
┌───────────────────────────────┐   ┌──────────────────────────────┐
│  BASE DE DATOS                │   │  n8n (externo / self-hosted) │
│  PostgreSQL en Neon           │   │                              │
│                               │   │  Trigger: Webhook POST       │
│  salas                        │   │  Nodo: Send Email (SMTP      │
│  monitores                    │   │         institucional)       │
│  coordinadores                │   │  Nodo: IF fallo → log error  │
│  turnos                       │   │                              │
│  semestres                    │   └──────────────────────────────┘
│  notificaciones_pendientes    │
│                               │
│  PITR backup: Neon built-in   │
└───────────────────────────────┘

CI/CD
──────
GitHub repo
  └── push main    → GitHub Actions (test → build → flyctl deploy prod)
  └── push develop → GitHub Actions (test → build → flyctl deploy staging)
      secrets: FLY_API_TOKEN · DATABASE_URL · JWT_SECRET · N8N_WEBHOOK_URL
```

---

## 2. Schema SQL para PostgreSQL

```sql
-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- SEMESTRES
-- ─────────────────────────────────────────
CREATE TABLE semestres (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(20)  NOT NULL UNIQUE,        -- ej: "2024-2"
  fecha_inicio  DATE         NOT NULL,
  fecha_fin     DATE         NOT NULL,
  activo        BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_fechas CHECK (fecha_fin > fecha_inicio)
);

-- Solo un semestre activo a la vez
CREATE UNIQUE INDEX idx_semestre_activo_unico
  ON semestres (activo)
  WHERE activo = true;

-- ─────────────────────────────────────────
-- USUARIOS (base compartida de roles)
-- ─────────────────────────────────────────
CREATE TYPE rol_usuario AS ENUM ('administrador', 'coordinador', 'monitor', 'estudiante');

CREATE TABLE usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(254) NOT NULL UNIQUE,        -- correo institucional
  password_hash TEXT         NOT NULL,
  rol           rol_usuario  NOT NULL,
  activo        BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- MONITORES
-- ─────────────────────────────────────────
CREATE TABLE monitores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      UUID         NOT NULL UNIQUE
                    REFERENCES usuarios(id) ON DELETE CASCADE,
  semestre_id     UUID         NOT NULL
                    REFERENCES semestres(id) ON DELETE RESTRICT,
  horas_minimas   SMALLINT     NOT NULL DEFAULT 60,
  horas_maximas   SMALLINT     NOT NULL DEFAULT 160,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_horas CHECK (horas_maximas >= horas_minimas AND horas_minimas >= 0)
);

-- ─────────────────────────────────────────
-- SEDES
-- ─────────────────────────────────────────
CREATE TYPE tipo_sede AS ENUM ('lans', 'central');

CREATE TABLE sedes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          VARCHAR(80)  NOT NULL UNIQUE,
  tipo            tipo_sede    NOT NULL,
  horario_inicio  TIME         NOT NULL,   -- 07:00 ambas sedes
  horario_fin     TIME         NOT NULL,   -- 15:00 lans / 18:00 central
  CONSTRAINT chk_horario CHECK (horario_fin > horario_inicio)
);

-- ─────────────────────────────────────────
-- SALAS
-- ─────────────────────────────────────────
CREATE TYPE tipo_sala    AS ENUM ('mac', 'normal');
CREATE TYPE estado_sala  AS ENUM ('disponible', 'bloqueada', 'llena');

CREATE TABLE salas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id          UUID          NOT NULL
                     REFERENCES sedes(id) ON DELETE RESTRICT,
  nombre           VARCHAR(80)   NOT NULL,
  tipo             tipo_sala     NOT NULL,
  capacidad_monitores SMALLINT   NOT NULL DEFAULT 2
                     CHECK (capacidad_monitores BETWEEN 1 AND 2),
  estado           estado_sala   NOT NULL DEFAULT 'disponible',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (sede_id, nombre)
);

-- ─────────────────────────────────────────
-- TURNOS
-- ─────────────────────────────────────────
CREATE TYPE estado_turno AS ENUM (
  'pendiente', 'activo', 'completado', 'cancelado', 'finalizado_anticipado'
);

CREATE TABLE turnos (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id      UUID          NOT NULL
                    REFERENCES monitores(id) ON DELETE RESTRICT,
  sala_id         UUID          NOT NULL
                    REFERENCES salas(id) ON DELETE RESTRICT,
  semestre_id     UUID          NOT NULL
                    REFERENCES semestres(id) ON DELETE RESTRICT,
  hora_inicio     TIMESTAMPTZ   NOT NULL,
  hora_fin        TIMESTAMPTZ   NOT NULL,
  estado          estado_turno  NOT NULL DEFAULT 'pendiente',
  hora_fin_real   TIMESTAMPTZ,              -- se llena al finalizar anticipado
  cancelado_por   UUID          REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_horas_turno    CHECK (hora_fin > hora_inicio),
  CONSTRAINT chk_duracion_max   CHECK (
    EXTRACT(EPOCH FROM (hora_fin - hora_inicio)) / 3600 <= 7
  )
);

-- Índices para las validaciones de conflicto y límites
CREATE INDEX idx_turnos_monitor_tiempo
  ON turnos (monitor_id, hora_inicio, hora_fin);

CREATE INDEX idx_turnos_sala_tiempo
  ON turnos (sala_id, hora_inicio, hora_fin);

CREATE INDEX idx_turnos_semestre_monitor
  ON turnos (semestre_id, monitor_id);

-- ─────────────────────────────────────────
-- NOTIFICACIONES PENDIENTES (retry n8n)
-- ─────────────────────────────────────────
CREATE TABLE notificaciones_pendientes (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id     UUID         NOT NULL
                 REFERENCES turnos(id) ON DELETE CASCADE,
  intentos     SMALLINT     NOT NULL DEFAULT 0,
  ultimo_error TEXT,
  enviado      BOOLEAN      NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

---

## 3. Endpoints necesarios para US-02

| Método | Ruta | Body entrada | Respuesta exitosa | Error principal |
|--------|------|--------------|-------------------|-----------------|
| `POST` | `/auth/login` | `{ email, password }` | `200 { access_token, rol, nombre }` | `401 Credenciales inválidas` |
| `GET` | `/salas/disponibles` | Query params: `sede_id`, `fecha`, `hora_inicio`, `hora_fin` | `200 [{ id, nombre, tipo, sede, monitores_asignados, capacidad_monitores }]` | `400 Parámetros inválidos o fuera de horario de sede` |
| `GET` | `/monitores/me/turnos` | — (JWT) | `200 { turnos: [...], horas_acumuladas, porcentaje_completado, estado_progreso }` | `401 Token inválido` |
| `POST` | `/turnos` | `{ monitor_id, sala_id, hora_inicio, hora_fin }` | `201 { id, sala, monitor, hora_inicio, hora_fin, estado }` | `409 Conflicto de horario` · `422 Límite de horas excedido` · `403 Solo coordinador` |
| `PATCH` | `/turnos/:id/estado` | `{ estado: 'cancelado' \| 'finalizado_anticipado', hora_fin_real? }` | `200 { id, estado, hora_fin_real, horas_efectivas }` | `404 Turno no encontrado` · `403 Solo coordinador` |
| `PATCH` | `/salas/:id/estado` | `{ estado: 'disponible' \| 'bloqueada' }` | `200 { id, nombre, estado }` | `409 Sala tiene turnos activos` · `403 Solo coordinador` |

> Todos los endpoints excepto `POST /auth/login` requieren `Authorization: Bearer <token>`.  
> `POST /turnos` y ambos `PATCH` requieren rol `coordinador` (guard `@Roles('coordinador')`).

---

## 4. Contrato del webhook para n8n

El backend llama al webhook **de forma asíncrona** después de persistir exitosamente el turno. Si falla, registra en `notificaciones_pendientes` para reintento.

```
Método:  POST
URL:     https://n8n.ejemplo.com/webhook/turno-asignado
Headers: Content-Type: application/json
         X-TurnoMonitores-Secret: <shared_secret>   ← validar en n8n
```

**Payload JSON:**
```json
{
  "evento": "turno_asignado",
  "turno": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "hora_inicio": "2024-09-12T09:00:00-05:00",
    "hora_fin": "2024-09-12T14:00:00-05:00",
    "duracion_horas": 5,
    "estado": "pendiente"
  },
  "sala": {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "nombre": "Sala MAC 1",
    "tipo": "mac",
    "sede": "Sede Lans"
  },
  "monitor": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "nombre": "Laura Gómez",
    "email": "l.gomez@ucaldas.edu.co"
  },
  "semestre": {
    "id": "1e3d5c7a-9b2f-4e6d-8a0c-2b4d6f8e0a2c",
    "nombre": "2024-2"
  },
  "metadata": {
    "timestamp": "2024-09-11T15:32:10-05:00",
    "notificacion_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**Campos que n8n usa para armar el correo:**
- `monitor.email` → destinatario
- `monitor.nombre` → saludo personalizado
- `sala.nombre` + `sala.sede` → cuerpo del correo
- `turno.hora_inicio` / `turno.hora_fin` → horario del turno
- `turno.duracion_horas` → horas del turno
- `semestre.nombre` → contexto semestral
- `metadata.notificacion_id` → campo de idempotencia para evitar doble envío en reintentos

---

## 5. La pregunta crítica

> **¿La consulta de disponibilidad de salas (`GET /salas/disponibles`) refleja disponibilidad en tiempo real o disponibilidad por franja horaria futura?**

Son dos cosas distintas:

- **Tiempo real:** "¿Qué salas tienen monitor ahora mismo?" — útil para el estudiante que va a entrar a una sala en este momento.
- **Franja futura:** "¿En qué salas hay cupo para asignar un turno el jueves de 9:00 a 13:00?" — útil para el coordinador que va a asignar.

La respuesta cambia el query principal del sistema, la UI del filtro, las reglas de solapamiento y cómo se calcula `monitores_asignados` en el response. Si se construye para un caso y el coordinador necesita el otro, hay que reescribir el endpoint central del MVP. **Esta decisión debe tomarse antes de escribir una sola línea de código del módulo de salas.**
