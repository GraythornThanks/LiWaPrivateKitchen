const { ok, err } = require('../lib/result')

module.exports = async function submitOrder(ctx, payload) {
  const { db, openid, now } = ctx
  const profile = await db.getDoc('users', openid)
  if (!profile) return err('NO_PROFILE', '先设置一下昵称头像吧')

  const items = payload.items
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) return err('INVALID', '购物车是空的')
  for (const it of items) {
    if (!it || typeof it.dishId !== 'string' || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > 99) {
      return err('INVALID', '订单数据不对劲')
    }
  }
  const orderNote = typeof payload.orderNote === 'string' ? payload.orderNote.slice(0, 100) : ''
  const headcount = Number.isInteger(payload.headcount) && payload.headcount >= 1 && payload.headcount <= 50 ? payload.headcount : 1

  let event = null
  let mealTime = null
  if (payload.eventId) {
    event = await db.getDoc('events', payload.eventId)
    if (!event) return err('NOT_FOUND', '这场饭局不存在')
    if (event.status !== 'open' || now > event.deadline) return err('EVENT_CLOSED', '手慢了，这场饭局已截止点菜')
  } else {
    if (!Number.isFinite(payload.mealTime)) return err('INVALID', '想什么时候吃？选个时间吧')
    mealTime = payload.mealTime
  }

  const snapshots = []
  const offNames = []
  for (const it of items) {
    const dish = await db.getDoc('dishes', it.dishId)
    if (!dish || dish.status !== 'on') { offNames.push(dish ? dish.name : '已下架的菜'); continue }
    snapshots.push({ dishId: it.dishId, name: dish.name, qty: it.qty, note: typeof it.note === 'string' ? it.note.slice(0, 50) : '' })
  }
  if (offNames.length) return err('DISH_OFF', `「${offNames.join('」「')}」已下架，请移除后再提交`, { names: offNames })

  const orderId = await db.insert('orders', {
    openid, nickname: profile.nickname, avatar: profile.avatar || '',
    eventId: payload.eventId || null, eventTitle: event ? event.title : '',
    items: snapshots, orderNote, mealTime, headcount,
    status: 'new', declineReason: '', createdAt: now, updatedAt: now,
  })
  return ok({ orderId })
}
