import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './fakeDb'
import toggleLike from '../cloudfunctions/api/actions/toggleLike'

const ctx = (db, openid = 'u1') => ({ db, openid, now: 1000000 })
const seed = () => makeFakeDb({ dishes: [{ _id: 'd1', name: '红烧肉', likeCount: 0 }] })

describe('toggleLike', () => {
  it('首赞 liked=true、likeCount+1；再点取消并 -1', async () => {
    const db = seed()
    expect((await toggleLike(ctx(db), { dishId: 'd1' })).data.liked).toBe(true)
    expect((await db.getDoc('dishes', 'd1')).likeCount).toBe(1)
    expect(await db.count('likes', { dishId: 'd1', openid: 'u1' })).toBe(1)
    expect((await toggleLike(ctx(db), { dishId: 'd1' })).data.liked).toBe(false)
    expect((await db.getDoc('dishes', 'd1')).likeCount).toBe(0)
    expect(await db.count('likes', {})).toBe(0)
  })

  it('两个人点赞互不影响', async () => {
    const db = seed()
    await toggleLike(ctx(db, 'u1'), { dishId: 'd1' })
    await toggleLike(ctx(db, 'u2'), { dishId: 'd1' })
    expect((await db.getDoc('dishes', 'd1')).likeCount).toBe(2)
  })

  it('菜不存在 → NOT_FOUND', async () => {
    expect((await toggleLike(ctx(seed()), { dishId: 'ghost' })).code).toBe('NOT_FOUND')
  })
})
