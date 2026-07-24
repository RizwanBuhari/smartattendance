// @ts-nocheck
// Minimal in-memory stand-in for firebase-admin/firestore, good enough to run
// the offsite approval + QR verification services without a real database.
// Supports: collection().doc(id).get()/update()/set(), collection().add(),
// and chained where('field','==',value).limit(n).get().
//
// Not a general Firestore emulator — it implements only the operators these
// services actually use ('==').

let autoId = 0;

class DocRef {
  constructor(store, name, id) {
    this._store = store;
    this._name = name;
    this.id = id;
  }
  _col() {
    return this._store._col(this._name);
  }
  get() {
    const col = this._col();
    const exists = col.has(this.id);
    const raw = col.get(this.id);
    return Promise.resolve({
      exists,
      id: this.id,
      ref: this,
      data: () => (raw ? { ...raw } : undefined),
    });
  }
  update(partial) {
    const col = this._col();
    if (!col.has(this.id)) {
      return Promise.reject(new Error(`No document to update: ${this._name}/${this.id}`));
    }
    col.set(this.id, { ...col.get(this.id), ...partial });
    return Promise.resolve();
  }
  set(data) {
    this._col().set(this.id, { ...data });
    return Promise.resolve();
  }
}

class Query {
  constructor(store, name, filters = [], limitN = null) {
    this._store = store;
    this._name = name;
    this._filters = filters;
    this._limit = limitN;
  }
  where(field, op, value) {
    return new Query(this._store, this._name, [...this._filters, { field, op, value }], this._limit);
  }
  limit(n) {
    return new Query(this._store, this._name, this._filters, n);
  }
  get() {
    const col = this._store._col(this._name);
    let rows = [...col.entries()].filter(([, doc]) =>
      this._filters.every((f) => {
        if (f.op === '==') return doc[f.field] === f.value;
        if (f.op === 'array-contains') return Array.isArray(doc[f.field]) && doc[f.field].includes(f.value);
        throw new Error(`Fake Firestore: unsupported operator ${f.op}`);
      }),
    );
    if (this._limit != null) rows = rows.slice(0, this._limit);
    const docs = rows.map(([id, doc]) => ({
      id,
      ref: new DocRef(this._store, this._name, id),
      data: () => ({ ...doc }),
    }));
    return Promise.resolve({ empty: docs.length === 0, size: docs.length, docs });
  }
}

class Collection {
  constructor(store, name) {
    this._store = store;
    this._name = name;
  }
  doc(id) {
    return new DocRef(this._store, this._name, id ?? `auto_${++autoId}`);
  }
  add(data) {
    const id = `auto_${++autoId}`;
    this._store._col(this._name).set(id, { ...data });
    return Promise.resolve(new DocRef(this._store, this._name, id));
  }
  where(field, op, value) {
    return new Query(this._store, this._name, [{ field, op, value }]);
  }
  get() {
    return new Query(this._store, this._name).get();
  }
}

class FakeFirestore {
  constructor() {
    this._data = new Map();
  }
  _col(name) {
    if (!this._data.has(name)) this._data.set(name, new Map());
    return this._data.get(name);
  }
  collection(name) {
    return new Collection(this, name);
  }
  // Test helpers -------------------------------------------------------------
  seed(name, id, doc) {
    this._col(name).set(id, { ...doc });
  }
  read(name, id) {
    return this._col(name).get(id);
  }
  all(name) {
    return [...this._col(name).entries()].map(([id, doc]) => ({ id, ...doc }));
  }
  reset() {
    this._data.clear();
    autoId = 0;
  }
}

// One shared instance so services (which call getFirestore() at construction)
// and the test (which seeds/reads) see the same store.
export const db = new FakeFirestore();
export const firestoreMock = { getFirestore: () => db };
