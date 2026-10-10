const DB_NAME = 'uyym-browser-identity';
const STORE = 'identity';
const KEY = 'p256-v1';
type Identity = { privateKey: CryptoKey; publicKey: CryptoKey };
let pending: Promise<Identity> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser key storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other UYYM tabs to update browser storage.'));
  });
}

function transaction<T>(database: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(new Error('Browser key storage is unavailable.'));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new Error('Browser key storage is unavailable.'));
    tx.onabort = () => reject(new Error('Browser key storage is unavailable.'));
  });
}

async function createOrLoad(): Promise<Identity> {
  if (!window.isSecureContext || !window.crypto?.subtle || !window.indexedDB) {
    throw new Error('Бұл браузер қауіпсіз кілтті қолдамайды. HTTPS арқылы Chrome, Edge немесе Safari қолданыңыз.');
  }
  const database = await openDatabase();
  try {
    const existing = await transaction<Identity | undefined>(database, 'readonly', store => store.get(KEY));
    if (existing) {
      if (existing.privateKey.extractable) throw new Error('Browser key security check failed.');
      return existing;
    }
    const generated = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as CryptoKeyPair;
    const identity = { privateKey: generated.privateKey, publicKey: generated.publicKey };
    // add() is atomic across tabs; a second tab must use the winning persisted identity.
    try { await transaction(database, 'readwrite', store => store.add(identity, KEY)); }
    catch {
      const winner = await transaction<Identity | undefined>(database, 'readonly', store => store.get(KEY));
      if (!winner) throw new Error('Cannot persist browser identity. Private browsing may be unsupported.');
      return winner;
    }
    return identity;
  } finally { database.close(); }
}

export function browserIdentity(): Promise<Identity> {
  pending ??= createOrLoad().catch(error => { pending = undefined; throw error; });
  return pending;
}

export async function publicBrowserKey(): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', (await browserIdentity()).publicKey);
}

export function toBase64url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function signChallenge(payload: string | Record<string, unknown>): Promise<string> {
  const identity = await browserIdentity();
  const encoded = new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, encoded);
  return toBase64url(signature);
}

export async function hashBody(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function browserLabel(): string {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
  const platform = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Mac/.test(agent) ? 'macOS' : 'Computer';
  return `${browser} · ${platform}`;
}
