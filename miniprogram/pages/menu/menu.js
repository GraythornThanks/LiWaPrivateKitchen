const { callWithToast } = require('../../utils/api')
const cart = require('../../utils/cart')
const { fmtDateTime } = require('../../utils/format')
const db = wx.cloud.database()

Page({
  data: {
    categories: [], curCat: '', dishes: [], shown: [],
    qtyMap: {}, likedMap: {}, count: 0, cartItems: [],
    activeEvent: null, cartVisible: false, profileVisible: false,
  },
  onShow() { this.loadAll() },
  async loadAll() {
    try {
      const [cfgRes, dishRes, evRes] = await Promise.all([
        db.collection('config').doc('main').get().catch(() => null),
        db.collection('dishes').where({ status: 'on' }).orderBy('sort', 'asc').limit(100).get(),
        db.collection('events').where({ status: 'open' }).orderBy('mealTime', 'asc').limit(10).get(),
      ])
      const dishes = dishRes.data
      const cats = (cfgRes && cfgRes.data.categories) || []
      const categories = cats.filter((c) => dishes.some((d) => d.category === c))
      const now = Date.now()
      const active = evRes.data.find((e) => e.deadline > now) || null
      this.setData({
        dishes, categories,
        curCat: categories.includes(this.data.curCat) ? this.data.curCat : (categories[0] || ''),
        activeEvent: active ? { ...active, deadlineText: fmtDateTime(active.deadline) } : null,
      })
      this.applyFilter()
      this.refreshCart()
      this.loadLikes()
    } catch (e) {
      wx.showToast({ title: '加载失败，下拉重试', icon: 'none' })
    }
  },
  async loadLikes() {
    const { openid } = await getApp().whoamiReady
    if (!openid) return
    const r = await db.collection('likes').where({ openid }).limit(1000).get().catch(() => ({ data: [] }))
    const likedMap = {}
    for (const l of r.data) likedMap[l.dishId] = true
    this.setData({ likedMap })
  },
  applyFilter() {
    const { dishes, curCat } = this.data
    this.setData({ shown: curCat ? dishes.filter((d) => d.category === curCat) : dishes })
  },
  onCat(e) { this.setData({ curCat: e.currentTarget.dataset.cat }); this.applyFilter() },
  refreshCart() { this.setData({ qtyMap: cart.qtyMap(), count: cart.cartCount(), cartItems: cart.getCart() }) },
  onQty(e) { cart.setQty(e.detail.dish, e.detail.qty); this.refreshCart() },
  onCartQty(e) { cart.setQty({ dishId: e.currentTarget.dataset.dishid }, e.detail.value); this.refreshCart() },
  onItemNote(e) { cart.setNote(e.currentTarget.dataset.dishid, e.detail.value) },
  ensureProfile() {
    if (wx.getStorageSync('profile')) return true
    this.setData({ profileVisible: true })
    return false
  },
  onProfileClose() { this.setData({ profileVisible: false }) },
  async onLike(e) {
    if (!this.ensureProfile()) return
    const dish = e.detail.dish
    const d = await callWithToast('toggleLike', { dishId: dish._id }).catch(() => null)
    if (!d) return
    const dishes = this.data.dishes.map((x) =>
      x._id === dish._id ? { ...x, likeCount: (x.likeCount || 0) + (d.liked ? 1 : -1) } : x)
    this.setData({ dishes, ['likedMap.' + dish._id]: d.liked })
    this.applyFilter()
  },
  openCart() { if (this.data.count > 0) this.setData({ cartVisible: true, cartItems: cart.getCart() }) },
  onCartVisible(e) { if (!e.detail.visible) this.setData({ cartVisible: false }) },
  clearAll() { cart.clearCart(); this.refreshCart(); this.setData({ cartVisible: false }) },
  goCheckout() {
    if (cart.cartCount() === 0) return wx.showToast({ title: '先选几道菜吧', icon: 'none' })
    this.setData({ cartVisible: false })
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },
  onPullDownRefresh() { this.loadAll().then(() => wx.stopPullDownRefresh()) },
})
