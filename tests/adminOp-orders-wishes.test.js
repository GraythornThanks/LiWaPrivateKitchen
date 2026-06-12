import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './fakeDb'
import adminOp from '../cloudfunctions/api/actions/adminOp'

const NOW = 1000000
const ctx = (db) => ({ db, openid: 'host', now: NOW })
const seed = (extra = {}) => makeFakeDb({ config: [{ _id: 'main', adminOpenids: ['host'], categories: [] }], ...extra })

describe('orderSetStatus', () => {
  it('new→accepted→done 合法链路', async () => {
    const db = seed({ orders: [{ _id: 'o1', status: 'new' }] })
    expect((await adminOp(ctx(db), { op: 'orderSetStatus', orderId: 'o1', status: 'accepted' })).ok).toBe(true)
    expect((await adminOp(ctx(db), { op: 'orderSetStatus', orderId: 'o1', status: 'done' })).ok).toBe(true)
    expect((await db.getDoc('orders', 'o1')).status).toBe('done')
  })

  it('new→declined 存原因；accepted→declined 非法；done 终态', async () => {
    const db = seed({ orders: [{ _id: 'o1', status: 'new' }, { _id: 'o2', status: 'accepted' }, { _id: 'o3', status: 'done' }] })
    expect((await adminOp(ctx(db), { op: 'orderSetStatus', orderId: 'o1', status: 'declined', declineReason: '食材买不到' })).ok).toBe(true)
    expect((await db.getDoc('orders', 'o1')).declineReason).toBe('食材买不到')
    expect((await adminOp(ctx(db), { op: 'orderSetStatus', orderId: 'o2', status: 'declined' })).code).toBe('INVALID_TRANSITION')
    expect((await adminOp(ctx(db), { op: 'orderSetStatus', orderId: 'o3', status: 'new' })).code).toBe('INVALID_TRANSITION')
    expect((await adminOp(ctx(db), { op: 'orderSetStatus', orderId: 'ghost', status: 'done' })).code).toBe('NOT_FOUND')
  })
})

describe('wishReply', () => {
  it('accepted/declined + 回复；非法状态 INVALID；不存在 NOT_FOUND', async () => {
    const db = seed({ wishes: [{ _id: 'w1', status: 'new', reply: '' }] })
    expect((await adminOp(ctx(db), { op: 'wishReply', wishId: 'w1', status: 'accepted', reply: '下周安排' })).ok).toBe(true)
    expect(await db.getDoc('wishes', 'w1')).toMatchObject({ status: 'accepted', reply: '下周安排' })
    expect((await adminOp(ctx(db), { op: 'wishReply', wishId: 'w1', status: 'eaten' })).code).toBe('INVALID')
    expect((await adminOp(ctx(db), { op: 'wishReply', wishId: 'ghost', status: 'accepted' })).code).toBe('NOT_FOUND')
  })
})
