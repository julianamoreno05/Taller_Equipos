const solapa = (a, b) =>
  a.fecha === b.fecha &&
  a.hora_inicio < b.hora_fin &&
  a.hora_fin    > b.hora_inicio;

const conflictoSalon = turnos.find((t) => t.salon_id === salon_id && solapa(t, candidato));
if (conflictoSalon) {
  return res.status(409).json({
    error:   'El salón ya tiene un turno en ese horario.',
    detalle: `${conflictoSalon.hora_inicio}–${conflictoSalon.hora_fin} el ${conflictoSalon.fecha}`,
  });
}

const conflictoMonitor = turnos.find((t) => t.monitor_id === monitor_id && solapa(t, candidato));
if (conflictoMonitor) {
  return res.status(409).json({
    error:   'El monitor ya tiene un turno asignado en ese horario.',
    detalle: `${conflictoMonitor.hora_inicio}–${conflictoMonitor.hora_fin} el ${conflictoMonitor.fecha}`,
  });
}
