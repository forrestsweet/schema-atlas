import type { SchemaModel } from "@/lib/schema-types";

const DATABASE_NAME = "schema-atlas";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const THREAD_STORE = "aiThreads";
const SETTING_STORE = "settings";

export type SchemaDocument = {
  id: string;
  name: string;
  sql: string;
  schema: SchemaModel;
  createdAt: string;
  updatedAt: string;
};

export type StoredAiThread<TMessage = unknown> = {
  archived: boolean;
  createdAt: string;
  id: string;
  messages: TMessage[];
  modelId: string;
  provider: string;
  thinkingLevel: string;
  title?: string;
  updatedAt: string;
  workspacePath: string;
};

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(THREAD_STORE)) {
        database.createObjectStore(THREAD_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SETTING_STORE)) {
        database.createObjectStore(SETTING_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

export async function listSchemaDocuments(): Promise<SchemaDocument[]> {
  const database = await openDatabase();
  try {
    const documents = await requestResult(
      database
        .transaction(DOCUMENT_STORE, "readonly")
        .objectStore(DOCUMENT_STORE)
        .getAll() as IDBRequest<SchemaDocument[]>,
    );
    return documents.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  } finally {
    database.close();
  }
}

export async function saveSchemaDocument(
  document: SchemaDocument,
): Promise<void> {
  const database = await openDatabase();
  try {
    await requestResult(
      database
        .transaction(DOCUMENT_STORE, "readwrite")
        .objectStore(DOCUMENT_STORE)
        .put(document),
    );
  } finally {
    database.close();
  }
}

export async function deleteSchemaDocument(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [DOCUMENT_STORE, THREAD_STORE, SETTING_STORE],
        "readwrite",
      );
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();

      transaction.objectStore(DOCUMENT_STORE).delete(id);

      const threadStore = transaction.objectStore(THREAD_STORE);
      const threadsRequest = threadStore.getAll() as IDBRequest<
        StoredAiThread[]
      >;
      threadsRequest.onsuccess = () => {
        for (const thread of threadsRequest.result) {
          if (thread.workspacePath === id) threadStore.delete(thread.id);
        }
      };

      const settingStore = transaction.objectStore(SETTING_STORE);
      const currentRequest = settingStore.get(
        "currentDocumentId",
      ) as IDBRequest<string | undefined>;
      currentRequest.onsuccess = () => {
        if (currentRequest.result === id) {
          settingStore.delete("currentDocumentId");
        }
      };
    });
  } finally {
    database.close();
  }
}

export async function getCurrentDocumentId(): Promise<string | undefined> {
  const database = await openDatabase();
  try {
    return await requestResult(
      database
        .transaction(SETTING_STORE, "readonly")
        .objectStore(SETTING_STORE)
        .get("currentDocumentId") as IDBRequest<string | undefined>,
    );
  } finally {
    database.close();
  }
}

export async function setCurrentDocumentId(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await requestResult(
      database
        .transaction(SETTING_STORE, "readwrite")
        .objectStore(SETTING_STORE)
        .put(id, "currentDocumentId"),
    );
  } finally {
    database.close();
  }
}

export async function listAiThreads<TMessage>(): Promise<
  StoredAiThread<TMessage>[]
> {
  const database = await openDatabase();
  try {
    return await requestResult(
      database
        .transaction(THREAD_STORE, "readonly")
        .objectStore(THREAD_STORE)
        .getAll() as IDBRequest<StoredAiThread<TMessage>[]>,
    );
  } finally {
    database.close();
  }
}

export async function saveAiThread<TMessage>(
  thread: StoredAiThread<TMessage>,
): Promise<void> {
  const database = await openDatabase();
  try {
    await requestResult(
      database
        .transaction(THREAD_STORE, "readwrite")
        .objectStore(THREAD_STORE)
        .put(thread),
    );
  } finally {
    database.close();
  }
}

export async function deleteAiThread(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await requestResult(
      database
        .transaction(THREAD_STORE, "readwrite")
        .objectStore(THREAD_STORE)
        .delete(id),
    );
  } finally {
    database.close();
  }
}
