import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './fakeDb'
import updateProfile from '../cloudfunctions/api/actions/updateProfile'

const ctx = (db, openid = 'u1') => ({ db, openid, now: 1000000 })

describe('updateProfile', () => {
  it('写入 users（_id 为 openid），avatar 可空', async () => {
    const db = makeFakeDb()
    const r = await updateProfile(ctx(db), { nickname: ' 老王 ', avatar: '' })
    expect(r.ok).toBe(true)
    expect(await db.getDoc('users', 'u1')).toMatchObject({ nickname: '老王', avatar: '' })
  })

  it('空昵称 / 超 20 字 → INVALID', async () => {
    const db = makeFakeDb()
    expect((await updateProfile(ctx(db), { nickname: '  ' })).code).toBe('INVALID')
    expect((await updateProfile(ctx(db), { nickname: '王'.repeat(21) })).code).toBe('INVALID')
  })

  it('重复调用覆盖旧资料', async () => {
    const db = makeFakeDb()
    await updateProfile(ctx(db), { nickname: '老王', avatar: 'cloud://a.png' })
    await updateProfile(ctx(db), { nickname: '王哥', avatar: 'cloud://b.png' })
    expect(await db.getDoc('users', 'u1')).toMatchObject({ nickname: '王哥', avatar: 'cloud://b.png' })
  })
})
