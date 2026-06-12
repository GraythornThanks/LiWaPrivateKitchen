const { call } = require('./utils/api')

App({
  globalData: { cart: [], openid: '', isAdmin: false },
  onLaunch() {
    if (!wx.cloud) {
      console.error('基础库过低，无法使用云能力')
      this.whoamiReady = Promise.resolve({ openid: '', isAdmin: false, claimed: true })
      return
    }
    wx.cloud.init({ traceUser: true })
    this.whoamiReady = call('whoami')
      .then((d) => {
        this.globalData.openid = d.openid
        this.globalData.isAdmin = d.isAdmin
        if (d.openid && !wx.getStorageSync('profile')) this.restoreProfile(d.openid)
        return d
      })
      .catch(() => ({ openid: '', isAdmin: false, claimed: true }))
  },
  // 换设备/清缓存后从云端恢复资料
  restoreProfile(openid) {
    wx.cloud.database().collection('users').doc(openid).get()
      .then((r) => { if (r.data) wx.setStorageSync('profile', { nickname: r.data.nickname, avatar: r.data.avatar }) })
      .catch(() => {})
  },
})
