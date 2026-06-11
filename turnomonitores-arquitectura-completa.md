# TurnoMonitores — Documento de arquitectura técnica
**Stack: NestJS · PostgreSQL (Neon) · Next.js + Vite · fly.io · JWT · n8n**

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
│           │            └──────────────────────────────┘            │
│           │                    │                                    │
│  ┌────────┴────────────────────┴──────────────────────────────┐    │
│  │  CronService (@Cron cada 5 min)                            │    │
│  │  Reintenta notificaciones_pendientes donde enviado = false │    │
│  └────────────────────────────────────────────────────────────┘    │
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
│  semestres                    │   │  Nodo: IF fallo → log error  │
│  turnos                       │   │                              │
│  usuarios                     │   └──────────────────────────────┘
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

## 2. Decisiones técnicas del equipo

**Disponibilidad de salas**
Se manejan dos modalidades. Disponibilidad en tiempo real para soportar la liberación y el bloqueo manual de salas por el coordinador. Disponibilidad por franja horaria futura para tener en cuenta los horarios de clase ya programados y las reservas existentes antes de permitir una nueva asignación. La tabla `salas` mantiene un campo `estado ENUM('disponible', 'bloqueada', 'llena')` que refleja el estado actual; la consulta por franja futura cruza ese estado con los turnos activos en el rango solicitado.

**Autenticación**
HTTPS en todas las comunicaciones. JWT Bearer token en el header `Authorization` de cada request autenticado. El token incluye el rol del usuario para que los guards de NestJS puedan aplicar control de acceso por rol sin consultar la BD en cada request.

**Persistencia**
PostgreSQL en Neon como base de datos principal. Backup con Point-in-Time Recovery (PITR) incluido en Neon — retención de 7 días en plan gratuito, 30 días en planes pagos. No requiere configuración adicional para el entorno del proyecto.

**Integración con n8n**
El backend llama al webhook de n8n de forma asíncrona (fire-and-forget) después de persistir un turno exitosamente. El flujo en n8n tiene tres nodos: Trigger por Webhook POST, Send Email vía SMTP institucional, y un nodo IF que captura fallos y los registra en el log de n8n. Los reintentos los gestiona el backend mediante la tabla `notificaciones_pendientes` y un cron job cada 5 minutos.

**Despliegues**
CI/CD con GitHub Actions. `push` a `main` despliega a producción en fly.io; `push` a `develop` despliega a staging. El pipeline corre tests y build antes de desplegar. Las variables de entorno viven en fly.io secrets.

**Arquitectura interna del backend**
Arquitectura en capas dentro de NestJS. Controllers sin lógica de negocio, Services con todas las reglas, Repositories como única capa que toca TypeORM. Estructura de módulos: `salas`, `turnos`, `monitores`, `auth`, con `common/guards`, `common/filters` y `config` transversales.

---

## 3. Schema SQL — PostgreSQL (producción)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- SEMESTRES
-- ─────────────────────────────────────────
CREATE TABLE semestres (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(20)  NOT NULL UNIQUE,
  fecha_inicio  DATE         NOT NULL,
  fecha_fin     DATE         NOT NULL,
  activo        BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_fechas CHECK (fecha_fin > fecha_inicio)
);

CREATE UNIQUE INDEX idx_semestre_activo_unico
  ON semestres (activo)
  WHERE activo = true;

-- ─────────────────────────────────────────
-- USUARIOS
-- ─────────────────────────────────────────
CREATE TYPE rol_usuario AS ENUM ('administrador', 'coordinador', 'monitor', 'estudiante');

CREATE TABLE usuarios (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  rol           rol_usuario  NOT NULL,
  activo        BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- MONITORES
-- ─────────────────────────────────────────
CREATE TABLE monitores (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          VARCHAR(80)  NOT NULL UNIQUE,
  tipo            tipo_sede    NOT NULL,
  horario_inicio  TIME         NOT NULL,
  horario_fin     TIME         NOT NULL,
  CONSTRAINT chk_horario CHECK (horario_fin > horario_inicio)
);

-- ─────────────────────────────────────────
-- SALAS
-- ─────────────────────────────────────────
CREATE TYPE tipo_sala   AS ENUM ('mac', 'normal');
CREATE TYPE estado_sala AS ENUM ('disponible', 'bloqueada', 'llena');

CREATE TABLE salas (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id             UUID         NOT NULL
                        REFERENCES sedes(id) ON DELETE RESTRICT,
  nombre              VARCHAR(80)  NOT NULL,
  tipo                tipo_sala    NOT NULL,
  capacidad_monitores SMALLINT     NOT NULL DEFAULT 2
                        CHECK (capacidad_monitores BETWEEN 1 AND 2),
  estado              estado_sala  NOT NULL DEFAULT 'disponible',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
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
  hora_fin_real   TIMESTAMPTZ,
  cancelado_por   UUID          REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_horas_turno  CHECK (hora_fin > hora_inicio),
  CONSTRAINT chk_duracion_max CHECK (
    EXTRACT(EPOCH FROM (hora_fin - hora_inicio)) / 3600 <= 7
  )
);

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

**Queries de validación en `TurnosService` (no en BD)**

```sql
-- Conflicto de horario del monitor
SELECT id FROM turnos
WHERE monitor_id = $1
  AND estado IN ('pendiente', 'activo')
  AND hora_inicio < $3
  AND hora_fin > $2;

-- Horas acumuladas en el día
SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (hora_fin - hora_inicio))/3600), 0)
FROM turnos
WHERE monitor_id = $1
  AND DATE(hora_inicio) = DATE($2)
  AND estado IN ('pendiente', 'activo', 'completado');

-- Horas acumuladas en el semestre
SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (hora_fin - hora_inicio))/3600), 0)
FROM turnos
WHERE monitor_id = $1
  AND semestre_id = $3
  AND estado IN ('pendiente', 'activo', 'completado', 'finalizado_anticipado');
```

---

## 4. Endpoints del taller — imprescindibles para US-02

| Orden | Método | Ruta | Rol que construye | Desbloquea |
|-------|--------|------|-------------------|------------|
| 1 | `POST` | `/auth/login` | Backend | Frontend puede autenticarse · n8n puede obtener token |
| 2 | `GET` | `/salas/disponibles` | Backend | Frontend puede pintar la pantalla principal de US-02 |
| 3 | `POST` | `/turnos` | Backend | n8n recibe datos reales del webhook · demo end-to-end |
| 4 | `GET` | `/monitores/me/turnos` | Backend | Frontend puede mostrar panel de progreso del monitor |

---

## 5. Endpoints completos del sistema

| Método | Ruta | Body entrada | Respuesta exitosa | Error principal |
|--------|------|--------------|-------------------|-----------------|
| `POST` | `/auth/login` | `{ email, password }` | `200 { access_token, rol, nombre }` | `401 Credenciales inválidas` |
| `GET` | `/salas/disponibles` | Query: `sede_id`, `fecha`, `hora_inicio`, `hora_fin` | `200 [{ id, nombre, tipo, sede, monitores_asignados, capacidad_monitores, estado }]` | `400 Parámetros inválidos o fuera de horario de sede` |
| `GET` | `/salas/estado-actual` | Query: `sede_id?` | `200 [{ id, nombre, tipo, sede, estado, monitores_activos }]` | `401 Token inválido` |
| `PATCH` | `/salas/:id/estado` | `{ estado: 'disponible' \| 'bloqueada' }` | `200 { id, nombre, estado }` | `409 Sala con turnos activos · 403 Solo coordinador` |
| `GET` | `/monitores/me/turnos` | — (JWT) | `200 { turnos: [...], horas_acumuladas, porcentaje_completado, estado_progreso }` | `401 Token inválido` |
| `POST` | `/turnos` | `{ monitor_id, sala_id, hora_inicio, hora_fin }` | `201 { id, sala, monitor, hora_inicio, hora_fin, duracion_horas, estado }` | `409 Conflicto de horario · 422 Límite de horas excedido · 403 Solo coordinador` |
| `PATCH` | `/turnos/:id/estado` | `{ estado: 'cancelado' \| 'finalizado_anticipado', hora_fin_real? }` | `200 { id, estado, hora_fin_real, horas_efectivas }` | `404 Turno no encontrado · 403 Solo coordinador` |
| `GET` | `/turnos` | Query: `monitor_id?`, `sala_id?`, `fecha?`, `estado?` | `200 [{ id, monitor, sala, hora_inicio, hora_fin, estado }]` | `403 Solo coordinador` |

> Todos los endpoints excepto `POST /auth/login` requieren `Authorization: Bearer <token>`.
> `POST /turnos`, `PATCH /turnos/:id/estado`, `PATCH /salas/:id/estado` y `GET /turnos` requieren rol `coordinador`.

---

## 6. Contrato del webhook para n8n

El backend llama al webhook **de forma asíncrona** tras persistir el turno. Si falla, registra en `notificaciones_pendientes`. El cron de NestJS reintenta cada 5 minutos hasta 3 intentos.

```
Método:  POST
URL:     https://n8n.ejemplo.com/webhook/turno-asignado
Headers:
  Content-Type: application/json
  X-TurnoMonitores-Secret: <shared_secret>
```

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

Campos que n8n usa para el correo:

| Campo | Uso en n8n |
|-------|-----------|
| `monitor.email` | Destinatario |
| `monitor.nombre` | Saludo personalizado |
| `sala.nombre` + `sala.sede` | Cuerpo del correo |
| `turno.hora_inicio` / `turno.hora_fin` | Horario del turno |
| `turno.duracion_horas` | Horas del turno |
| `semestre.nombre` | Contexto semestral |
| `metadata.notificacion_id` | Idempotencia — evita doble envío en reintentos |

---

## 7. Punto de coordinación crítico entre roles

El Automatizador crea el webhook en n8n primero (tarda menos de 2 minutos) y le pasa la URL al Backend antes del minuto 20.

El Backend necesita esa URL en `N8N_WEBHOOK_URL` del `.env` antes de probar `POST /turnos`, porque sin ella el disparo del webhook falla silenciosamente y n8n no recibe nada.

Si el Backend termina el endpoint 3 antes de tener la URL, puede loguear el payload en consola como fallback temporal para validar que los datos del contrato son correctos — pero la demo end-to-end requiere la URL real.

El Frontend no depende de este punto: puede construir su pantalla contra `GET /salas/disponibles` en paralelo sin esperar al webhook.
