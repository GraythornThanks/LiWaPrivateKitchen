const guard = require('../../../utils/guard')
const db = wx.cloud.database()

Page({
  data: { newOrders: 0, dishCount: 0, openEvents: 0, newWishes: 0 },
  async onShow() {
    if (!(await guard())) return
    const c = (coll, q) => {
      let col = db.collection(coll)
      if (q) col = col.where(q)
      return col.count().then((r) => r.total).catch(() => 0)
    }
    const [newOrders, dishCount, openEvents, newWishes] = await Promise.all([
      c('orders', { status: 'new' }), c('dishes', null), c('events', { status: 'open' }), c('wishes', { status: 'new' }),
    ])
    this.setData({ newOrders, dishCount, openEvents, newWishes })
  },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
})
