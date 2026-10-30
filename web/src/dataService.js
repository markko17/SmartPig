import {
  ref,
  onValue,
  query,
  orderByChild,
  limitToLast,
} from "firebase/database";
import { db } from "./firebase";

// Each function returns an "unsubscribe" function for cleanup.

export function subscribeToReadings(onData, onError) {
  return onValue(
    ref(db, "smartpig"),
    (snap) => onData(snap.val()),
    (err) => onError(err)
  );
}

export function subscribeToConnection(onChange) {
  return onValue(ref(db, ".info/connected"), (snap) =>
    onChange(snap.val() === true)
  );
}

// Difference between Firebase's server clock and this device's clock
export function subscribeToServerOffset(onChange) {
  return onValue(ref(db, ".info/serverTimeOffset"), (snap) =>
    onChange(snap.val() || 0)
  );
}

// Last N history records, oldest first
export function subscribeToHistory(count, onData, onError) {
  const q = query(
    ref(db, "smartpigHistory"),
    orderByChild("recordedAt"),
    limitToLast(count)
  );

  return onValue(
    q,
    (snap) => {
      const rows = [];
      snap.forEach((child) => {
        rows.push({ id: child.key, ...child.val() });
      });
      rows.sort((a, b) => a.recordedAt - b.recordedAt);
      onData(rows);
    },
    (err) => onError(err)
  );
}