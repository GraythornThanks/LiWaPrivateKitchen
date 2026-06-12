import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './fakeDb'
import submitOrder from '../cloudfunctions/api/actions/submitOrder'

const NOW = 1000000
const ctx = (db, openid = 'u1') => ({ db, openid, now: NOW })
const seed = () => makeFakeDb({
  users: [{ _id: 'u1', nickname: '老王', avatar: 'cloud://a.png' }],
  dishes: [
    { _id: 'd1', name: '红烧肉', status: 'on' },
    { _id: 'd2', name: '凉面', status: 'off' },
  ],
  events: [{ _id: 'e1', title: '周六晚餐', status: 'open', deadline: NOW + 1000, mealTime: NOW + 9999 }],
})

describe('submitOrder 随时单', () => {
  it('正常下单：菜名快照、status=new、headcount 默认 1', async () => {
    const db = seed()
    const r = await submitOrder(ctx(db), {
      items: [{ dishId: 'd1', qty: 2, note: '少辣' }], mealTime: NOW + 86400000, orderNote: '都别太咸',
    })
    expect(r.ok).toBe(true)
    const o = await db.getDoc('orders', r.data.orderId)
    expect(o).toMatchObject({
      openid: 'u1', nickname: '老王', eventId: null, eventTitle: '',
      mealTime: NOW + 86400000, headcount: 1, status: 'new', orderNote: '都别太咸',
    })
    expect(o.items).toEqual([{ dishId: 'd1', name: '红烧肉', qty: 2, note: '少辣' }])
  })

  it('未设置资料 → NO_PROFILE', async () => {
    const r = await submitOrder(ctx(seed(), 'stranger'), { items: [{ dishId: 'd1', qty: 1 }], mealTime: NOW + 1 })
    expect(r.code).toBe('NO_PROFILE')
  })

  it('空 items / 非法 qty → INVALID', async () => {
    expect((await submitOrder(ctx(seed()), { items: [], mealTime: NOW + 1 })).code).toBe('INVALID')
    expect((await submitOrder(ctx(seed()), { items: [{ dishId: 'd1', qty: 0 }], mealTime: NOW + 1 })).code).toBe('INVALID')
    expect((await submitOrder(ctx(seed()), { items: [{ dishId: 'd1', qty: 1.5 }], mealTime: NOW + 1 })).code).toBe('INVALID')
  })

  it('随时单缺 mealTime → INVALID', async () => {
    expect((await submitOrder(ctx(seed()), { items: [{ dishId: 'd1', qty: 1 }] })).code).toBe('INVALID')
  })

  it('下架菜 / 不存在的菜 → DISH_OFF 且 msg 带菜名', async () => {
    const r = await submitOrder(ctx(seed()), { items: [{ dishId: 'd2', qty: 1 }], mealTime: NOW + 1 })
    expect(r.code).toBe('DISH_OFF')
    expect(r.msg).toContain('凉面')
    const r2 = await submitOrder(ctx(seed()), { items: [{ dishId: 'ghost', qty: 1 }], mealTime: NOW + 1 })
    expect(r2.code).toBe('DISH_OFF')
  })

  it('重复菜品 / 空 dishId / 超过 30 道 → INVALID', async () => {
    expect((await submitOrder(ctx(seed()), { items: [{ dishId: 'd1', qty: 1 }, { dishId: 'd1', qty: 2 }], mealTime: NOW + 1 })).code).toBe('INVALID')
    expect((await submitOrder(ctx(seed()), { items: [{ dishId: '', qty: 1 }], mealTime: NOW + 1 })).code).toBe('INVALID')
    const many = Array.from({ length: 31 }, (_, i) => ({ dishId: 'd' + i, qty: 1 }))
    expect((await submitOrder(ctx(seed()), { items: many, mealTime: NOW + 1 })).code).toBe('INVALID')
  })

  it('用餐时间早于现在 2 小时以上 → INVALID', async () => {
    expect((await submitOrder(ctx(seed()), { items: [{ dishId: 'd1', qty: 1 }], mealTime: NOW - 3 * 3600000 })).code).toBe('INVALID')
  })

  it('混合购物车：只报下架菜且不落单', async () => {
    const db = seed()
    const r = await submitOrder(ctx(db), { items: [{ dishId: 'd1', qty: 1 }, { dishId: 'd2', qty: 1 }], mealTime: NOW + 1 })
    expect(r.code).toBe('DISH_OFF')
    expect(r.msg).toContain('凉面')
    expect(r.msg).not.toContain('红烧肉')
    expect(await db.count('orders', {})).toBe(0)
  })
})

describe('submitOrder 饭局单', () => {
  it('正常：mealTime=null，带 eventTitle 快照，headcount 可传', async () => {
    const r = await submitOrder(ctx(seed()), { eventId: 'e1', items: [{ dishId: 'd1', qty: 1 }], headcount: 2 })
    expect(r.ok).toBe(true)
    const db2 = seed()
    const r2 = await submitOrder(ctx(db2), { eventId: 'e1', items: [{ dishId: 'd1', qty: 1 }], headcount: 2 })
    const o = await db2.getDoc('orders', r2.data.orderId)
    expect(o).toMatchObject({ eventId: 'e1', eventTitle: '周六晚餐', mealTime: null, headcount: 2 })
  })

  it('饭局不存在 → NOT_FOUND；已截止/已关闭 → EVENT_CLOSED', async () => {
    expect((await submitOrder(ctx(seed()), { eventId: 'ghost', items: [{ dishId: 'd1', qty: 1 }] })).code).toBe('NOT_FOUND')
    const late = makeFakeDb({
      users: [{ _id: 'u1', nickname: '老王' }],
      dishes: [{ _id: 'd1', name: '红烧肉', status: 'on' }],
      events: [{ _id: 'e1', title: 't', status: 'open', deadline: NOW - 1 }],
    })
    expect((await submitOrder(ctx(late), { eventId: 'e1', items: [{ dishId: 'd1', qty: 1 }] })).code).toBe('EVENT_CLOSED')
    const closed = makeFakeDb({
      users: [{ _id: 'u1', nickname: '老王' }],
      dishes: [{ _id: 'd1', name: '红烧肉', status: 'on' }],
      events: [{ _id: 'e1', title: 't', status: 'closed', deadline: NOW + 1000 }],
    })
    expect((await submitOrder(ctx(closed), { eventId: 'e1', items: [{ dishId: 'd1', qty: 1 }] })).code).toBe('EVENT_CLOSED')
  })
})
