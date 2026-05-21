"use client";

// IndexedDB cache for centroid sets. The whole point: the centroids never
// change for a given `centroid_set_hash` — they're a content-addressed blob
// on chain — so once we've fetched them once we should never fetch again.
//
// Layout: one DB, one store, one record per centroid_set_hash. Each record
// holds the full row-major Float32 centroid matrix and the per-cell entity
// keys (so the UI's "view bucket on Arkiv" link still works). Stored as
// native typed arrays; structured clone handles the serialization for us.
//
// ~12 MB per record at C=8192, dim=384 (or ~3 MB at C=2048). IndexedDB
// easily handles that and reads it back in a few ms.

const DB_NAME = "arkiv-search";
const STORE = "centroid-sets";
const DB_VERSION = 1;

export interface CachedCentroids {
  centroids: Float32Array;
  centroidKeys: string[];
}

function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("idb open blocked"));
  });
}

export async function loadCentroids(key: string): Promise<CachedCentroids | null> {
  if (!isAvailable()) return null;
  try {
    const db = await openDb();
    return await new Promise<CachedCentroids | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CachedCentroids | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // IDB can be disabled in private windows / fingerprinting-strict modes.
    // Falling back to a network fetch is always safe.
    return null;
  }
}

export async function saveCentroids(key: string, data: CachedCentroids): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort
  }
}
