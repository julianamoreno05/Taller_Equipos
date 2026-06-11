import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(express.json());

const monitores = [
  { id: 'm-1', nombre: 'Maria Fernanda Hernandez', email: 'maria.hernandez28361@ucaldas.edu.co' },
  { id: 'm-2', nombre: 'Juliana Moreno', email: 'juliana.1701513897@ucaldas.edu.co' },
];

const salones = [
  { id: 's-1', nombre: 'Sala E', sede: 'Sede Lans' },
  { id: 's-2', nombre: 'Sala H1', sede: 'Sede Central' },
];

const turnos = [];

const solapa = (a, b) =>
  a.fecha === b.fecha &&
  a.hora_inicio < b.hora_fin &&
  a.hora_fin > b.hora_inicio;

const dispararWebhook = (payload) => {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => console.error('[webhook] error:', err.message));
};

app.get('/monitores', (_req, res) => res.json(monitores));

app.get('/salones', (_req, res) => res.json(salones));

app.post('/turnos', (req, res) => {
  const { salon_id, monitor_id, materia, fecha, hora_inicio, hora_fin } = req.body;

  for (const campo of ['salon_id', 'monitor_id', 'materia', 'fecha', 'hora_inicio', 'hora_fin']) {
    if (!req.body[campo]) {
      return res.status(400).json({ error: 'Campo requerido ausente.', detalle: campo });
    }
  }

  const salon = salones.find((s) => s.id === salon_id);
  const monitor = monitores.find((m) => m.id === monitor_id);

  if (!salon) return res.status(404).json({ error: 'Salón no encontrado.', detalle: salon_id });
  if (!monitor) return res.status(404).json({ error: 'Monitor no encontrado.', detalle: monitor_id });

  const candidato = { salon_id, monitor_id, fecha, hora_inicio, hora_fin };

  const conflictoSalon = turnos.find((t) => t.salon_id === salon_id && solapa(t, candidato));
  if (conflictoSalon) {
    return res.status(409).json({
      error: 'El salón ya tiene un turno en ese horario.',
      detalle: `${conflictoSalon.hora_inicio}–${conflictoSalon.hora_fin} el ${conflictoSalon.fecha}`,
    });
  }

  const conflictoMonitor = turnos.find((t) => t.monitor_id === monitor_id && solapa(t, candidato));
  if (conflictoMonitor) {
    return res.status(409).json({
      error: 'El monitor ya tiene un turno asignado en ese horario.',
      detalle: `${conflictoMonitor.hora_inicio}–${conflictoMonitor.hora_fin} el ${conflictoMonitor.fecha}`,
    });
  }

  const turno = {
    id: randomUUID(),
    salon_id,
    monitor_id,
    materia,
    fecha,
    hora_inicio,
    hora_fin,
    estado: 'pendiente',
    created_at: new Date().toISOString(),
  };

  turnos.push(turno);

  const duracion_horas = (
    (new Date(`${fecha}T${hora_fin}`) - new Date(`${fecha}T${hora_inicio}`)) / 3_600_000
  );

  const payload = {
    evento: 'turno_asignado',
    turno: {
      id: turno.id,
      hora_inicio: `${fecha}T${hora_inicio}`,
      hora_fin: `${fecha}T${hora_fin}`,
      duracion_horas,
      estado: turno.estado,
    },
    sala: {
      id: salon.id,
      nombre: salon.nombre,
      sede: salon.sede,
    },
    monitor: {
      id: monitor.id,
      nombre: monitor.nombre,
      email: monitor.email,
    },
    metadata: {
      timestamp: turno.created_at,
      notificacion_id: randomUUID(),
    },
  };

  dispararWebhook(payload);

  res.status(201).json(payload);
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`servidor en http://localhost:${PORT}`));