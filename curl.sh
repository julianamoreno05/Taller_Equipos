BASE=http://localhost:3000

echo "── GET /monitores ──────────────────────────────────────────"
curl -s "$BASE/monitores" | jq .

echo "── GET /salones ────────────────────────────────────────────"
curl -s "$BASE/salones" | jq .

echo "── POST /turnos — turno válido (Maria, Sala E) ─────────────"
curl -s -X POST "$BASE/turnos" \
  -H "Content-Type: application/json" \
  -d '{
    "salon_id":    "s-1",
    "monitor_id":  "m-1",
    "materia":     "Bases de Datos",
    "fecha":       "2025-06-12",
    "hora_inicio": "09:00",
    "hora_fin":    "13:00"
  }' | jq .

echo "── POST /turnos — conflicto de salón (Sala E solapada) ─────"
curl -s -X POST "$BASE/turnos" \
  -H "Content-Type: application/json" \
  -d '{
    "salon_id":    "s-1",
    "monitor_id":  "m-2",
    "materia":     "Redes",
    "fecha":       "2025-06-12",
    "hora_inicio": "11:00",
    "hora_fin":    "15:00"
  }' | jq .

echo "── POST /turnos — turno válido (Juliana, Sala H1) ──────────"
curl -s -X POST "$BASE/turnos" \
  -H "Content-Type: application/json" \
  -d '{
    "salon_id":    "s-2",
    "monitor_id":  "m-2",
    "materia":     "Algoritmos",
    "fecha":       "2025-06-12",
    "hora_inicio": "10:00",
    "hora_fin":    "14:00"
  }' | jq .

echo "── POST /turnos — conflicto de monitor (Juliana ya ocupada en s-2 10:00–14:00) ─"
curl -s -X POST "$BASE/turnos" \
  -H "Content-Type: application/json" \
  -d '{
    "salon_id":    "s-1",
    "monitor_id":  "m-2",
    "materia":     "Redes",
    "fecha":       "2025-06-12",
    "hora_inicio": "13:00",
    "hora_fin":    "15:00"
  }' | jq .

echo "── POST /turnos — campo requerido ausente (sin materia) ────"
curl -s -X POST "$BASE/turnos" \
  -H "Content-Type: application/json" \
  -d '{
    "salon_id":    "s-1",
    "monitor_id":  "m-1",
    "fecha":       "2025-06-12",
    "hora_inicio": "07:00",
    "hora_fin":    "09:00"
  }' | jq .
