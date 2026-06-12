import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './fakeDb'
import claimAdmin from '../cloudfunctions/api/actions/claimAdmin'
import whoami from '../cloudfunctions/api/actions/whoami'

const ctx = (db, openid = 'u1') => ({ db, openid, now: 1000000 })

describe('claimAdmin', () => {
  it('首次认领成功，写入 config 与默认分类', async () => {
    const db = makeFakeDb()
    const r = await claimAdmin(ctx(db, 'host'))
    expect(r.ok).toBe(true)
    const cfg = await db.getDoc('config', 'main')
    expect(cfg.adminOpenids).toEqual(['host'])
    expect(cfg.categories).toContain('热菜')
  })

  it('第二人认领返回 ALREADY_CLAIMED，原管理员不变', async () => {
    const db = makeFakeDb()
    await claimAdmin(ctx(db, 'host'))
    const r = await claimAdmin(ctx(db, 'sneaky'))
    expect(r.code).toBe('ALREADY_CLAIMED')
    expect((await db.getDoc('config', 'main')).adminOpenids).toEqual(['host'])
  })

  it('同一人重复认领幂等返回 ok', async () => {
    const db = makeFakeDb()
    await claimAdmin(ctx(db, 'host'))
    expect((await claimAdmin(ctx(db, 'host'))).ok).toBe(true)
  })
})

describe('whoami', () => {
  it('未认领时 claimed=false isAdmin=false', async () => {
    const r = await whoami(ctx(makeFakeDb()))
    expect(r.data).toMatchObject({ openid: 'u1', claimed: false, isAdmin: false })
  })

  it('管理员 isAdmin=true，路人 false', async () => {
    const db = makeFakeDb({ config: [{ _id: 'main', adminOpenids: ['host'], categories: [] }] })
    expect((await whoami(ctx(db, 'host'))).data.isAdmin).toBe(true)
    expect((await whoami(ctx(db, 'guest'))).data.isAdmin).toBe(false)
    expect((await whoami(ctx(db, 'guest'))).data.claimed).toBe(true)
  })
})
