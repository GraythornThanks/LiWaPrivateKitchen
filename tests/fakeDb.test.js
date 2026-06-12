import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './fakeDb'

describe('fakeDb', () => {
  it('insert 后能 getDoc，find 按相等条件过滤', async () => {
    const db = makeFakeDb()
    const id = await db.insert('dishes', { name: '红烧肉', status: 'on' })
    expect((await db.getDoc('dishes', id)).name).toBe('红烧肉')
    await db.insert('dishes', { name: '凉面', status: 'off' })
    expect(await db.find('dishes', { status: 'on' })).toHaveLength(1)
    expect(await db.count('dishes', {})).toBe(2)
  })

  it('insertWithId 重复 id 返回 false 且不覆盖', async () => {
    const db = makeFakeDb()
    expect(await db.insertWithId('config', 'main', { a: 1 })).toBe(true)
    expect(await db.insertWithId('config', 'main', { a: 2 })).toBe(false)
    expect((await db.getDoc('config', 'main')).a).toBe(1)
  })

  it('updateDoc 支持 inc，removeWhere 按条件删', async () => {
    const db = makeFakeDb({ dishes: [{ _id: 'd1', likeCount: 1 }], likes: [{ _id: 'l1', dishId: 'd1' }, { _id: 'l2', dishId: 'd2' }] })
    await db.updateDoc('dishes', 'd1', { likeCount: db.inc(2) })
    expect((await db.getDoc('dishes', 'd1')).likeCount).toBe(3)
    await db.removeWhere('likes', { dishId: 'd1' })
    expect(await db.count('likes', {})).toBe(1)
  })
})
