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

const OPS = { dishCreate, dishUpdate, dishDelete }

module.exports = async function adminOp(ctx, payload) {
  const cfg = await ctx.db.getDoc('config', 'main')
  if (!cfg || !(cfg.adminOpenids || []).includes(ctx.openid)) return err('FORBIDDEN', '需要主厨权限')
  const op = OPS[payload.op]
  if (!op) return err('UNKNOWN_ACTION', '未知管理操作')
  return op(ctx, payload)
}
