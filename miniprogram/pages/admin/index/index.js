const guard = require('../../../utils/guard')
const db = wx.cloud.database()

Page({
  data: { newOrders: 0, dishCount: 0, openEvents: 0, newWishes: 0 },
  async onShow() {
    if (!(await guard())) return
    // 客户端 count() 需要 where 条件，_id exists 匹配全部文档
    const _ = db.command
    const c = (coll, q) => db.collection(coll).where(q).count().then((r) => r.total).catch(() => 0)
    const [newOrders, dishCount, openEvents, newWishes] = await Promise.all([
      c('orders', { status: 'new' }), c('dishes', { _id: _.exists(true) }), c('events', { status: 'open' }), c('wishes', { status: 'new' }),
    ])
    this.setData({ newOrders, dishCount, openEvents, newWishes })
  },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
})
