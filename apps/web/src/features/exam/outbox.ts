import type {
  AnswerItem,
  ParticipantSessionView,
  RuntimeAnswer,
  RuntimeQuestionManifest,
  RuntimeSession,
} from "../participant/types";

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly session: RuntimeSession;
  readonly manifest: readonly RuntimeQuestionManifest[];
  readonly answers: readonly RuntimeAnswer[];
  readonly serverOffsetMs: number;
  readonly savedAt: number;
}

export interface OutboxEntry extends AnswerItem {
  readonly id: string;
  readonly sessionId: string;
  readonly queuedAt: number;
}

interface StorageAdapter {
  getSnapshot(sessionId: string): Promise<SessionSnapshot | null>;
  putSnapshot(snapshot: SessionSnapshot): Promise<void>;
  deleteSnapshot(sessionId: string): Promise<void>;
  listOutbox(sessionId: string): Promise<readonly OutboxEntry[]>;
  putOutbox(entry: OutboxEntry): Promise<void>;
  deleteOutbox(id: string): Promise<void>;
  clearOutbox(sessionId: string): Promise<void>;
  clearAll(): Promise<void>;
}

const DB_NAME = "gezycbt-participant-runtime";
const DB_VERSION = 1;
const memoryStorage = createMemoryOutbox();
const hasIndexedDb = typeof indexedDB !== "undefined";

/** IndexedDB persistence for answers only; auth/practice credentials never enter this store. */
export const participantOutbox: StorageAdapter = {
  getSnapshot: (sessionId) =>
    hasIndexedDb
      ? withIndexedDb((db) => requestValue(db, "snapshots", sessionId))
      : memoryStorage.getSnapshot(sessionId),
  putSnapshot: (snapshot) =>
    hasIndexedDb
      ? withIndexedDb((db) => requestPut(db, "snapshots", snapshot))
      : memoryStorage.putSnapshot(snapshot),
  deleteSnapshot: (sessionId) =>
    hasIndexedDb
      ? withIndexedDb((db) => requestDelete(db, "snapshots", sessionId))
      : memoryStorage.deleteSnapshot(sessionId),
  listOutbox: (sessionId) =>
    hasIndexedDb
      ? withIndexedDb(async (db) => {
          const all = await requestAll<OutboxEntry>(db, "outbox");
          return all
            .filter((entry) => entry.sessionId === sessionId)
            .sort((a, b) => a.queuedAt - b.queuedAt);
        })
      : memoryStorage.listOutbox(sessionId),
  putOutbox: (entry) =>
    hasIndexedDb
      ? withIndexedDb((db) => requestPut(db, "outbox", entry))
      : memoryStorage.putOutbox(entry),
  deleteOutbox: (id) =>
    hasIndexedDb
      ? withIndexedDb((db) => requestDelete(db, "outbox", id))
      : memoryStorage.deleteOutbox(id),
  clearOutbox: (sessionId) =>
    hasIndexedDb
      ? withIndexedDb(async (db) => {
          const all = await requestAll<OutboxEntry>(db, "outbox");
          await Promise.all(
            all
              .filter((entry) => entry.sessionId === sessionId)
              .map((entry) => requestDelete(db, "outbox", entry.id)),
          );
        })
      : memoryStorage.clearOutbox(sessionId),
  clearAll: () =>
    hasIndexedDb
      ? withIndexedDb(async (db) => {
          await Promise.all([
            requestClear(db, "snapshots"),
            requestClear(db, "outbox"),
          ]);
        })
      : memoryStorage.clearAll(),
};

export function createMemoryOutbox(): StorageAdapter {
  const snapshots = new Map<string, SessionSnapshot>();
  const outbox = new Map<string, OutboxEntry>();
  return {
    async getSnapshot(sessionId) {
      return snapshots.get(sessionId) ?? null;
    },
    async putSnapshot(snapshot) {
      snapshots.set(snapshot.sessionId, snapshot);
    },
    async deleteSnapshot(sessionId) {
      snapshots.delete(sessionId);
    },
    async listOutbox(sessionId) {
      return [...outbox.values()]
        .filter((entry) => entry.sessionId === sessionId)
        .sort((a, b) => a.queuedAt - b.queuedAt);
    },
    async putOutbox(entry) {
      outbox.set(entry.id, entry);
    },
    async deleteOutbox(id) {
      outbox.delete(id);
    },
    async clearOutbox(sessionId) {
      for (const [id, entry] of outbox)
        if (entry.sessionId === sessionId) outbox.delete(id);
    },
    async clearAll() {
      snapshots.clear();
      outbox.clear();
    },
  };
}

export function snapshotFromSession(
  view: ParticipantSessionView,
  serverOffsetMs: number,
): SessionSnapshot {
  return {
    sessionId: view.session.id,
    session: view.session,
    manifest: view.manifest,
    answers: view.answers,
    serverOffsetMs,
    savedAt: Date.now(),
  };
}

async function withIndexedDb<T>(
  operation: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB error"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("snapshots"))
        db.createObjectStore("snapshots", { keyPath: "sessionId" });
      if (!db.objectStoreNames.contains("outbox"))
        db.createObjectStore("outbox", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestValue<T>(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(store, "readonly")
      .objectStore(store)
      .get(key);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB read failed"));
    request.onsuccess = () =>
      resolve((request.result as T | undefined) ?? null);
  });
}

function requestAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(store, "readonly")
      .objectStore(store)
      .getAll();
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB read failed"));
    request.onsuccess = () => resolve(request.result as T[]);
  });
}

function requestPut(
  db: IDBDatabase,
  store: string,
  value: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(store, "readwrite")
      .objectStore(store)
      .put(value);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB write failed"));
    request.onsuccess = () => resolve();
  });
}

function requestDelete(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(store, "readwrite")
      .objectStore(store)
      .delete(key);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB delete failed"));
    request.onsuccess = () => resolve();
  });
}

function requestClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(store, "readwrite")
      .objectStore(store)
      .clear();
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB clear failed"));
    request.onsuccess = () => resolve();
  });
}
