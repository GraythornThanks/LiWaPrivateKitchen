function ok(data = null) { return { ok: true, code: 'OK', msg: '', data } }
function err(code, msg, data = null) { return { ok: false, code, msg, data } }
module.exports = { ok, err }
