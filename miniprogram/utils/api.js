function call(action, payload = {}) {
  return wx.cloud.callFunction({ name: 'api', data: { action, payload } }).then((res) => {
    const r = res.result || {}
    if (!r.ok) {
      const e = new Error(r.msg || '操作失败')
      e.code = r.code
      e.data = r.data
      throw e
    }
    return r.data
  })
}

function toast(msg, icon = 'none') { wx.showToast({ title: msg, icon }) }

// 失败时自动 toast 后继续抛出；调用方用 .catch(() => null) 判断是否成功
function callWithToast(action, payload) {
  return call(action, payload).catch((e) => { toast(e.message || '网络开小差了'); throw e })
}

module.exports = { call, callWithToast, toast }
