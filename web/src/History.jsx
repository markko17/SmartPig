import { useEffect, useState } from "react";
import { subscribeToHistory } from "./dataService";

const NO_DATA = "No data";
const RECORD_COUNT = 60;

function formatTime(ms) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}

function validNumber(row, field) {
  return row.sensorOk === true && typeof row[field] === "number"
    ? row[field]
    : null;
}

function LineChart({ title, unit, rows, field }) {
  const points = rows.map((r) => validNumber(r, field));
  const values = points.filter((v) => v !== null);

  if (values.length < 2) {
    return (
      <div className="chart">
        <h3>{title}</h3>
        <p className="small">Not enough data yet</p>
      </div>
    );
  }

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const W = 340;
  const H = 110;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => H - ((v - min) / (max - min)) * H;

  // A failed reading breaks the line instead of being drawn as zero
  let d = "";
  let penDown = false;
  points.forEach((v, i) => {
    if (v === null) {
      penDown = false;
      return;
    }
    d += `${penDown ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    penDown = true;
  });

  const latest = values[values.length - 1];

  return (
    <div className="chart">
      <h3>{title}</h3>
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="chart-svg">
        <path d={d} fill="none" stroke="#0b5fff" strokeWidth="2" />
      </svg>
      <p className="small">
        Min {min.toFixed(1)} {unit} · Max {max.toFixed(1)} {unit} · Latest{" "}
        {latest.toFixed(1)} {unit}
      </p>
    </div>
  );
}

export default function History() {
  const [rows, setRows] = useState([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const stop = subscribeToHistory(
      RECORD_COUNT,
      (data) => {
        setRows(data);
        setError(null);
        setHasLoaded(true);
      },
      (err) => {
        setError(err.message);
        setHasLoaded(true);
      }
    );
    return () => stop();
  }, []);

  const newestFirst = [...rows].reverse().slice(0, 10);

  return (
    <section className="card">
      <h2>History (last {RECORD_COUNT} records)</h2>

      {error && <p className="error">History error: {error}</p>}
      {!hasLoaded && <p className="small">Loading...</p>}
      {hasLoaded && !error && rows.length === 0 && (
        <p className="small">No history records yet.</p>
      )}

      {rows.length > 0 && (
        <>
          <LineChart
            title="Temperature"
            unit="°C"
            rows={rows}
            field="temperature"
          />
          <LineChart
            title="Humidity"
            unit="%"
            rows={rows}
            field="humidity"
          />

          <h3>Latest 10 records</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Temp</th>
                <th>Hum</th>
                <th>Water</th>
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((r) => {
                const t = validNumber(r, "temperature");
                const h = validNumber(r, "humidity");
                return (
                  <tr key={r.id}>
                    <td>{formatTime(r.recordedAt)}</td>
                    <td>{t !== null ? `${t.toFixed(1)} °C` : NO_DATA}</td>
                    <td>{h !== null ? `${h.toFixed(1)} %` : NO_DATA}</td>
                    <td>{r.waterLevel || NO_DATA}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}