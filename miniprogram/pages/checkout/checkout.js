const { call, toast } = require('../../utils/api')
const cart = require('../../utils/cart')
const { fmtDateTime } = require('../../utils/format')
const db = wx.cloud.database()

const SLOTS = [{ label: '午餐 12:00', hour: 12 }, { label: '晚餐 18:00', hour: 18 }]
const DAY = 86400000

Page({
  data: {
    items: [], openEvent: null, forEvent: false,
    dateOptions: [], dateIndex: 0, slots: SLOTS.map((s) => s.label), slotIndex: 1,
    headcount: 1, orderNote: '', submitting: false, profileVisible: false,
  },
  async onLoad() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const names = ['今天', '明天', '后天']
    const dateOptions = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() + i * DAY)
      dateOptions.push({ ts: d.getTime(), label: `${names[i] ? names[i] + ' ' : ''}${d.getMonth() + 1}/${d.getDate()}` })
    }
    this.setData({ items: cart.getCart(), dateOptions })
    const r = await db.collection('events').where({ status: 'open' }).limit(10).get().catch(() => ({ data: [] }))
    const open = r.data.find((e) => e.deadline > Date.now()) || null
    if (open) this.setData({ openEvent: { ...open, mealText: fmtDateTime(open.mealTime) }, forEvent: true })
  },
  onMode(e) { this.setData({ forEvent: e.currentTarget.dataset.mode === 'event' }) },
  onDate(e) { this.setData({ dateIndex: Number(e.detail.value) }) },
  onSlot(e) { this.setData({ slotIndex: Number(e.detail.value) }) },
  onHeadcount(e) { this.setData({ headcount: e.detail.value }) },
  onNote(e) { this.setData({ orderNote: e.detail.value }) },
  ensureProfile() {
    if (wx.getStorageSync('profile')) return true
    this.setData({ profileVisible: true })
    return false
  },
  onProfileClose() { this.setData({ profileVisible: false }) },
  onProfileSaved() {
    if (this._pendingSubmit) { this._pendingSubmit = false; this.submit() }
  },
  async submit() {
    if (!this.ensureProfile()) { this._pendingSubmit = true; return }
    const { items, forEvent, openEvent, dateOptions, dateIndex, slotIndex, headcount, orderNote } = this.data
    if (!items.length) return toast('购物车是空的')
    const payload = {
      items: items.map((i) => ({ dishId: i.dishId, qty: i.qty, note: i.note || '' })),
      orderNote, headcount,
    }
    if (forEvent && openEvent) payload.eventId = openEvent._id
    else payload.mealTime = dateOptions[dateIndex].ts + SLOTS[slotIndex].hour * 3600000
    this.setData({ submitting: true })
    try {
      await call('submitOrder', payload)
      cart.clearCart()
      wx.showModal({
        title: '下单成功', content: '主厨已收到你的菜单 🍳', showCancel: false,
        success: () => wx.switchTab({ url: '/pages/mine/mine' }),
      })
    } catch (e) {
      toast(e.message || '下单失败')
    } finally {
      this.setData({ submitting: false })
    }
  },
})
