function makeFakeDb(seed = {}) {
  const colls = new Map(Object.entries(seed).map(([k, docs]) => [k, new Map(docs.map((d) => [d._id, { ...d }]))]))
  let autoId = 0
  const coll = (name) => { if (!colls.has(name)) colls.set(name, new Map()); return colls.get(name) }
  const matches = (doc, query) => Object.entries(query).every(([k, v]) => doc[k] === v)
  const applyData = (doc, data) => {
    for (const [k, v] of Object.entries(data)) doc[k] = v && typeof v === 'object' && v.__inc !== undefined ? (doc[k] || 0) + v.__inc : v
  }
  return {
    inc: (n) => ({ __inc: n }),
    async getDoc(c, id) { const d = coll(c).get(id); return d ? { ...d } : null },
    async findOne(c, q) { for (const d of coll(c).values()) if (matches(d, q)) return { ...d }; return null },
    async find(c, q = {}) { return [...coll(c).values()].filter((d) => matches(d, q)).map((d) => ({ ...d })) },
    async insert(c, data) { const id = 'id' + ++autoId; coll(c).set(id, { _id: id, ...data }); return id },
    async insertWithId(c, id, data) { if (coll(c).has(id)) return false; coll(c).set(id, { _id: id, ...data }); return true },
    async setDoc(c, id, data) { coll(c).set(id, { _id: id, ...data }) },
    async updateDoc(c, id, data) { const d = coll(c).get(id); if (d) applyData(d, data) },
    async removeDoc(c, id) { coll(c).delete(id) },
    async removeWhere(c, q) { for (const [id, d] of [...coll(c)]) if (matches(d, q)) coll(c).delete(id) },
    async count(c, q = {}) { return (await this.find(c, q)).length },
  }
}
module.exports = { makeFakeDb }
