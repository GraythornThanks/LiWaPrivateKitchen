const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const db = wx.cloud.database()

Page({
  data: { dishes: [] },
  async onShow() { if (await guard()) this.load() },
  async load() {
    const r = await db.collection('dishes').orderBy('sort', 'asc').limit(100).get().catch(() => ({ data: [] }))
    this.setData({ dishes: r.data })
  },
  add() { wx.navigateTo({ url: '/pages/admin/dish-edit/dish-edit' }) },
  edit(e) { wx.navigateTo({ url: '/pages/admin/dish-edit/dish-edit?id=' + e.currentTarget.dataset.id }) },
  async toggle(e) {
    const { id, status } = e.currentTarget.dataset
    const d = await callWithToast('adminOp', {
      op: 'dishUpdate', dishId: id, patch: { status: status === 'on' ? 'off' : 'on' },
    }).catch(() => null)
    if (d !== null) this.load()
  },
  async remove(e) {
    const { id, name } = e.currentTarget.dataset
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: '删除「' + name + '」？', content: '历史订单不受影响', success: (r) => resolve(r.confirm),
    }))
    if (!confirmed) return
    const d = await callWithToast('adminOp', { op: 'dishDelete', dishId: id }).catch(() => null)
    if (d !== null) this.load()
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
})
