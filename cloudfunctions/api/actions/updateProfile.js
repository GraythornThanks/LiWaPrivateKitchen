const { ok, err } = require('../lib/result')

module.exports = async function updateProfile(ctx, payload) {
  const nickname = typeof payload.nickname === 'string' ? payload.nickname.trim() : ''
  if (!nickname || nickname.length > 20) return err('INVALID', '昵称要 1-20 个字')
  const avatar = typeof payload.avatar === 'string' ? payload.avatar : ''
  await ctx.db.setDoc('users', ctx.openid, { nickname, avatar, updatedAt: ctx.now })
  return ok()
}
