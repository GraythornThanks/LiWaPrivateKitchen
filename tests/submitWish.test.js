import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './fakeDb'
import submitWish from '../cloudfunctions/api/actions/submitWish'

const ctx = (db, openid = 'u1') => ({ db, openid, now: 1000000 })

describe('submitWish', () => {
  it('正常许愿：带昵称头像快照，status=new', async () => {
    const db = makeFakeDb({ users: [{ _id: 'u1', nickname: '老王', avatar: 'cloud://a.png' }] })
    const r = await submitWish(ctx(db), { text: ' 想吃佛跳墙！ ' })
    expect(r.ok).toBe(true)
    expect(await db.getDoc('wishes', r.data.wishId)).toMatchObject({
      openid: 'u1', nickname: '老王', text: '想吃佛跳墙！', status: 'new', reply: '',
    })
  })

  it('无资料 → NO_PROFILE；空文本 → INVALID', async () => {
    expect((await submitWish(ctx(makeFakeDb()), { text: 'x' })).code).toBe('NO_PROFILE')
    const db = makeFakeDb({ users: [{ _id: 'u1', nickname: '老王' }] })
    expect((await submitWish(ctx(db), { text: '   ' })).code).toBe('INVALID')
  })
})
