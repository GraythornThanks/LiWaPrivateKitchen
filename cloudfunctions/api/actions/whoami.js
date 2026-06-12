const { ok } = require('../lib/result')

module.exports = async function whoami(ctx) {
  const cfg = await ctx.db.getDoc('config', 'main')
  return ok({
    openid: ctx.openid,
    claimed: !!cfg,
    isAdmin: !!cfg && (cfg.adminOpenids || []).includes(ctx.openid),
  })
}
