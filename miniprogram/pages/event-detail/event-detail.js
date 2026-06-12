const { fmtDateTime, eventStatusText } = require('../../utils/format')
const db = wx.cloud.database()

Page({
  data: { ev: null, statusText: '', isOpen: false, people: [], summary: [] },
  onLoad(q) { this.id = q.id },
  onShow() { this.load() },
  async load() {
    try {
      const [evRes, odRes] = await Promise.all([
        db.collection('events').doc(this.id).get(),
        db.collection('orders').where({ eventId: this.id }).orderBy('createdAt', 'asc').limit(100).get(),
      ])
      const ev = evRes.data
      const now = Date.now()
      const orders = odRes.data.filter((o) => o.status !== 'declined')
      const byPerson = new Map()
      const agg = new Map()
      for (const o of orders) {
        if (!byPerson.has(o.openid)) {
          byPerson.set(o.openid, { openid: o.openid, nickname: o.nickname, avatar: o.avatar, items: [], notes: [], extra: 0 })
        }
        const p = byPerson.get(o.openid)
        p.items.push(...o.items)
        if (o.orderNote) p.notes.push(o.orderNote)
        p.extra = Math.max(p.extra, (o.headcount || 1) - 1)
        for (const it of o.items) agg.set(it.name, (agg.get(it.name) || 0) + it.qty)
      }
      this.setData({
        ev: { ...ev, mealText: fmtDateTime(ev.mealTime), deadlineText: fmtDateTime(ev.deadline) },
        statusText: eventStatusText(ev, now),
        isOpen: ev.status === 'open' && ev.deadline > now,
        people: [...byPerson.values()],
        summary: [...agg.entries()].map(([name, qty]) => ({ name, qty })),
      })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },
  goOrder() { wx.switchTab({ url: '/pages/menu/menu' }) },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
})
