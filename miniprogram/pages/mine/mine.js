const { callWithToast, toast } = require('../../utils/api')
const { fmtDateTime, orderStatusText, orderStatusTheme, wishStatusText } = require('../../utils/format')
const db = wx.cloud.database()

Page({
  data: {
    profile: null, orders: [], wishes: [],
    isAdmin: false, claimed: true, newCount: 0,
    profileVisible: false, wishVisible: false, wishText: '',
  },
  async onShow() {
    this.setData({ profile: wx.getStorageSync('profile') || null })
    const app = getApp()
    const who = await app.whoamiReady
    const isAdmin = app.globalData.isAdmin || who.isAdmin
    this.setData({ isAdmin, claimed: who.claimed !== false })
    if (who.openid) await this.loadMine(who.openid)
    if (isAdmin) await this.loadBadge()
  },
  async loadMine(openid) {
    const [od, ws] = await Promise.all([
      db.collection('orders').where({ openid }).orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ data: [] })),
      db.collection('wishes').where({ openid }).orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ data: [] })),
    ])
    this.setData({
      orders: od.data.map((o) => ({
        ...o,
        title: o.eventId ? '🍲 ' + o.eventTitle : '📅 ' + fmtDateTime(o.mealTime),
        itemsText: (o.items || []).map((i) => i.name + '×' + i.qty).join('、'),
        statusText: orderStatusText(o.status),
        statusTheme: orderStatusTheme(o.status),
      })),
      wishes: ws.data.map((w) => ({ ...w, statusText: wishStatusText(w.status) })),
    })
  },
  async loadBadge() {
    const r = await db.collection('orders').where({ status: 'new' }).count().catch(() => ({ total: 0 }))
    this.setData({ newCount: r.total })
  },
  editProfile() { this.setData({ profileVisible: true }) },
  onProfileClose() { this.setData({ profileVisible: false, profile: wx.getStorageSync('profile') || null }) },
  openWish() {
    if (!wx.getStorageSync('profile')) {
      this._pendingWish = true
      return this.setData({ profileVisible: true })
    }
    this.setData({ wishVisible: true })
  },
  onProfileSaved() {
    if (this._pendingWish) { this._pendingWish = false; this.setData({ wishVisible: true }) }
  },
  onWishVisible(e) { if (!e.detail.visible) this.setData({ wishVisible: false }) },
  onWishText(e) { this.setData({ wishText: e.detail.value }) },
  async sendWish() {
    const text = this.data.wishText.trim()
    if (!text) return toast('想吃什么写一句吧')
    const d = await callWithToast('submitWish', { text }).catch(() => null)
    if (d === null) return
    this.setData({ wishVisible: false, wishText: '' })
    toast('愿望已送达 🌠', 'success')
    const who = await getApp().whoamiReady
    if (who.openid) this.loadMine(who.openid)
  },
  async claim() {
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: '认领主厨之位',
      content: '只有第一个认领的人会成为主厨，确定是你吗？',
      success: (r) => resolve(r.confirm),
    }))
    if (!confirmed) return
    const d = await callWithToast('claimAdmin', {}).catch(() => null)
    if (d === null) return
    getApp().globalData.isAdmin = true
    this.setData({ isAdmin: true, claimed: true })
    toast('你已是主厨 👨‍🍳', 'success')
  },
  goAdmin() { wx.navigateTo({ url: '/pages/admin/index/index' }) },
  onPullDownRefresh() { this.onShow().finally(() => wx.stopPullDownRefresh()) },
})
