const { fmtDateTime, eventStatusText } = require('../../utils/format')
const db = wx.cloud.database()

Page({
  data: { events: [] },
  onShow() { this.load() },
  async load() {
    const r = await db.collection('events').orderBy('mealTime', 'desc').limit(50).get().catch(() => ({ data: [] }))
    const now = Date.now()
    this.setData({
      events: r.data.map((e) => ({
        ...e,
        mealText: fmtDateTime(e.mealTime),
        deadlineText: fmtDateTime(e.deadline),
        statusText: eventStatusText(e, now),
        isOpen: e.status === 'open' && e.deadline > now,
      })),
    })
  },
  go(e) { wx.navigateTo({ url: '/pages/event-detail/event-detail?id=' + e.currentTarget.dataset.id }) },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
})
