const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const db = wx.cloud.database()

Page({
  data: {
    id: '', name: '', category: '', desc: '', sort: 0, photo: '',
    categories: [], catOptions: [], catVisible: false, saving: false,
  },
  async onLoad(q) {
    if (!(await guard())) return
    const cfg = await db.collection('config').doc('main').get().catch(() => null)
    const categories = cfg ? cfg.data.categories : []
    this.setData({ categories, catOptions: categories.map((c) => ({ label: c, value: c })) })
    if (q.id) {
      const r = await db.collection('dishes').doc(q.id).get().catch(() => null)
      if (!r) return wx.showToast({ title: '加载失败', icon: 'none' })
      const d = r.data
      this.setData({ id: q.id, name: d.name, category: d.category, desc: d.desc || '', sort: d.sort || 0, photo: d.photo || '' })
      wx.setNavigationBarTitle({ title: d.name })
    } else {
      this.setData({ category: this.data.categories[0] || '' })
    }
  },
  onField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  openCat() { this.setData({ catVisible: true }) },
  onCatConfirm(e) { this.setData({ category: e.detail.value[0], catVisible: false }) },
  onCatCancel() { this.setData({ catVisible: false }) },
  async choosePhoto() {
    const m = await wx.chooseMedia({ count: 1, mediaType: ['image'] }).catch(() => null)
    if (!m) return
    wx.showLoading({ title: '上传中' })
    try {
      const up = await wx.cloud.uploadFile({
        cloudPath: 'dishes/' + Date.now() + '.jpg',
        filePath: m.tempFiles[0].tempFilePath,
      })
      this.setData({ photo: up.fileID })
    } catch (e) {
      wx.showToast({ title: '上传失败，再试一次', icon: 'none' })
    }
    wx.hideLoading()
  },
  async save() {
    const { id, name, category, desc, sort, photo } = this.data
    if (!name.trim()) return wx.showToast({ title: '菜名不能为空', icon: 'none' })
    this.setData({ saving: true })
    const fields = { name: name.trim(), category, desc, sort: Number(sort) || 0, photo }
    const payload = id ? { op: 'dishUpdate', dishId: id, patch: fields } : { op: 'dishCreate', ...fields }
    const d = await callWithToast('adminOp', payload).catch(() => null)
    this.setData({ saving: false })
    if (d !== null) wx.navigateBack()
  },
})
