const { ok, err } = require('../lib/result')

module.exports = async function submitWish(ctx, payload) {
  const profile = await ctx.db.getDoc('users', ctx.openid)
  if (!profile) return err('NO_PROFILE', '先设置一下昵称头像吧')
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (!text || text.length > 100) return err('INVALID', '愿望要 1-100 个字')
  const wishId = await ctx.db.insert('wishes', {
    openid: ctx.openid, nickname: profile.nickname, avatar: profile.avatar || '',
    text, status: 'new', reply: '', createdAt: ctx.now,
  })
  return ok({ wishId })
}
