const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const { fmtDateTime, fmtPickerValue, parsePickerValue, eventStatusText } = require('../../../utils/format')
const db = wx.cloud.database()

Page({
  data: {
    events: [], createVisible: false, saving: false,
    title: '', note: '', mealTime: 0, deadline: 0,
    mealText: '选择时间 ›', deadlineText: '选择时间 ›',
    mealPickerVisible: false, deadlinePickerVisible: false,
    pickerStart: '', pickerEnd: '',
  },
  async onShow() { if (await guard()) this.load() },
  async load() {
    const now = Date.now()
    const r = await db.collection('events').orderBy('mealTime', 'desc').limit(50).get().catch(() => ({ data: [] }))
    this.setData({
      events: r.data.map((e) => ({
        ...e,
        mealText: fmtDateTime(e.mealTime),
        deadlineText: fmtDateTime(e.deadline),
        statusText: eventStatusText(e, now),
      })),
    })
  },
  openCreate() {
    const now = new Date()
    this.setData({
      createVisible: true, title: '', note: '', mealTime: 0, deadline: 0,
      mealText: '选择时间 ›', deadlineText: '选择时间 ›',
      pickerStart: fmtPickerValue(now),
      pickerEnd: fmtPickerValue(new Date(now.getTime() + 30 * 86400000)),
    })
  },
  onCreateVisible(e) { if (!e.detail.visible) this.setData({ createVisible: false }) },
  onField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  openMealPicker() { this.setData({ mealPickerVisible: true }) },
  openDeadlinePicker() { this.setData({ deadlinePickerVisible: true }) },
  onMealConfirm(e) {
    const ts = parsePickerValue(e.detail.value)
    this.setData({ mealTime: ts, mealText: fmtDateTime(ts), mealPickerVisible: false })
  },
  onDeadlineConfirm(e) {
    const ts = parsePickerValue(e.detail.value)
    this.setData({ deadline: ts, deadlineText: fmtDateTime(ts), deadlinePickerVisible: false })
  },
  onMealCancel() { this.setData({ mealPickerVisible: false }) },
  onDeadlineCancel() { this.setData({ deadlinePickerVisible: false }) },
  async create() {
    const { title, note, mealTime, deadline } = this.data
    if (!title.trim()) return wx.showToast({ title: '起个饭局名吧', icon: 'none' })
    if (!mealTime || !deadline) return wx.showToast({ title: '把时间选了', icon: 'none' })
    this.setData({ saving: true })
    const d = await callWithToast('adminOp', { op: 'eventCreate', title: title.trim(), note, mealTime, deadline }).catch(() => null)
    this.setData({ saving: false })
    if (d === null) return
    this.setData({ createVisible: false })
    this.load()
  },
  async setStatus(e) {
    const { id, status } = e.currentTarget.dataset
    const d = await callWithToast('adminOp', { op: 'eventSetStatus', eventId: id, status }).catch(() => null)
    if (d !== null) this.load()
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
})
