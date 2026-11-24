// Formatting helpers — GEN amounts, addresses, and epoch time math.
// All epoch times come from the contract's own config/stats reads; the
// only local input is the viewer's clock for countdowns.

export function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr || "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function sameAddress(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

/** "1.5" -> wei BigInt. Throws on anything that is not a positive amount. */
export function genToWei(gen) {
  const s = String(gen).trim();
  if (!s || Number.isNaN(Number(s)) || Number(s) <= 0) {
    throw new Error("Enter a GEN amount greater than 0.");
  }
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0");
}

/** wei -> trimmed GEN string, up to 6 decimal places. */
export function weiToGen(wei) {
  try {
    const w = BigInt(wei);
    const whole = w / 10n ** 18n;
    const frac = w % 10n ** 18n;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
    return `${whole.toString()}.${fracStr}`;
  } catch {
    return "0";
  }
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** Epoch index containing ts, from the contract's genesis + duration. */
export function epochOf(ts, genesis, duration) {
  if (!duration || duration <= 0) return 0;
  return Math.floor((ts - genesis) / duration);
}

/** "12d 04h 31m" / "04h 31m 09s" / "31m 09s" — for countdowns. */
export function formatDuration(totalSeconds) {
  let s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const p2 = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${p2(h)}h ${p2(m)}m`;
  if (h > 0) return `${p2(h)}h ${p2(m)}m ${p2(sec)}s`;
  return `${p2(m)}m ${p2(sec)}s`;
}

/** Split a duration into d/h/m/s parts for the hero countdown digits. */
export function durationParts(totalSeconds) {
  let s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return { d, h, m, s: sec };
}

/** Unix seconds -> "23 Nov 2026, 14:05 UTC" style label. */
export function formatDateTime(ts) {
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

/** Unix seconds -> value for an <input type="datetime-local"> (local time). */
export function toLocalInputValue(ts) {
  const d = new Date(Number(ts) * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
