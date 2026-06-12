function pad(n) { return n < 10 ? '0' + n : '' + n }

function fmtDateTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// t-date-time-picker 的值格式：'YYYY-MM-DD HH:mm'
function fmtPickerValue(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function parsePickerValue(s) { return new Date(s.replace(/-/g, '/')).getTime() }

const ORDER_STATUS = { new: '待接单', accepted: '已接单', done: '已完成', declined: '已婉拒' }
const ORDER_THEME = { new: 'warning', accepted: 'primary', done: 'success', declined: 'default' }
const WISH_STATUS = { new: '主厨考虑中', accepted: '安排上！', declined: '下次一定' }

function orderStatusText(s) { return ORDER_STATUS[s] || s }
function orderStatusTheme(s) { return ORDER_THEME[s] || 'default' }
function wishStatusText(s) { return WISH_STATUS[s] || s }
function eventStatusText(e, now) {
  if (e.status === 'done') return '已结束'
  if (e.status === 'closed' || e.deadline <= now) return '已截止'
  return '点菜中'
}

module.exports = { fmtDateTime, fmtPickerValue, parsePickerValue, orderStatusText, orderStatusTheme, wishStatusText, eventStatusText }
