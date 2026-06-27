(function (global) {
  "use strict";

  const DATABASE_NAME = "focusline-library";
  const DATABASE_VERSION = 1;
  const BOOK_STORE = "books";
  let databasePromise = null;

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error || new Error("저장소 요청에 실패했습니다.")), {
        once: true,
      });
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error || new Error("저장 작업이 중단됐습니다.")), {
        once: true,
      });
      transaction.addEventListener("error", () => reject(transaction.error || new Error("저장 작업에 실패했습니다.")), {
        once: true,
      });
    });
  }

  function openBookDatabase() {
    if (databasePromise) return databasePromise;
    if (!("indexedDB" in global)) {
      return Promise.reject(new Error("이 브라우저는 책 저장소를 지원하지 않습니다."));
    }

    databasePromise = new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BOOK_STORE)) {
          const store = database.createObjectStore(BOOK_STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      });
      request.addEventListener("success", () => {
        const database = request.result;
        database.addEventListener("versionchange", () => database.close());
        resolve(database);
      }, { once: true });
      request.addEventListener("error", () => {
        databasePromise = null;
        reject(request.error || new Error("책 저장소를 열지 못했습니다."));
      }, { once: true });
      request.addEventListener("blocked", () => {
        databasePromise = null;
        reject(new Error("다른 탭에서 저장소를 사용 중입니다. 다른 탭을 닫고 다시 시도해 주세요."));
      }, { once: true });
    });

    return databasePromise;
  }

  async function runTransaction(mode, work) {
    const database = await openBookDatabase();
    const transaction = database.transaction(BOOK_STORE, mode);
    const completed = transactionDone(transaction);
    const result = await work(transaction.objectStore(BOOK_STORE));
    await completed;
    return result;
  }

  function createBookId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return `book-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeBook(book) {
    const now = Date.now();
    return {
      id: typeof book.id === "string" && book.id ? book.id : createBookId(),
      title: String(book.title || "제목 없는 책").trim() || "제목 없는 책",
      content: String(book.content || ""),
      createdAt: Number(book.createdAt) || now,
      updatedAt: Number(book.updatedAt) || now,
      lastReadAt: Number(book.lastReadAt) || 0,
      lastReadIndex: Math.max(0, Math.round(Number(book.lastReadIndex) || 0)),
      wordCount: Math.max(0, Math.round(Number(book.wordCount) || 0)),
      completed: Boolean(book.completed),
    };
  }

  async function listBooks() {
    const books = await runTransaction("readonly", (store) => requestResult(store.getAll()));
    return books.sort((left, right) => {
      const leftTime = left.lastReadAt || left.updatedAt || 0;
      const rightTime = right.lastReadAt || right.updatedAt || 0;
      return rightTime - leftTime;
    });
  }

  async function getBook(id) {
    if (!id) return null;
    const book = await runTransaction("readonly", (store) => requestResult(store.get(id)));
    return book || null;
  }

  async function saveBook(book) {
    const record = normalizeBook(book);
    await runTransaction("readwrite", (store) => requestResult(store.put(record)));
    return record;
  }

  async function updateProgress(id, lastReadIndex, wordCount, completed = false) {
    if (!id) return null;
    return runTransaction("readwrite", async (store) => {
      const book = await requestResult(store.get(id));
      if (!book) return null;
      const next = normalizeBook({
        ...book,
        lastReadAt: Date.now(),
        lastReadIndex,
        wordCount,
        completed,
      });
      await requestResult(store.put(next));
      return next;
    });
  }

  async function deleteBook(id) {
    if (!id) return;
    await runTransaction("readwrite", (store) => requestResult(store.delete(id)));
  }

  global.FocuslineLibrary = Object.freeze({
    deleteBook,
    getBook,
    listBooks,
    saveBook,
    updateProgress,
  });
})(window);
