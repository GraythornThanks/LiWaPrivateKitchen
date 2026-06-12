const { ok, err } = require('../lib/result')
const DEFAULT_CATEGORIES = ['热菜', '凉菜', '汤', '主食', '甜点']

module.exports = async function claimAdmin(ctx) {
  if (!ctx.openid) return err('INVALID', '无法获取用户身份')
  const created = await ctx.db.insertWithId('config', 'main', {
    adminOpenids: [ctx.openid], categories: DEFAULT_CATEGORIES,
  })
  if (created) return ok({ isAdmin: true })
  const cfg = await ctx.db.getDoc('config', 'main')
  if (cfg && (cfg.adminOpenids || []).includes(ctx.openid)) return ok({ isAdmin: true })
  return err('ALREADY_CLAIMED', '主厨之位已有人认领啦')
}
