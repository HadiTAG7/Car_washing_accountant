// Firestore's Timestamp, as the Admin SDK shapes it: own `_seconds` /
// `_nanoseconds` (so JSON.stringify matches), `seconds` / `nanoseconds`
// getters, toDate/toMillis/isEqual/valueOf.
export class Timestamp {
  constructor(seconds, nanoseconds) {
    if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999999999) {
      throw new Error(`Invalid Timestamp(${seconds}, ${nanoseconds})`);
    }
    this._seconds = seconds;
    this._nanoseconds = nanoseconds;
  }
  static now() { return Timestamp.fromMillis(Date.now()); }
  static fromDate(date) { return Timestamp.fromMillis(date.getTime()); }
  static fromMillis(ms) {
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(seconds, Math.round((ms - seconds * 1000) * 1e6));
  }
  get seconds() { return this._seconds; }
  get nanoseconds() { return this._nanoseconds; }
  toDate() { return new Date(this.toMillis()); }
  toMillis() { return this._seconds * 1000 + Math.floor(this._nanoseconds / 1e6); }
  isEqual(other) { return other instanceof Timestamp && other._seconds === this._seconds && other._nanoseconds === this._nanoseconds; }
  valueOf() { return `${String(this._seconds + 62135596800).padStart(12, '0')}.${String(this._nanoseconds).padStart(9, '0')}`; }
  toString() { return `Timestamp(seconds=${this._seconds}, nanoseconds=${this._nanoseconds})`; }
}
export const makeTimestamp = (s, n) => new Timestamp(s, n);
