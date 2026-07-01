// Test environment shims. The wallet lib targets the browser; under Node's test
// runner we provide the few Web APIs it touches at call time.

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var localStorage: Storage;
}

if (!(globalThis as { localStorage?: unknown }).localStorage) {
  (globalThis as { localStorage: unknown }).localStorage = new MemoryStorage();
}

/** Reset wallet persistence between tests. */
export function resetStorage() {
  (globalThis as { localStorage: unknown }).localStorage = new MemoryStorage();
}
