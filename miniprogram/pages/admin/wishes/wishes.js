const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const { fmtDateTime, wishStatusText } = require('../../../utils/format')
const db = wx.cloud.database()

Page({
  data: { wishes: [] },
  async onShow() { if (await guard()) this.load() },
  async load() {
    const r = await db.collection('wishes').orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ data: [] }))
    this.setData({
      wishes: r.data.map((w) => ({ ...w, statusText: wishStatusText(w.status), timeText: fmtDateTime(w.createdAt) })),
    })
  },
  async reply(e) {
    const { id, status } = e.currentTarget.dataset
    const res = await new Promise((resolve) => wx.showModal({
      title: status === 'accepted' ? '安排上！' : '下次一定',
      editable: true, placeholderText: '想回一句什么？（可留空）',
      success: (r) => resolve(r),
    }))
    if (!res.confirm) return
    const d = await callWithToast('adminOp', { op: 'wishReply', wishId: id, status, reply: res.content || '' }).catch(() => null)
    if (d !== null) this.load()
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
})
