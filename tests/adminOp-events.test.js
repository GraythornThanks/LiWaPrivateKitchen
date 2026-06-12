import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './fakeDb'
import adminOp from '../cloudfunctions/api/actions/adminOp'

const NOW = 1000000
const ctx = (db) => ({ db, openid: 'host', now: NOW })
const seed = (events = []) => makeFakeDb({ config: [{ _id: 'main', adminOpenids: ['host'], categories: [] }], events })

describe('eventCreate', () => {
  it('正常创建 status=open；时间校验', async () => {
    const db = seed()
    const r = await adminOp(ctx(db), { op: 'eventCreate', title: '周六晚餐', mealTime: NOW + 9000, deadline: NOW + 5000 })
    expect(r.ok).toBe(true)
    expect(await db.getDoc('events', r.data.eventId)).toMatchObject({ title: '周六晚餐', status: 'open' })
    expect((await adminOp(ctx(db), { op: 'eventCreate', title: 't', mealTime: NOW + 9000, deadline: NOW - 1 })).code).toBe('INVALID')
    expect((await adminOp(ctx(db), { op: 'eventCreate', title: 't', mealTime: NOW + 100, deadline: NOW + 200 })).code).toBe('INVALID')
    expect((await adminOp(ctx(db), { op: 'eventCreate', title: '', mealTime: NOW + 9000, deadline: NOW + 5000 })).code).toBe('INVALID')
  })
})

describe('eventSetStatus', () => {
  it('open→closed→done 合法；done→closed 非法；不存在 NOT_FOUND', async () => {
    const db = seed([{ _id: 'e1', status: 'open' }])
    expect((await adminOp(ctx(db), { op: 'eventSetStatus', eventId: 'e1', status: 'closed' })).ok).toBe(true)
    expect((await adminOp(ctx(db), { op: 'eventSetStatus', eventId: 'e1', status: 'done' })).ok).toBe(true)
    expect((await adminOp(ctx(db), { op: 'eventSetStatus', eventId: 'e1', status: 'closed' })).code).toBe('INVALID_TRANSITION')
    expect((await adminOp(ctx(db), { op: 'eventSetStatus', eventId: 'ghost', status: 'done' })).code).toBe('NOT_FOUND')
  })

  it('open→done 直接结束也合法', async () => {
    const db = seed([{ _id: 'e1', status: 'open' }])
    expect((await adminOp(ctx(db), { op: 'eventSetStatus', eventId: 'e1', status: 'done' })).ok).toBe(true)
  })
})
