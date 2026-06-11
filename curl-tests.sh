BASE=http://localhost:3000

# ── GET /salas/disponibles ────────────────────────────────────────────────────
# Sede Lans, franja 09:00–13:00
curl -s "$BASE/salas/disponibles?sede_id=sede-lans&fecha=2025-06-11&hora_inicio=09:00&hora_fin=13:00" | jq .

# Sede Central, franja 10:00–15:00
curl -s "$BASE/salas/disponibles?sede_id=sede-central&fecha=2025-06-11&hora_inicio=10:00&hora_fin=15:00" | jq .

# Caso sin resultados: franja en la que todas las salas de Central están llenas o bloqueadas
curl -s "$BASE/salas/disponibles?sede_id=sede-central&fecha=2025-06-11&hora_inicio=07:00&hora_fin=14:00" | jq .

# Error: horario fuera del rango permitido para Sede Lans (fin 16:00 > 15:00)
curl -s "$BASE/salas/disponibles?sede_id=sede-lans&fecha=2025-06-11&hora_inicio=09:00&hora_fin=16:00" | jq .


# ── GET /monitores/me/turnos ──────────────────────────────────────────────────
curl -s "$BASE/monitores/me/turnos" | jq .


# ── POST /turnos — turno válido ───────────────────────────────────────────────
curl -s -X POST "$BASE/turnos" \
  -H "Content-Type: application/json" \
  -d '{
    "monitor_id":  "mon-001",
    "sala_id":     "sala-002",
    "hora_inicio": "2025-06-12T10:00:00-05:00",
    "hora_fin":    "2025-06-12T14:00:00-05:00"
  }' | jq .

# POST /turnos — conflicto de horario (mon-001 ya tiene turno el 11 de 09:00 a 12:00)
curl -s -X POST "$BASE/turnos" \
  -H "Content-Type: application/json" \
  -d '{
    "monitor_id":  "mon-001",
    "sala_id":     "sala-002",
    "hora_inicio": "2025-06-11T10:00:00-05:00",
    "hora_fin":    "2025-06-11T13:00:00-05:00"
  }' | jq .

# POST /turnos — sala bloqueada
curl -s -X POST "$BASE/turnos" \
  -H "Content-Type: application/json" \
  -d '{
    "monitor_id":  "mon-002",
    "sala_id":     "sala-003",
    "hora_inicio": "2025-06-12T08:00:00-05:00",
    "hora_fin":    "2025-06-12T12:00:00-05:00"
  }' | jq .

# POST /turnos — límite de 7 h/día (mon-002 ya tiene 7 h el 11 de junio)
curl -s -X POST "$BASE/turnos" \
  -H "Content-Type: application/json" \
  -d '{
    "monitor_id":  "mon-002",
    "sala_id":     "sala-004",
    "hora_inicio": "2025-06-11T07:00:00-05:00",
    "hora_fin":    "2025-06-11T14:30:00-05:00"
  }' | jq .
