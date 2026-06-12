const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const makeDb = require('./lib/cloudDb')
const { err } = require('./lib/result')

const ACTIONS = {
  whoami: require('./actions/whoami'),
  claimAdmin: require('./actions/claimAdmin'),
  updateProfile: require('./actions/updateProfile'),
  submitOrder: require('./actions/submitOrder'),
  toggleLike: require('./actions/toggleLike'),
  submitWish: require('./actions/submitWish'),
  adminOp: require('./actions/adminOp'),
}

exports.main = async (event) => {
  const handler = ACTIONS[event.action]
  if (!handler) return err('UNKNOWN_ACTION', '未知操作')
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return err('INVALID', '无法获取用户身份')
  const ctx = { db: makeDb(cloud.database()), openid: OPENID, now: Date.now() }
  try {
    return await handler(ctx, event.payload || {})
  } catch (e) {
    console.error('[api]', event.action, e)
    return err('INTERNAL', '服务开小差了，请稍后再试')
  }
}
