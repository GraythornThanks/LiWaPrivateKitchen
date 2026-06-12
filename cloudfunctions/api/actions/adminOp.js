const { ok, err } = require('../lib/result')

const DISH_FIELDS = ['name', 'category', 'photo', 'desc', 'sort', 'status']

async function dishCreate(ctx, p) {
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  if (!name || name.length > 30) return err('INVALID', '菜名要 1-30 个字')
  if (typeof p.category !== 'string' || !p.category) return err('INVALID', '选个分类')
  const dishId = await ctx.db.insert('dishes', {
    name, category: p.category,
    photo: typeof p.photo === 'string' ? p.photo : '',
    desc: typeof p.desc === 'string' ? p.desc.slice(0, 50) : '',
    sort: Number.isFinite(p.sort) ? p.sort : 0,
    status: 'on', likeCount: 0, createdAt: ctx.now, updatedAt: ctx.now,
  })
  return ok({ dishId })
}

async function dishUpdate(ctx, p) {
  const dish = await ctx.db.getDoc('dishes', p.dishId)
  if (!dish) return err('NOT_FOUND', '这道菜不存在了')
  const patch = {}
  for (const k of DISH_FIELDS) if (p.patch && p.patch[k] !== undefined) patch[k] = p.patch[k]
  if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) return err('INVALID', '菜名不能为空')
  if (patch.status !== undefined && !['on', 'off'].includes(patch.status)) return err('INVALID', '状态不对劲')
  if (patch.category !== undefined && (typeof patch.category !== 'string' || !patch.category)) return err('INVALID', '选个分类')
  if (patch.photo !== undefined && typeof patch.photo !== 'string') return err('INVALID', '照片不对劲')
  if (patch.desc !== undefined && typeof patch.desc !== 'string') return err('INVALID', '介绍不对劲')
  if (patch.desc !== undefined) patch.desc = patch.desc.slice(0, 50)
  if (patch.sort !== undefined && !Number.isFinite(patch.sort)) return err('INVALID', '排序要是数字')
  patch.updatedAt = ctx.now
  await ctx.db.updateDoc('dishes', p.dishId, patch)
  return ok()
}

async function dishDelete(ctx, p) {
  const dish = await ctx.db.getDoc('dishes', p.dishId)
  if (!dish) return err('NOT_FOUND', '这道菜不存在了')
  await ctx.db.removeDoc('dishes', p.dishId)
  await ctx.db.removeWhere('likes', { dishId: p.dishId })
  return ok()
}

const EVENT_TRANSITIONS = { open: ['closed', 'done'], closed: ['done'], done: [] }

async function eventCreate(ctx, p) {
  const title = typeof p.title === 'string' ? p.title.trim() : ''
  if (!title || title.length > 30) return err('INVALID', '饭局名要 1-30 个字')
  if (!Number.isFinite(p.mealTime) || !Number.isFinite(p.deadline)) return err('INVALID', '时间没选对')
  if (p.deadline <= ctx.now) return err('INVALID', '截止时间要晚于现在')
  if (p.deadline > p.mealTime) return err('INVALID', '截止时间要早于开饭时间')
  const eventId = await ctx.db.insert('events', {
    title, mealTime: p.mealTime, deadline: p.deadline,
    note: typeof p.note === 'string' ? p.note.slice(0, 100) : '',
    status: 'open', createdAt: ctx.now,
  })
  return ok({ eventId })
}

async function eventSetStatus(ctx, p) {
  const ev = await ctx.db.getDoc('events', p.eventId)
  if (!ev) return err('NOT_FOUND', '这场饭局不存在')
  if (!(EVENT_TRANSITIONS[ev.status] || []).includes(p.status)) {
    return err('INVALID_TRANSITION', `不能从「${ev.status}」改成「${p.status}」`)
  }
  await ctx.db.updateDoc('events', p.eventId, { status: p.status })
  return ok()
}

const ORDER_TRANSITIONS = { new: ['accepted', 'declined'], accepted: ['done'], done: [], declined: [] }

async function orderSetStatus(ctx, p) {
  const order = await ctx.db.getDoc('orders', p.orderId)
  if (!order) return err('NOT_FOUND', '订单不存在')
  if (!(ORDER_TRANSITIONS[order.status] || []).includes(p.status)) {
    return err('INVALID_TRANSITION', `不能从「${order.status}」改成「${p.status}」`)
  }
  const patch = { status: p.status, updatedAt: ctx.now }
  if (p.status === 'declined') patch.declineReason = typeof p.declineReason === 'string' ? p.declineReason.slice(0, 50) : ''
  await ctx.db.updateDoc('orders', p.orderId, patch)
  return ok()
}

async function wishReply(ctx, p) {
  const wish = await ctx.db.getDoc('wishes', p.wishId)
  if (!wish) return err('NOT_FOUND', '这条愿望不存在')
  if (!['accepted', 'declined'].includes(p.status)) return err('INVALID', '状态不对劲')
  await ctx.db.updateDoc('wishes', p.wishId, {
    status: p.status, reply: typeof p.reply === 'string' ? p.reply.slice(0, 100) : '',
  })
  return ok()
}

const OPS = { dishCreate, dishUpdate, dishDelete, eventCreate, eventSetStatus, orderSetStatus, wishReply }

module.exports = async function adminOp(ctx, payload) {
  const cfg = await ctx.db.getDoc('config', 'main')
  if (!cfg || !(cfg.adminOpenids || []).includes(ctx.openid)) return err('FORBIDDEN', '需要主厨权限')
  const op = OPS[payload.op]
  if (!op) return err('UNKNOWN_ACTION', '未知管理操作')
  return op(ctx, payload)
}
