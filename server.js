import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';

const app = express();
app.use(express.json());

const HORARIOS_SEDE = {
  lans:    { inicio: '07:00', fin: '15:00' },
  central: { inicio: '07:00', fin: '18:00' },
};

const sedes = [
  { id: 'sede-lans',    nombre: 'Sede Lans',    tipo: 'lans' },
  { id: 'sede-central', nombre: 'Sede Central', tipo: 'central' },
];

const salas = [
  { id: 'sala-001', sede_id: 'sede-lans',    nombre: 'Sala MAC 1',    tipo: 'mac',    capacidad_monitores: 2, estado: 'disponible' },
  { id: 'sala-002', sede_id: 'sede-lans',    nombre: 'Sala MAC 2',    tipo: 'mac',    capacidad_monitores: 2, estado: 'disponible' },
  { id: 'sala-003', sede_id: 'sede-lans',    nombre: 'Sala Normal 1', tipo: 'normal', capacidad_monitores: 2, estado: 'bloqueada'  },
  { id: 'sala-004', sede_id: 'sede-central', nombre: 'Sala Normal 2', tipo: 'normal', capacidad_monitores: 2, estado: 'disponible' },
  { id: 'sala-005', sede_id: 'sede-central', nombre: 'Sala Normal 3', tipo: 'normal', capacidad_monitores: 2, estado: 'llena'      },
];

const monitores = [
  { id: 'mon-001', nombre: 'Laura Gómez',    email: 'l.gomez@ucaldas.edu.co',    horas_acumuladas: 42 },
  { id: 'mon-002', nombre: 'Carlos Ríos',    email: 'c.rios@ucaldas.edu.co',     horas_acumuladas: 61 },
  { id: 'mon-003', nombre: 'Sofía Herrera',  email: 's.herrera@ucaldas.edu.co',  horas_acumuladas: 158 },
];

const turnos = [
  {
    id: 'turno-001',
    monitor_id:  'mon-001',
    sala_id:     'sala-001',
    hora_inicio: '2025-06-11T09:00:00-05:00',
    hora_fin:    '2025-06-11T12:00:00-05:00',
    estado:      'activo',
  },
  {
    id: 'turno-002',
    monitor_id:  'mon-002',
    sala_id:     'sala-005',
    hora_inicio: '2025-06-11T07:00:00-05:00',
    hora_fin:    '2025-06-11T14:00:00-05:00',
    estado:      'activo',
  },
];

const toMinutes = (timeStr) => {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const timeOfDay = (isoString) => {
  const d = new Date(isoString);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

const validateConflict = (turnosExistentes, nuevo) => {
  const nuevoInicio = new Date(nuevo.hora_inicio).getTime();
  const nuevoFin   = new Date(nuevo.hora_fin).getTime();

  const solapaTurno = turnosExistentes.find(
    (t) =>
      t.monitor_id === nuevo.monitor_id &&
      ['pendiente', 'activo'].includes(t.estado) &&
      new Date(t.hora_inicio).getTime() < nuevoFin &&
      new Date(t.hora_fin).getTime()   > nuevoInicio
  );

  if (solapaTurno) {
    return {
      tipo: 'CONFLICTO_HORARIO_MONITOR',
      detalle: `El monitor ya tiene un turno activo entre ${solapaTurno.hora_inicio} y ${solapaTurno.hora_fin}.`,
    };
  }

  const turnosMonitorHoy = turnosExistentes.filter((t) => {
    const mismoMonitor  = t.monitor_id === nuevo.monitor_id;
    const estadoValido  = ['pendiente', 'activo', 'completado'].includes(t.estado);
    const mismaFecha    = t.hora_inicio.slice(0, 10) === nuevo.hora_inicio.slice(0, 10);
    return mismoMonitor && estadoValido && mismaFecha;
  });

  const horasHoy = turnosMonitorHoy.reduce((acc, t) => {
    const diff = (new Date(t.hora_fin) - new Date(t.hora_inicio)) / 3_600_000;
    return acc + diff;
  }, 0);

  const duracionNuevo = (new Date(nuevo.hora_fin) - new Date(nuevo.hora_inicio)) / 3_600_000;

  if (horasHoy + duracionNuevo > 7) {
    return {
      tipo: 'LIMITE_HORAS_DIA',
      detalle: `El monitor acumularía ${(horasHoy + duracionNuevo).toFixed(1)} h hoy. El máximo es 7 h/día.`,
    };
  }

  return null;
};

const dispararWebhook = async (payload) => {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`n8n respondió ${res.status}`);
  } catch (err) {
    console.error('[webhook] fallo al notificar a n8n:', err.message);
  }
};

app.get('/salas/disponibles', (req, res) => {
  const { sede_id, fecha, hora_inicio, hora_fin } = req.query;

  if (!sede_id || !fecha || !hora_inicio || !hora_fin) {
    return res.status(400).json({ error: 'Faltan parámetros: sede_id, fecha, hora_inicio, hora_fin.' });
  }

  const sede = sedes.find((s) => s.id === sede_id);
  if (!sede) return res.status(400).json({ error: 'sede_id no válido.' });

  const horario = HORARIOS_SEDE[sede.tipo];
  if (
    toMinutes(hora_inicio) < toMinutes(horario.inicio) ||
    toMinutes(hora_fin)    > toMinutes(horario.fin)    ||
    toMinutes(hora_inicio) >= toMinutes(hora_fin)
  ) {
    return res.status(400).json({
      error: `Horario fuera del rango permitido para ${sede.nombre}: ${horario.inicio}–${horario.fin}.`,
    });
  }

  const solicitudInicio = new Date(`${fecha}T${hora_inicio}:00`).getTime();
  const solicitudFin    = new Date(`${fecha}T${hora_fin}:00`).getTime();

  const salasDeSede = salas.filter((s) => s.sede_id === sede_id && s.estado !== 'bloqueada');

  const resultado = salasDeSede.map((sala) => {
    const monitoresEnFranja = turnos.filter(
      (t) =>
        t.sala_id === sala.id &&
        ['pendiente', 'activo'].includes(t.estado) &&
        new Date(t.hora_inicio).getTime() < solicitudFin &&
        new Date(t.hora_fin).getTime()    > solicitudInicio
    ).length;

    return {
      id:                  sala.id,
      nombre:              sala.nombre,
      tipo:                sala.tipo,
      sede:                sede.nombre,
      estado:              sala.estado,
      monitores_asignados: monitoresEnFranja,
      capacidad_monitores: sala.capacidad_monitores,
      disponible:          sala.estado === 'disponible' && monitoresEnFranja < sala.capacidad_monitores,
    };
  }).filter((s) => s.disponible);

  res.json(resultado);
});

app.get('/monitores/me/turnos', (req, res) => {
  const monitor = monitores[0];

  const turnosMonitor = turnos
    .filter((t) => t.monitor_id === monitor.id)
    .map((t) => {
      const sala = salas.find((s) => s.id === t.sala_id);
      return { ...t, sala: sala?.nombre ?? 'Desconocida' };
    });

  const horas_acumuladas    = monitor.horas_acumuladas;
  const porcentaje          = Math.round((horas_acumuladas / 160) * 100);
  const estado_progreso     =
    horas_acumuladas >= 160 ? 'maximo_alcanzado'
    : horas_acumuladas >= 60 ? 'minimo_cumplido'
    : 'en_progreso';

  res.json({ monitor: { id: monitor.id, nombre: monitor.nombre, email: monitor.email }, turnos: turnosMonitor, horas_acumuladas, porcentaje_completado: porcentaje, estado_progreso });
});

app.post('/turnos', async (req, res) => {
  const { monitor_id, sala_id, hora_inicio, hora_fin } = req.body;

  if (!monitor_id || !sala_id || !hora_inicio || !hora_fin) {
    return res.status(400).json({ error: 'Faltan campos: monitor_id, sala_id, hora_inicio, hora_fin.' });
  }

  const monitor = monitores.find((m) => m.id === monitor_id);
  if (!monitor) return res.status(404).json({ error: 'Monitor no encontrado.' });

  const sala = salas.find((s) => s.id === sala_id);
  if (!sala) return res.status(404).json({ error: 'Sala no encontrada.' });

  if (sala.estado === 'bloqueada') {
    return res.status(409).json({ error: 'La sala está bloqueada.' });
  }

  const conflicto = validateConflict(turnos, { monitor_id, sala_id, hora_inicio, hora_fin });
  if (conflicto) {
    return res.status(409).json({ error: conflicto.detalle, tipo: conflicto.tipo });
  }

  const duracion_horas = (new Date(hora_fin) - new Date(hora_inicio)) / 3_600_000;

  const nuevoTurno = {
    id:          crypto.randomUUID(),
    monitor_id,
    sala_id,
    hora_inicio,
    hora_fin,
    estado:      'pendiente',
  };

  turnos.push(nuevoTurno);

  const sede = sedes.find((s) => s.id === sala.sede_id);

  const monitoresEnSala = turnos.filter(
    (t) =>
      t.sala_id === sala_id &&
      ['pendiente', 'activo'].includes(t.estado) &&
      new Date(t.hora_inicio).getTime() < new Date(hora_fin).getTime() &&
      new Date(t.hora_fin).getTime()    > new Date(hora_inicio).getTime()
  ).length;

  if (monitoresEnSala >= sala.capacidad_monitores) {
    sala.estado = 'llena';
  }

  const webhookPayload = {
    evento: 'turno_asignado',
    turno: {
      id:             nuevoTurno.id,
      hora_inicio,
      hora_fin,
      duracion_horas,
      estado:         nuevoTurno.estado,
    },
    sala: {
      id:     sala.id,
      nombre: sala.nombre,
      tipo:   sala.tipo,
      sede:   sede?.nombre ?? '',
    },
    monitor: {
      id:     monitor.id,
      nombre: monitor.nombre,
      email:  monitor.email,
    },
    metadata: {
      timestamp:        new Date().toISOString(),
      notificacion_id:  crypto.randomUUID(),
    },
  };

  dispararWebhook(webhookPayload);

  res.status(201).json({
    id:             nuevoTurno.id,
    monitor:        { id: monitor.id, nombre: monitor.nombre, email: monitor.email },
    sala:           { id: sala.id, nombre: sala.nombre, tipo: sala.tipo, sede: sede?.nombre },
    hora_inicio,
    hora_fin,
    duracion_horas,
    estado:         nuevoTurno.estado,
  });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`servidor corriendo en http://localhost:${PORT}`));
