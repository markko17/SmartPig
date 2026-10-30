import { useEffect, useState } from "react";
import {
  subscribeToReadings,
  subscribeToConnection,
  subscribeToServerOffset,
} from "./dataService";
import History from "./History";
import "./App.css";

// The ESP32 writes every 5 s. Three missed writes = Offline.
const OFFLINE_AFTER_MS = 15000;
const NO_DATA = "No data";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Server time -> "October 30, 2026, 3:09:42 AM" (Philippine time)
function formatManila(ms) {
  const date = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ms));

  const time = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(ms));

  return `${date}, ${time}`;
}

// RTC text ("2026-10-30", "15:08:59") -> { date: "October 30, 2026", time: "3:08:59 PM" }
// Uses the RTC's own numbers directly, with no timezone conversion.
function formatRtc(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(timeStr || "");
  if (!d || !t) return null;

  const year = Number(d[1]);
  const month = Number(d[2]);
  const day = Number(d[3]);
  const hour = Number(t[1]);
  const minute = t[2];
  const second = t[3];

  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    hour > 23 || Number(minute) > 59 || Number(second) > 59
  ) {
    return null;
  }

  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  return {
    date: `${MONTHS[month - 1]} ${day}, ${year}`,
    time: `${hour12}:${minute}:${second} ${suffix}`,
  };
}

function floatState(value) {
  if (value === true) return "Closed";
  if (value === false) return "Open";
  return NO_DATA;
}

export default function App() {
  const [data, setData] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [readError, setReadError] = useState(null);
  const [dbConnected, setDbConnected] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const stopReadings = subscribeToReadings(
      (value) => {
        setData(value);
        setReadError(null);
        setHasLoaded(true);
      },
      (error) => {
        setReadError(error.message);
        setHasLoaded(true);
      }
    );
    const stopConnection = subscribeToConnection(setDbConnected);
    const stopOffset = subscribeToServerOffset(setServerOffset);
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      stopReadings();
      stopConnection();
      stopOffset();
      clearInterval(timer);
    };
  }, []);

  // Use the server-corrected time so a wrong phone clock can't fake "Connected"
  const serverNow = now + serverOffset;
  const lastUpdated =
    data && typeof data.lastUpdated === "number" ? data.lastUpdated : null;
  const ageMs = lastUpdated !== null ? serverNow - lastUpdated : null;

  let deviceStatus;
  if (readError) deviceStatus = "Database Error";
  else if (!hasLoaded) deviceStatus = "Loading...";
  else if (lastUpdated === null) deviceStatus = NO_DATA;
  else if (ageMs > OFFLINE_AFTER_MS) deviceStatus = "Offline";
  else deviceStatus = "Connected";

  const isStale = deviceStatus === "Offline";

  const temperature =
    data && typeof data.temperature === "number"
      ? `${data.temperature.toFixed(1)} °C`
      : NO_DATA;
  const humidity =
    data && typeof data.humidity === "number"
      ? `${data.humidity.toFixed(1)} %`
      : NO_DATA;

  const water = data && data.waterLevel ? data.waterLevel : NO_DATA;

  const rtc =
    data && data.rtcValid === true
      ? formatRtc(data.rtcDate, data.rtcTime)
      : null;

  return (
    <main className="app">
      <h1>PROJECT SMARTPIG</h1>

      <section className="card">
        <h2>Device</h2>
        <p className={`status ${deviceStatus.replace(/\W+/g, "-")}`}>
          {deviceStatus}
        </p>
        <p className="small">
          Last successful update:{" "}
          {lastUpdated !== null ? formatManila(lastUpdated) : NO_DATA}
        </p>
        {ageMs !== null && (
          <p className="small">
            {Math.max(0, Math.round(ageMs / 1000))} seconds ago
          </p>
        )}
        <p className="small">
          Firebase link: {dbConnected ? "Connected" : "Disconnected"}
        </p>
        {readError && <p className="error">Read error: {readError}</p>}
        {isStale && (
          <p className="error">Data below is old. The device may be offline.</p>
        )}
      </section>

      <section className={`card ${isStale ? "stale" : ""}`}>
        <h2>Environment</h2>
        <p>Temperature: <strong>{temperature}</strong></p>
        <p>Humidity: <strong>{humidity}</strong></p>
      </section>

      <section className={`card ${isStale ? "stale" : ""}`}>
        <h2>Water Level</h2>
        <p className="big">{water}</p>
        <p className="small">Top float: {floatState(data && data.waterTop)}</p>
        <p className="small">Middle float: {floatState(data && data.waterMiddle)}</p>
        <p className="small">Bottom float: {floatState(data && data.waterBottom)}</p>
      </section>

      <section className={`card ${isStale ? "stale" : ""}`}>
        <h2>RTC Date and Time</h2>
        {rtc ? (
          <>
            <p className="big">{rtc.time}</p>
            <p><strong>{rtc.date}</strong></p>
          </>
        ) : (
          <p>
            <strong>{NO_DATA}</strong>
            <span className="small"> (RTC not valid or not sent)</span>
          </p>
        )}
      </section>

      <section className="card">
        <h2>Hopper and Tray</h2>
        <p>Hopper weight: <strong>Pending Setup</strong></p>
        <p>Tray weight: <strong>Pending Setup</strong></p>
      </section>

      <History />
    </main>
  );
}