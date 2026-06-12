// 把 wx-server-sdk 的 database 包装成 actions 使用的注入接口（与 tests/fakeDb.js 同构）
module.exports = function makeDb(db) {
  const _ = db.command
  return {
    inc: (n) => _.inc(n),
    async getDoc(coll, id) {
      try { const r = await db.collection(coll).doc(id).get(); return r.data || null }
      catch (e) { return null }
    },
    async findOne(coll, query) {
      const r = await db.collection(coll).where(query).limit(1).get()
      return r.data[0] || null
    },
    async find(coll, query = {}) {
      const r = await db.collection(coll).where(query).limit(1000).get()
      return r.data
    },
    async insert(coll, data) { const r = await db.collection(coll).add({ data }); return r._id },
    async insertWithId(coll, id, data) {
      try { await db.collection(coll).add({ data: { _id: id, ...data } }); return true }
      catch (e) { return false }
    },
    async setDoc(coll, id, data) { await db.collection(coll).doc(id).set({ data }) },
    async updateDoc(coll, id, data) { await db.collection(coll).doc(id).update({ data }) },
    async removeDoc(coll, id) { await db.collection(coll).doc(id).remove() },
    async removeWhere(coll, query) { await db.collection(coll).where(query).remove() },
    async count(coll, query = {}) { const r = await db.collection(coll).where(query).count(); return r.total },
  }
}
