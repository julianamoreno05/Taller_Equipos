import { useState, useEffect } from 'react';

const API = 'http://localhost:3000';

const ESTADO_INICIAL = {
  salon_id: '',
  monitor_id: '',
  materia: '',
  fecha: '',
  hora_inicio: '',
  hora_fin: '',
};

export default function FormularioTurno() {
  const [salones, setSalones] = useState([]);
  const [monitores, setMonitores] = useState([]);
  const [form, setForm] = useState(ESTADO_INICIAL);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    const cargarDatos = async () => {
      try {
        const [resSalones, resMonitores] = await Promise.all([
          fetch(`${API}/salones`),
          fetch(`${API}/monitores`),
        ]);
        setSalones(await resSalones.json());
        setMonitores(await resMonitores.json());
      } catch {
        setMensaje({ tipo: 'error', texto: 'No se pudo conectar con el backend. Verifica que esté corriendo en el puerto 3000.' });
      }
    };
    cargarDatos();
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    setMensaje(null);
    setEnviando(true);

    try {
      const res = await fetch(`${API}/turnos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (res.status === 201) {
        const salon = salones.find((s) => s.id === form.salon_id);
        const monitor = monitores.find((m) => m.id === form.monitor_id);
        setMensaje({
          tipo: 'exito',
          texto: `Turno asignado: ${monitor?.nombre} en ${salon?.nombre} el ${form.fecha} de ${form.hora_inicio} a ${form.hora_fin}.`,
        });
        setForm(ESTADO_INICIAL);
      } else if (res.status === 409) {
        setMensaje({ tipo: 'error', texto: data.detalle });
      } else if (res.status === 400) {
        setMensaje({ tipo: 'error', texto: data.error });
      } else {
        setMensaje({ tipo: 'error', texto: data.error ?? 'Error inesperado del servidor.' });
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error de red. Intenta de nuevo.' });
    } finally {
      setEnviando(false);
    }
  };

  const formCompleto = Object.values(form).every((v) => v !== '');

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Asignar turno de monitoría</h2>
      <p style={{ fontSize: 14, color: '#666', marginBottom: 24 }}>TurnoMonitores · Universidad de Caldas</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ fontSize: 13, fontWeight: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Salón
          <select name="salon_id" value={form.salon_id} onChange={handleChange} style={estiloInput}>
            <option value="">Selecciona un salón</option>
            {salones.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre} — {s.sede}</option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 13, fontWeight: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Monitor
          <select name="monitor_id" value={form.monitor_id} onChange={handleChange} style={estiloInput}>
            <option value="">Selecciona un monitor</option>
            {monitores.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 13, fontWeight: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Materia
          <input name="materia" type="text" value={form.materia} onChange={handleChange} placeholder="Ej: Bases de Datos" style={estiloInput} />
        </label>

        <label style={{ fontSize: 13, fontWeight: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Fecha
          <input name="fecha" type="date" value={form.fecha} onChange={handleChange} style={estiloInput} />
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Hora inicio
            <input name="hora_inicio" type="time" value={form.hora_inicio} onChange={handleChange} style={estiloInput} />
          </label>
          <label style={{ fontSize: 13, fontWeight: 500, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            Hora fin
            <input name="hora_fin" type="time" value={form.hora_fin} onChange={handleChange} style={estiloInput} />
          </label>
        </div>

        <button
          onClick={handleSubmit}
          disabled={enviando || !formCompleto}
          style={{
            padding: '10px 16px',
            fontSize: 14,
            fontWeight: 600,
            color: '#fff',
            background: enviando || !formCompleto ? '#9db8d9' : '#1d5fa8',
            border: 'none',
            borderRadius: 8,
            cursor: enviando || !formCompleto ? 'not-allowed' : 'pointer',
            marginTop: 8,
          }}
        >
          {enviando ? 'Asignando…' : 'Asignar turno'}
        </button>

        {mensaje && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 14,
              lineHeight: 1.5,
              background: mensaje.tipo === 'exito' ? '#e8f5e9' : '#fdecea',
              color: mensaje.tipo === 'exito' ? '#1b5e20' : '#b71c1c',
              border: `1px solid ${mensaje.tipo === 'exito' ? '#a5d6a7' : '#f5c6c2'}`,
            }}
          >
            {mensaje.texto}
          </div>
        )}
      </div>
    </div>
  );
}

const estiloInput = {
  padding: '9px 12px',
  fontSize: 14,
  border: '1px solid #ccc',
  borderRadius: 8,
  fontFamily: 'inherit',
};
