import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './fakeDb'
import adminOp from '../cloudfunctions/api/actions/adminOp'

const NOW = 1000000
const ctx = (db, openid = 'host') => ({ db, openid, now: NOW })
const seed = (extra = {}) => makeFakeDb({ config: [{ _id: 'main', adminOpenids: ['host'], categories: ['热菜'] }], ...extra })

describe('adminOp 鉴权', () => {
  it('非管理员 → FORBIDDEN；未知 op → UNKNOWN_ACTION', async () => {
    expect((await adminOp(ctx(seed(), 'guest'), { op: 'dishCreate' })).code).toBe('FORBIDDEN')
    expect((await adminOp(ctx(seed()), { op: 'hack' })).code).toBe('UNKNOWN_ACTION')
  })
})

describe('dishCreate / dishUpdate / dishDelete', () => {
  it('创建默认 on、likeCount 0；空菜名 INVALID', async () => {
    const db = seed()
    const r = await adminOp(ctx(db), { op: 'dishCreate', name: '红烧肉', category: '热菜', desc: '招牌', sort: 1 })
    expect(r.ok).toBe(true)
    expect(await db.getDoc('dishes', r.data.dishId)).toMatchObject({ name: '红烧肉', status: 'on', likeCount: 0 })
    expect((await adminOp(ctx(db), { op: 'dishCreate', name: ' ', category: '热菜' })).code).toBe('INVALID')
  })

  it('更新只接受白名单字段，likeCount 改不动', async () => {
    const db = seed({ dishes: [{ _id: 'd1', name: '红烧肉', status: 'on', likeCount: 5 }] })
    const r = await adminOp(ctx(db), { op: 'dishUpdate', dishId: 'd1', patch: { name: '红烧肉PLUS', status: 'off', likeCount: 999 } })
    expect(r.ok).toBe(true)
    expect(await db.getDoc('dishes', 'd1')).toMatchObject({ name: '红烧肉PLUS', status: 'off', likeCount: 5 })
    expect((await adminOp(ctx(db), { op: 'dishUpdate', dishId: 'ghost', patch: {} })).code).toBe('NOT_FOUND')
    expect((await adminOp(ctx(db), { op: 'dishUpdate', dishId: 'd1', patch: { status: 'hidden' } })).code).toBe('INVALID')
  })

  it('删除菜级联清理 likes', async () => {
    const db = seed({
      dishes: [{ _id: 'd1', name: '红烧肉' }],
      likes: [{ _id: 'l1', dishId: 'd1' }, { _id: 'l2', dishId: 'd2' }],
    })
    expect((await adminOp(ctx(db), { op: 'dishDelete', dishId: 'd1' })).ok).toBe(true)
    expect(await db.getDoc('dishes', 'd1')).toBeNull()
    expect(await db.count('likes', {})).toBe(1)
  })

  it('更新时非法字段值 → INVALID', async () => {
    const db = seed({ dishes: [{ _id: 'd1', name: '红烧肉', status: 'on', likeCount: 0 }] })
    expect((await adminOp(ctx(db), { op: 'dishUpdate', dishId: 'd1', patch: { category: null } })).code).toBe('INVALID')
    expect((await adminOp(ctx(db), { op: 'dishUpdate', dishId: 'd1', patch: { sort: 'abc' } })).code).toBe('INVALID')
    expect((await adminOp(ctx(db), { op: 'dishUpdate', dishId: 'd1', patch: { photo: 123 } })).code).toBe('INVALID')
    expect((await adminOp(ctx(db), { op: 'dishUpdate', dishId: 'd1', patch: { desc: 'x'.repeat(60) } })).ok).toBe(true)
    expect((await db.getDoc('dishes', 'd1')).desc).toHaveLength(50)
  })
})
