const { ok, err } = require('../lib/result')

module.exports = async function toggleLike(ctx, payload) {
  const { db, openid } = ctx
  const dishId = payload.dishId
  if (typeof dishId !== 'string' || !dishId) return err('INVALID', '参数不对劲')
  const dish = await db.getDoc('dishes', dishId)
  if (!dish) return err('NOT_FOUND', '这道菜不存在了')
  const existing = await db.findOne('likes', { dishId, openid })
  if (existing) {
    await db.removeDoc('likes', existing._id)
    await db.updateDoc('dishes', dishId, { likeCount: db.inc(-1) })
    return ok({ liked: false })
  }
  await db.insert('likes', { dishId, openid, createdAt: ctx.now })
  await db.updateDoc('dishes', dishId, { likeCount: db.inc(1) })
  return ok({ liked: true })
}
