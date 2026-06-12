module.exports = async function guard() {
  const app = getApp()
  await app.whoamiReady
  if (app.globalData.isAdmin) return true
  wx.showToast({ title: '需要主厨权限', icon: 'none' })
  setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) }), 600)
  return false
}
