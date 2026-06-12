const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const { fmtDateTime, orderStatusText, orderStatusTheme } = require('../../../utils/format')
const db = wx.cloud.database()

Page({
  data: { orders: [] },
  async onShow() { if (await guard()) this.load() },
  async load() {
    const r = await db.collection('orders').orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ data: [] }))
    this.setData({
      orders: r.data.map((o) => ({
        ...o,
        items: o.items || [],
        timeText: o.eventId ? '🍲 ' + o.eventTitle : '📅 ' + fmtDateTime(o.mealTime),
        createdText: fmtDateTime(o.createdAt),
        statusText: orderStatusText(o.status),
        statusTheme: orderStatusTheme(o.status),
      })),
    })
  },
  async setStatus(e) {
    const { id, status } = e.currentTarget.dataset
    let declineReason = ''
    if (status === 'declined') {
      const res = await new Promise((resolve) => wx.showModal({
        title: '婉拒原因', editable: true, placeholderText: '比如：这周食材买不到啦', success: (r) => resolve(r),
      }))
      if (!res.confirm) return
      declineReason = res.content || ''
    }
    const d = await callWithToast('adminOp', { op: 'orderSetStatus', orderId: id, status, declineReason }).catch(() => null)
    if (d !== null) this.load()
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
})
