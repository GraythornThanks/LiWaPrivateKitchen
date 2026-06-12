# 李娃私厨点餐小程序实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现「李娃私厨」微信小程序：朋友点菜（饭局/随时单两种模式）、主厨在小程序内管理菜单和订单，后端为微信云开发。

**Architecture:** 原生小程序（3 个 Tab + 管理子页）+ 单一 `api` 云函数（action 路由，业务逻辑通过注入式 db 接口实现，可本地单测）+ 云数据库 7 集合（客户端只读、写全走云函数）。

**Tech Stack:** 原生 WXML/WXSS/JS、TDesign 小程序组件库、微信云开发（wx-server-sdk）、vitest（云函数逻辑单测）。

**规格落地时的 4 个实现层调整**（相对设计文档，均为实现细节优化）：
1. 所有业务集合用自有字段 `openid`（而非保留字段 `_openid`），因为写入全部发生在云函数侧，`_openid` 仅客户端写入时自动注入。
2. 所有时间存 **毫秒时间戳（number）** 而非 Date 类型，跨云函数/客户端边界零序列化歧义。
3. `orders` 增加 `eventTitle` 快照字段（与菜名快照同理，"我的订单"列表免联表）。
4. 饭局归属在 **checkout 页显式选择**（有进行中饭局时默认选中该饭局），代替"从横幅进入则隐式挂饭局"的全局状态——无隐藏状态，行为可预期。

**关键约定（全计划一致）：**
- 云函数返回统一为 `{ok, code, msg, data}`；错误码：`INVALID / NO_PROFILE / DISH_OFF / EVENT_CLOSED / NOT_FOUND / FORBIDDEN / ALREADY_CLAIMED / INVALID_TRANSITION / UNKNOWN_ACTION / INTERNAL`
- action 签名：`handler(ctx, payload)`，`ctx = { db, openid, now }`，`now` 为毫秒时间戳
- db 注入接口：`inc / getDoc / findOne / find / insert / insertWithId / setDoc / updateDoc / removeDoc / removeWhere / count`
- 小程序端无自动化测试，每个前端任务以"写文件 → 提交"为步骤，统一在 Task 24 的手动测试清单中验证

## 文件结构总览

```
LiWaPrivateKitchen/
├── package.json                      # root：vitest
├── project.config.json
├── cloudfunctions/api/
│   ├── package.json                  # wx-server-sdk
│   ├── index.js                      # 入口：action 路由 + 异常兜底
│   ├── lib/result.js                 # ok()/err()
│   ├── lib/cloudDb.js                # 真实 db 适配器
│   └── actions/{whoami,claimAdmin,updateProfile,submitOrder,toggleLike,submitWish,adminOp}.js
├── tests/                            # vitest
│   ├── fakeDb.js                     # 内存假 db
│   └── *.test.js
└── miniprogram/
    ├── app.js / app.json / app.wxss / sitemap.json
    ├── package.json                  # tdesign-miniprogram
    ├── utils/{api,format,cart,guard}.js
    ├── components/{profile-sheet,dish-card}/
    └── pages/
        ├── menu/  checkout/  events/  event-detail/  mine/
        └── admin/{index,orders,dishes,dish-edit,events,wishes}/
```

---

## Phase 0：脚手架

### Task 1: 仓库脚手架与测试工具链

**Files:**
- Create: `package.json`、`cloudfunctions/api/package.json`

- [ ] **Step 1: 写 root `package.json`**

```json
{
  "name": "liwa-private-kitchen",
  "private": true,
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^3.0.0" }
}
```

- [ ] **Step 2: 写 `cloudfunctions/api/package.json`**

```json
{
  "name": "api",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": { "wx-server-sdk": "~2.6.3" }
}
```

- [ ] **Step 3: 安装 vitest 并确认可运行**

Run: `npm install && npx vitest run`
Expected: `No test files found`（退出码非 0 没关系，确认 vitest 可执行即可）

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json cloudfunctions/api/package.json
git commit -m "chore: 脚手架与 vitest 工具链"
```

---

## Phase 1：云函数核心（TDD）

### Task 2: result 帮助函数与内存假 db

**Files:**
- Create: `cloudfunctions/api/lib/result.js`、`tests/fakeDb.js`、`tests/fakeDb.test.js`

- [ ] **Step 1: 写 fakeDb 的冒烟测试 `tests/fakeDb.test.js`**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/fakeDb.test.js`
Expected: FAIL（fakeDb 不存在）

- [ ] **Step 3: 写 `cloudfunctions/api/lib/result.js` 与 `tests/fakeDb.js`**

```js
// cloudfunctions/api/lib/result.js
function ok(data = null) { return { ok: true, code: 'OK', msg: '', data } }
function err(code, msg, data = null) { return { ok: false, code, msg, data } }
module.exports = { ok, err }
```

```js
// tests/fakeDb.js — 与 lib/cloudDb.js 同接口的内存实现
function makeFakeDb(seed = {}) {
  const colls = new Map(Object.entries(seed).map(([k, docs]) => [k, new Map(docs.map((d) => [d._id, { ...d }]))]))
  let autoId = 0
  const coll = (name) => { if (!colls.has(name)) colls.set(name, new Map()); return colls.get(name) }
  const matches = (doc, query) => Object.entries(query).every(([k, v]) => doc[k] === v)
  const applyData = (doc, data) => {
    for (const [k, v] of Object.entries(data)) doc[k] = v && typeof v === 'object' && v.__inc !== undefined ? (doc[k] || 0) + v.__inc : v
  }
  return {
    inc: (n) => ({ __inc: n }),
    async getDoc(c, id) { const d = coll(c).get(id); return d ? { ...d } : null },
    async findOne(c, q) { for (const d of coll(c).values()) if (matches(d, q)) return { ...d }; return null },
    async find(c, q = {}) { return [...coll(c).values()].filter((d) => matches(d, q)).map((d) => ({ ...d })) },
    async insert(c, data) { const id = 'id' + ++autoId; coll(c).set(id, { _id: id, ...data }); return id },
    async insertWithId(c, id, data) { if (coll(c).has(id)) return false; coll(c).set(id, { _id: id, ...data }); return true },
    async setDoc(c, id, data) { coll(c).set(id, { _id: id, ...data }) },
    async updateDoc(c, id, data) { const d = coll(c).get(id); if (d) applyData(d, data) },
    async removeDoc(c, id) { coll(c).delete(id) },
    async removeWhere(c, q) { for (const [id, d] of [...coll(c)]) if (matches(d, q)) coll(c).delete(id) },
    async count(c, q = {}) { return (await this.find(c, q)).length },
  }
}
module.exports = { makeFakeDb }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/fakeDb.test.js`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/api/lib/result.js tests/fakeDb.js tests/fakeDb.test.js
git commit -m "feat: result 帮助函数与测试用内存 db"
```

### Task 3: claimAdmin 与 whoami

**Files:**
- Create: `cloudfunctions/api/actions/claimAdmin.js`、`cloudfunctions/api/actions/whoami.js`、`tests/admin-identity.test.js`

- [ ] **Step 1: 写失败测试 `tests/admin-identity.test.js`**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/admin-identity.test.js`
Expected: FAIL（action 文件不存在）

- [ ] **Step 3: 实现两个 action**

```js
// cloudfunctions/api/actions/claimAdmin.js
const { ok, err } = require('../lib/result')
const DEFAULT_CATEGORIES = ['热菜', '凉菜', '汤', '主食', '甜点']

module.exports = async function claimAdmin(ctx) {
  const created = await ctx.db.insertWithId('config', 'main', {
    adminOpenids: [ctx.openid], categories: DEFAULT_CATEGORIES,
  })
  if (created) return ok({ isAdmin: true })
  const cfg = await ctx.db.getDoc('config', 'main')
  if (cfg && cfg.adminOpenids.includes(ctx.openid)) return ok({ isAdmin: true })
  return err('ALREADY_CLAIMED', '主厨之位已有人认领啦')
}
```

```js
// cloudfunctions/api/actions/whoami.js
const { ok } = require('../lib/result')

module.exports = async function whoami(ctx) {
  const cfg = await ctx.db.getDoc('config', 'main')
  return ok({
    openid: ctx.openid,
    claimed: !!cfg,
    isAdmin: !!cfg && cfg.adminOpenids.includes(ctx.openid),
  })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/admin-identity.test.js`
Expected: PASS（5 个用例）

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/api/actions/claimAdmin.js cloudfunctions/api/actions/whoami.js tests/admin-identity.test.js
git commit -m "feat: 管理员认领与身份查询 action"
```

### Task 4: updateProfile

**Files:**
- Create: `cloudfunctions/api/actions/updateProfile.js`、`tests/updateProfile.test.js`

- [ ] **Step 1: 写失败测试 `tests/updateProfile.test.js`**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/updateProfile.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// cloudfunctions/api/actions/updateProfile.js
const { ok, err } = require('../lib/result')

module.exports = async function updateProfile(ctx, payload) {
  const nickname = typeof payload.nickname === 'string' ? payload.nickname.trim() : ''
  if (!nickname || nickname.length > 20) return err('INVALID', '昵称要 1-20 个字')
  const avatar = typeof payload.avatar === 'string' ? payload.avatar : ''
  await ctx.db.setDoc('users', ctx.openid, { nickname, avatar, updatedAt: ctx.now })
  return ok()
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/updateProfile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/api/actions/updateProfile.js tests/updateProfile.test.js
git commit -m "feat: 用户资料保存 action"
```

### Task 5: submitOrder（核心校验逻辑）

**Files:**
- Create: `cloudfunctions/api/actions/submitOrder.js`、`tests/submitOrder.test.js`

- [ ] **Step 1: 写失败测试 `tests/submitOrder.test.js`**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/submitOrder.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// cloudfunctions/api/actions/submitOrder.js
const { ok, err } = require('../lib/result')

module.exports = async function submitOrder(ctx, payload) {
  const { db, openid, now } = ctx
  const profile = await db.getDoc('users', openid)
  if (!profile) return err('NO_PROFILE', '先设置一下昵称头像吧')

  const items = payload.items
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) return err('INVALID', '购物车是空的')
  for (const it of items) {
    if (!it || typeof it.dishId !== 'string' || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > 99) {
      return err('INVALID', '订单数据不对劲')
    }
  }
  const orderNote = typeof payload.orderNote === 'string' ? payload.orderNote.slice(0, 100) : ''
  const headcount = Number.isInteger(payload.headcount) && payload.headcount >= 1 && payload.headcount <= 50 ? payload.headcount : 1

  let event = null
  let mealTime = null
  if (payload.eventId) {
    event = await db.getDoc('events', payload.eventId)
    if (!event) return err('NOT_FOUND', '这场饭局不存在')
    if (event.status !== 'open' || now > event.deadline) return err('EVENT_CLOSED', '手慢了，这场饭局已截止点菜')
  } else {
    if (!Number.isFinite(payload.mealTime)) return err('INVALID', '想什么时候吃？选个时间吧')
    mealTime = payload.mealTime
  }

  const snapshots = []
  const offNames = []
  for (const it of items) {
    const dish = await db.getDoc('dishes', it.dishId)
    if (!dish || dish.status !== 'on') { offNames.push(dish ? dish.name : '已下架的菜'); continue }
    snapshots.push({ dishId: it.dishId, name: dish.name, qty: it.qty, note: typeof it.note === 'string' ? it.note.slice(0, 50) : '' })
  }
  if (offNames.length) return err('DISH_OFF', `「${offNames.join('」「')}」已下架，请移除后再提交`, { names: offNames })

  const orderId = await db.insert('orders', {
    openid, nickname: profile.nickname, avatar: profile.avatar || '',
    eventId: payload.eventId || null, eventTitle: event ? event.title : '',
    items: snapshots, orderNote, mealTime, headcount,
    status: 'new', declineReason: '', createdAt: now, updatedAt: now,
  })
  return ok({ orderId })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/submitOrder.test.js`
Expected: PASS（8 个用例）

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/api/actions/submitOrder.js tests/submitOrder.test.js
git commit -m "feat: 下单 action（含饭局截止与下架菜校验）"
```

### Task 6: toggleLike

**Files:**
- Create: `cloudfunctions/api/actions/toggleLike.js`、`tests/toggleLike.test.js`

- [ ] **Step 1: 写失败测试 `tests/toggleLike.test.js`**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/toggleLike.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// cloudfunctions/api/actions/toggleLike.js
const { ok, err } = require('../lib/result')

module.exports = async function toggleLike(ctx, payload) {
  const { db, openid } = ctx
  const dishId = payload.dishId
  if (typeof dishId !== 'string' || !dishId) return err('INVALID', '参数不对劲')
  const dish = await db.getDoc('dishes', dishId)
  if (!dish) return err('NOT_FOUND', '这道菜不存在了')
  const existing = await db.findOne('likes', { dishId, openid })
  if (existing) {
    await db.removeDoc('likes', existing._id)
    await db.updateDoc('dishes', dishId, { likeCount: db.inc(-1) })
    return ok({ liked: false })
  }
  await db.insert('likes', { dishId, openid, createdAt: ctx.now })
  await db.updateDoc('dishes', dishId, { likeCount: db.inc(1) })
  return ok({ liked: true })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/toggleLike.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/api/actions/toggleLike.js tests/toggleLike.test.js
git commit -m "feat: 菜品点赞 toggle action"
```

### Task 7: submitWish

**Files:**
- Create: `cloudfunctions/api/actions/submitWish.js`、`tests/submitWish.test.js`

- [ ] **Step 1: 写失败测试 `tests/submitWish.test.js`**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/submitWish.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// cloudfunctions/api/actions/submitWish.js
const { ok, err } = require('../lib/result')

module.exports = async function submitWish(ctx, payload) {
  const profile = await ctx.db.getDoc('users', ctx.openid)
  if (!profile) return err('NO_PROFILE', '先设置一下昵称头像吧')
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (!text || text.length > 100) return err('INVALID', '愿望要 1-100 个字')
  const wishId = await ctx.db.insert('wishes', {
    openid: ctx.openid, nickname: profile.nickname, avatar: profile.avatar || '',
    text, status: 'new', reply: '', createdAt: ctx.now,
  })
  return ok({ wishId })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/submitWish.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/api/actions/submitWish.js tests/submitWish.test.js
git commit -m "feat: 想吃许愿 action"
```

### Task 8: adminOp — 鉴权与菜品管理

**Files:**
- Create: `cloudfunctions/api/actions/adminOp.js`、`tests/adminOp-dishes.test.js`

- [ ] **Step 1: 写失败测试 `tests/adminOp-dishes.test.js`**

```js
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
})
```

注意：`likeCount` 不在白名单（`DISH_FIELDS`）中，所以 patch 里的 `likeCount: 999` 应被忽略。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/adminOp-dishes.test.js`
Expected: FAIL

- [ ] **Step 3: 实现（仅鉴权 + 菜品三个 op，饭局/订单/许愿留到 Task 9/10）**

```js
// cloudfunctions/api/actions/adminOp.js
const { ok, err } = require('../lib/result')

const DISH_FIELDS = ['name', 'category', 'photo', 'desc', 'sort', 'status']

async function dishCreate(ctx, p) {
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  if (!name || name.length > 30) return err('INVALID', '菜名要 1-30 个字')
  if (typeof p.category !== 'string' || !p.category) return err('INVALID', '选个分类')
  const dishId = await ctx.db.insert('dishes', {
    name, category: p.category,
    photo: typeof p.photo === 'string' ? p.photo : '',
    desc: typeof p.desc === 'string' ? p.desc.slice(0, 50) : '',
    sort: Number.isFinite(p.sort) ? p.sort : 0,
    status: 'on', likeCount: 0, createdAt: ctx.now, updatedAt: ctx.now,
  })
  return ok({ dishId })
}

async function dishUpdate(ctx, p) {
  const dish = await ctx.db.getDoc('dishes', p.dishId)
  if (!dish) return err('NOT_FOUND', '这道菜不存在了')
  const patch = {}
  for (const k of DISH_FIELDS) if (p.patch && p.patch[k] !== undefined) patch[k] = p.patch[k]
  if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) return err('INVALID', '菜名不能为空')
  if (patch.status !== undefined && !['on', 'off'].includes(patch.status)) return err('INVALID', '状态不对劲')
  patch.updatedAt = ctx.now
  await ctx.db.updateDoc('dishes', p.dishId, patch)
  return ok()
}

async function dishDelete(ctx, p) {
  const dish = await ctx.db.getDoc('dishes', p.dishId)
  if (!dish) return err('NOT_FOUND', '这道菜不存在了')
  await ctx.db.removeDoc('dishes', p.dishId)
  await ctx.db.removeWhere('likes', { dishId: p.dishId })
  return ok()
}

const OPS = { dishCreate, dishUpdate, dishDelete }

module.exports = async function adminOp(ctx, payload) {
  const cfg = await ctx.db.getDoc('config', 'main')
  if (!cfg || !cfg.adminOpenids.includes(ctx.openid)) return err('FORBIDDEN', '需要主厨权限')
  const op = OPS[payload.op]
  if (!op) return err('UNKNOWN_ACTION', '未知管理操作')
  return op(ctx, payload)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/adminOp-dishes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/api/actions/adminOp.js tests/adminOp-dishes.test.js
git commit -m "feat: 管理操作鉴权与菜品管理"
```

### Task 9: adminOp — 饭局管理

**Files:**
- Modify: `cloudfunctions/api/actions/adminOp.js`
- Create: `tests/adminOp-events.test.js`

- [ ] **Step 1: 写失败测试 `tests/adminOp-events.test.js`**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/adminOp-events.test.js`
Expected: FAIL（UNKNOWN_ACTION）

- [ ] **Step 3: 在 `adminOp.js` 中加入两个 op（并注册进 OPS）**

```js
// 加在 dishDelete 之后
const EVENT_TRANSITIONS = { open: ['closed', 'done'], closed: ['done'], done: [] }

async function eventCreate(ctx, p) {
  const title = typeof p.title === 'string' ? p.title.trim() : ''
  if (!title || title.length > 30) return err('INVALID', '饭局名要 1-30 个字')
  if (!Number.isFinite(p.mealTime) || !Number.isFinite(p.deadline)) return err('INVALID', '时间没选对')
  if (p.deadline <= ctx.now) return err('INVALID', '截止时间要晚于现在')
  if (p.deadline > p.mealTime) return err('INVALID', '截止时间要早于开饭时间')
  const eventId = await ctx.db.insert('events', {
    title, mealTime: p.mealTime, deadline: p.deadline,
    note: typeof p.note === 'string' ? p.note.slice(0, 100) : '',
    status: 'open', createdAt: ctx.now,
  })
  return ok({ eventId })
}

async function eventSetStatus(ctx, p) {
  const ev = await ctx.db.getDoc('events', p.eventId)
  if (!ev) return err('NOT_FOUND', '这场饭局不存在')
  if (!(EVENT_TRANSITIONS[ev.status] || []).includes(p.status)) {
    return err('INVALID_TRANSITION', `不能从「${ev.status}」改成「${p.status}」`)
  }
  await ctx.db.updateDoc('events', p.eventId, { status: p.status })
  return ok()
}
```

```js
// OPS 改为
const OPS = { dishCreate, dishUpdate, dishDelete, eventCreate, eventSetStatus }
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `npx vitest run`
Expected: PASS（此前所有用例不回归）

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/api/actions/adminOp.js tests/adminOp-events.test.js
git commit -m "feat: 饭局创建与状态流转"
```

### Task 10: adminOp — 订单状态机与许愿回复

**Files:**
- Modify: `cloudfunctions/api/actions/adminOp.js`
- Create: `tests/adminOp-orders-wishes.test.js`

- [ ] **Step 1: 写失败测试 `tests/adminOp-orders-wishes.test.js`**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/adminOp-orders-wishes.test.js`
Expected: FAIL（UNKNOWN_ACTION）

- [ ] **Step 3: 在 `adminOp.js` 中加入两个 op（并注册进 OPS）**

```js
// 加在 eventSetStatus 之后
const ORDER_TRANSITIONS = { new: ['accepted', 'declined'], accepted: ['done'], done: [], declined: [] }

async function orderSetStatus(ctx, p) {
  const order = await ctx.db.getDoc('orders', p.orderId)
  if (!order) return err('NOT_FOUND', '订单不存在')
  if (!(ORDER_TRANSITIONS[order.status] || []).includes(p.status)) {
    return err('INVALID_TRANSITION', `不能从「${order.status}」改成「${p.status}」`)
  }
  const patch = { status: p.status, updatedAt: ctx.now }
  if (p.status === 'declined') patch.declineReason = typeof p.declineReason === 'string' ? p.declineReason.slice(0, 50) : ''
  await ctx.db.updateDoc('orders', p.orderId, patch)
  return ok()
}

async function wishReply(ctx, p) {
  const wish = await ctx.db.getDoc('wishes', p.wishId)
  if (!wish) return err('NOT_FOUND', '这条愿望不存在')
  if (!['accepted', 'declined'].includes(p.status)) return err('INVALID', '状态不对劲')
  await ctx.db.updateDoc('wishes', p.wishId, {
    status: p.status, reply: typeof p.reply === 'string' ? p.reply.slice(0, 100) : '',
  })
  return ok()
}
```

```js
// OPS 改为最终形态
const OPS = { dishCreate, dishUpdate, dishDelete, eventCreate, eventSetStatus, orderSetStatus, wishReply }
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/api/actions/adminOp.js tests/adminOp-orders-wishes.test.js
git commit -m "feat: 订单状态机与许愿回复"
```

### Task 11: 真实 db 适配器与云函数入口

**Files:**
- Create: `cloudfunctions/api/lib/cloudDb.js`、`cloudfunctions/api/index.js`

无法本地单测（依赖云环境），逻辑保持纯转发；联调在 Task 24 手动清单中验证。

- [ ] **Step 1: 写 `cloudfunctions/api/lib/cloudDb.js`**

```js
// 把 wx-server-sdk 的 database 包装成 actions 使用的注入接口（与 tests/fakeDb.js 同构）
module.exports = function makeDb(db) {
  const _ = db.command
  return {
    inc: (n) => _.inc(n),
    async getDoc(coll, id) {
      try { const r = await db.collection(coll).doc(id).get(); return r.data || null }
      catch (e) { return null }
    },
    async findOne(coll, query) {
      const r = await db.collection(coll).where(query).limit(1).get()
      return r.data[0] || null
    },
    async find(coll, query = {}) {
      const r = await db.collection(coll).where(query).limit(1000).get()
      return r.data
    },
    async insert(coll, data) { const r = await db.collection(coll).add({ data }); return r._id },
    async insertWithId(coll, id, data) {
      try { await db.collection(coll).add({ data: { _id: id, ...data } }); return true }
      catch (e) { return false }
    },
    async setDoc(coll, id, data) { await db.collection(coll).doc(id).set({ data }) },
    async updateDoc(coll, id, data) { await db.collection(coll).doc(id).update({ data }) },
    async removeDoc(coll, id) { await db.collection(coll).doc(id).remove() },
    async removeWhere(coll, query) { await db.collection(coll).where(query).remove() },
    async count(coll, query = {}) { const r = await db.collection(coll).where(query).count(); return r.total },
  }
}
```

- [ ] **Step 2: 写 `cloudfunctions/api/index.js`**

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const makeDb = require('./lib/cloudDb')
const { err } = require('./lib/result')

const ACTIONS = {
  whoami: require('./actions/whoami'),
  claimAdmin: require('./actions/claimAdmin'),
  updateProfile: require('./actions/updateProfile'),
  submitOrder: require('./actions/submitOrder'),
  toggleLike: require('./actions/toggleLike'),
  submitWish: require('./actions/submitWish'),
  adminOp: require('./actions/adminOp'),
}

exports.main = async (event) => {
  const handler = ACTIONS[event.action]
  if (!handler) return err('UNKNOWN_ACTION', '未知操作')
  const { OPENID } = cloud.getWXContext()
  const ctx = { db: makeDb(cloud.database()), openid: OPENID, now: Date.now() }
  try {
    return await handler(ctx, event.payload || {})
  } catch (e) {
    console.error('[api]', event.action, e)
    return err('INTERNAL', '服务开小差了，请稍后再试')
  }
}
```

- [ ] **Step 3: 跑全量测试防回归，Commit**

Run: `npx vitest run` → Expected: 全部 PASS

```bash
git add cloudfunctions/api/lib/cloudDb.js cloudfunctions/api/index.js
git commit -m "feat: 云函数入口与真实 db 适配器"
```

---

## Phase 2：小程序基建

### Task 12: 小程序骨架、TDesign、工具模块

**Files:**
- Create: `project.config.json`、`miniprogram/app.js`、`miniprogram/app.json`、`miniprogram/app.wxss`、`miniprogram/sitemap.json`、`miniprogram/utils/api.js`、`miniprogram/utils/format.js`、`miniprogram/utils/cart.js`、`miniprogram/utils/guard.js`

- [ ] **Step 1: 写 `project.config.json`**（AppID 为占位，部署时替换，见 Task 24 README）

```json
{
  "compileType": "miniprogram",
  "miniprogramRoot": "miniprogram/",
  "cloudfunctionRoot": "cloudfunctions/",
  "appid": "touristappid",
  "projectname": "LiWaPrivateKitchen",
  "setting": { "es6": true, "enhance": true, "postcss": true, "minified": true },
  "libVersion": "3.7.0"
}
```

- [ ] **Step 2: 安装 TDesign**

Run: `cd miniprogram && npm init -y && npm install tdesign-miniprogram && cd ..`
Expected: `miniprogram/package.json` 出现依赖（构建 npm 在开发者工具中做，见 Task 24）

- [ ] **Step 3: 写 `miniprogram/app.js`**

```js
const { call } = require('./utils/api')

App({
  globalData: { cart: [], openid: '', isAdmin: false },
  onLaunch() {
    if (!wx.cloud) return console.error('基础库过低，无法使用云能力')
    wx.cloud.init({ traceUser: true })
    this.whoamiReady = call('whoami')
      .then((d) => {
        this.globalData.openid = d.openid
        this.globalData.isAdmin = d.isAdmin
        if (d.openid && !wx.getStorageSync('profile')) this.restoreProfile(d.openid)
        return d
      })
      .catch(() => ({ openid: '', isAdmin: false, claimed: true }))
  },
  // 换设备/清缓存后从云端恢复资料
  restoreProfile(openid) {
    wx.cloud.database().collection('users').doc(openid).get()
      .then((r) => { if (r.data) wx.setStorageSync('profile', { nickname: r.data.nickname, avatar: r.data.avatar }) })
      .catch(() => {})
  },
})
```

- [ ] **Step 4: 写 `miniprogram/app.json`**（文字 tabBar，无需图标资源）

```json
{
  "pages": [
    "pages/menu/menu",
    "pages/events/events",
    "pages/mine/mine",
    "pages/checkout/checkout",
    "pages/event-detail/event-detail",
    "pages/admin/index/index",
    "pages/admin/orders/orders",
    "pages/admin/dishes/dishes",
    "pages/admin/dish-edit/dish-edit",
    "pages/admin/events/events",
    "pages/admin/wishes/wishes"
  ],
  "window": {
    "navigationBarTitleText": "李娃私厨",
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#f6f6f6"
  },
  "tabBar": {
    "color": "#999999",
    "selectedColor": "#e3592c",
    "list": [
      { "pagePath": "pages/menu/menu", "text": "点菜" },
      { "pagePath": "pages/events/events", "text": "饭局" },
      { "pagePath": "pages/mine/mine", "text": "我的" }
    ]
  },
  "usingComponents": {
    "t-button": "tdesign-miniprogram/button/button",
    "t-input": "tdesign-miniprogram/input/input",
    "t-textarea": "tdesign-miniprogram/textarea/textarea",
    "t-popup": "tdesign-miniprogram/popup/popup",
    "t-stepper": "tdesign-miniprogram/stepper/stepper",
    "t-tag": "tdesign-miniprogram/tag/tag",
    "t-badge": "tdesign-miniprogram/badge/badge",
    "t-empty": "tdesign-miniprogram/empty/empty",
    "t-picker": "tdesign-miniprogram/picker/picker",
    "t-picker-item": "tdesign-miniprogram/picker-item/picker-item",
    "t-date-time-picker": "tdesign-miniprogram/date-time-picker/date-time-picker"
  },
  "style": "v2",
  "lazyCodeLoading": "requiredComponents",
  "sitemapLocation": "sitemap.json"
}
```

- [ ] **Step 5: 写 `miniprogram/sitemap.json`**（私人应用，禁止被微信搜索收录）

```json
{ "rules": [{ "action": "disallow", "page": "*" }] }
```

- [ ] **Step 6: 写 `miniprogram/app.wxss`**

```css
page { background: #f6f6f6; color: #333; font-size: 28rpx; }
.card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin: 16rpx 24rpx; }
.muted { color: #999; font-size: 24rpx; }
.row { display: flex; align-items: center; }
.flex1 { flex: 1; }
.line { padding: 10rpx 0; }
.section-title { font-size: 30rpx; font-weight: 600; }
```

- [ ] **Step 7: 写 `miniprogram/utils/api.js`**

```js
function call(action, payload = {}) {
  return wx.cloud.callFunction({ name: 'api', data: { action, payload } }).then((res) => {
    const r = res.result || {}
    if (!r.ok) {
      const e = new Error(r.msg || '操作失败')
      e.code = r.code
      e.data = r.data
      throw e
    }
    return r.data
  })
}

function toast(msg, icon = 'none') { wx.showToast({ title: msg, icon }) }

// 失败时自动 toast 后继续抛出；调用方用 .catch(() => null) 判断是否成功
function callWithToast(action, payload) {
  return call(action, payload).catch((e) => { toast(e.message || '网络开小差了'); throw e })
}

module.exports = { call, callWithToast, toast }
```

- [ ] **Step 8: 写 `miniprogram/utils/format.js`**

```js
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
```

- [ ] **Step 9: 写 `miniprogram/utils/cart.js`**（购物车放 globalData，跨页共享）

```js
function getCart() { return getApp().globalData.cart }

function setQty(dish, qty) {
  const cart = getCart()
  const dishId = dish._id || dish.dishId
  const idx = cart.findIndex((i) => i.dishId === dishId)
  if (qty <= 0) { if (idx >= 0) cart.splice(idx, 1); return }
  if (idx >= 0) cart[idx].qty = qty
  else cart.push({ dishId, name: dish.name, qty, note: '' })
}

function setNote(dishId, note) {
  const item = getCart().find((i) => i.dishId === dishId)
  if (item) item.note = note
}

function clearCart() { getApp().globalData.cart = [] }
function cartCount() { return getCart().reduce((s, i) => s + i.qty, 0) }
function qtyMap() { const m = {}; for (const i of getCart()) m[i.dishId] = i.qty; return m }

module.exports = { getCart, setQty, setNote, clearCart, cartCount, qtyMap }
```

- [ ] **Step 10: 写 `miniprogram/utils/guard.js`**（管理页客户端守卫；真正的安全在云函数鉴权）

```js
module.exports = async function guard() {
  const app = getApp()
  await app.whoamiReady
  if (app.globalData.isAdmin) return true
  wx.showToast({ title: '需要主厨权限', icon: 'none' })
  setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) }), 600)
  return false
}
```

- [ ] **Step 11: Commit**

```bash
git add project.config.json miniprogram/
git commit -m "feat: 小程序骨架、TDesign 与工具模块"
```

### Task 13: profile-sheet 资料卡组件

**Files:**
- Create: `miniprogram/components/profile-sheet/profile-sheet.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `profile-sheet.js`**

```js
const { call, toast } = require('../../utils/api')

Component({
  properties: { visible: Boolean },
  data: { nickname: '', avatarUrl: '', saving: false },
  lifetimes: {
    attached() {
      const p = wx.getStorageSync('profile')
      if (p) this.setData({ nickname: p.nickname || '', avatarUrl: p.avatar || '' })
    },
  },
  methods: {
    onVisibleChange(e) { if (!e.detail.visible) this.triggerEvent('close') },
    onChooseAvatar(e) { this.setData({ avatarUrl: e.detail.avatarUrl }) },
    onNickname(e) { this.setData({ nickname: e.detail.value }) },
    async onSave() {
      const nickname = this.data.nickname.trim()
      if (!nickname) return toast('先填个昵称吧')
      this.setData({ saving: true })
      try {
        let avatar = this.data.avatarUrl
        if (avatar && !avatar.startsWith('cloud://')) {
          const up = await wx.cloud.uploadFile({
            cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`,
            filePath: avatar,
          })
          avatar = up.fileID
        }
        await call('updateProfile', { nickname, avatar: avatar || '' })
        wx.setStorageSync('profile', { nickname, avatar: avatar || '' })
        toast('保存好啦', 'success')
        this.triggerEvent('saved')
        this.triggerEvent('close')
      } catch (e) {
        toast(e.message || '保存失败')
      }
      this.setData({ saving: false })
    },
  },
})
```

- [ ] **Step 2: 写 `profile-sheet.wxml`**

```xml
<t-popup visible="{{visible}}" placement="bottom" bind:visible-change="onVisibleChange">
  <view class="sheet">
    <view class="sheet-title">怎么称呼你？</view>
    <button class="avatar-btn" open-type="chooseAvatar" bind:chooseavatar="onChooseAvatar">
      <image wx:if="{{avatarUrl}}" class="avatar" src="{{avatarUrl}}" />
      <view wx:else class="avatar avatar-empty">选头像</view>
    </button>
    <input class="nick-input" type="nickname" placeholder="输入昵称（可一键用微信昵称）"
           value="{{nickname}}" bindinput="onNickname" />
    <t-button theme="primary" block loading="{{saving}}" bind:tap="onSave">保存</t-button>
  </view>
</t-popup>
```

- [ ] **Step 3: 写 `profile-sheet.wxss` 与 `profile-sheet.json`**

```css
.sheet { padding: 40rpx 40rpx 60rpx; border-radius: 24rpx 24rpx 0 0; background: #fff; }
.sheet-title { font-size: 34rpx; font-weight: 600; text-align: center; margin-bottom: 32rpx; }
.avatar-btn { background: none; padding: 0; margin: 0 auto 24rpx; width: 140rpx; height: 140rpx; border: none; line-height: 1; }
.avatar-btn::after { border: none; }
.avatar { width: 140rpx; height: 140rpx; border-radius: 50%; }
.avatar-empty { background: #f0f0f0; color: #999; font-size: 24rpx; display: flex; align-items: center; justify-content: center; }
.nick-input { background: #f6f6f6; border-radius: 12rpx; padding: 20rpx 24rpx; margin-bottom: 32rpx; }
```

```json
{ "component": true }
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/components/profile-sheet/
git commit -m "feat: 头像昵称资料卡组件"
```

### Task 14: dish-card 菜品卡片组件

**Files:**
- Create: `miniprogram/components/dish-card/dish-card.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `dish-card.js`**

```js
Component({
  properties: {
    dish: Object,
    qty: { type: Number, value: 0 },
    liked: Boolean,
  },
  methods: {
    onLike() { this.triggerEvent('like', { dish: this.data.dish }) },
    onQty(e) { this.triggerEvent('qty', { dish: this.data.dish, qty: e.detail.value }) },
  },
})
```

- [ ] **Step 2: 写 `dish-card.wxml`**

```xml
<view class="dish-card">
  <image wx:if="{{dish.photo}}" class="photo" src="{{dish.photo}}" mode="aspectFill" />
  <view wx:else class="photo photo-empty">🍳</view>
  <view class="info">
    <view class="name">{{dish.name}}</view>
    <view class="muted" wx:if="{{dish.desc}}">{{dish.desc}}</view>
    <view class="like {{liked ? 'liked' : ''}}" bind:tap="onLike">{{liked ? '❤️' : '🤍'}} {{dish.likeCount || 0}}</view>
  </view>
  <t-stepper class="stepper" theme="filled" min="{{0}}" max="{{99}}" value="{{qty}}" bind:change="onQty" />
</view>
```

- [ ] **Step 3: 写 `dish-card.wxss` 与 `dish-card.json`**

```css
.dish-card { display: flex; align-items: center; background: #fff; border-radius: 16rpx; padding: 20rpx; margin: 16rpx 24rpx; }
.photo { width: 120rpx; height: 120rpx; border-radius: 12rpx; flex-shrink: 0; }
.photo-empty { background: #f3ece4; display: flex; align-items: center; justify-content: center; font-size: 48rpx; }
.info { flex: 1; margin: 0 20rpx; min-width: 0; }
.name { font-size: 30rpx; font-weight: 600; }
.like { margin-top: 8rpx; font-size: 24rpx; color: #999; }
.like.liked { color: #e3592c; }
.stepper { flex-shrink: 0; }
```

```json
{ "component": true }
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/components/dish-card/
git commit -m "feat: 菜品卡片组件"
```

---

## Phase 3：朋友侧页面

### Task 15: 点菜页（menu）

**Files:**
- Create: `miniprogram/pages/menu/menu.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `menu.json`**

```json
{
  "navigationBarTitleText": "李娃私厨",
  "enablePullDownRefresh": true,
  "usingComponents": {
    "dish-card": "/components/dish-card/dish-card",
    "profile-sheet": "/components/profile-sheet/profile-sheet"
  }
}
```

- [ ] **Step 2: 写 `menu.js`**

```js
const { callWithToast } = require('../../utils/api')
const cart = require('../../utils/cart')
const { fmtDateTime } = require('../../utils/format')
const db = wx.cloud.database()

Page({
  data: {
    categories: [], curCat: '', dishes: [], shown: [],
    qtyMap: {}, likedMap: {}, count: 0, cartItems: [],
    activeEvent: null, cartVisible: false, profileVisible: false,
  },
  onShow() { this.loadAll() },
  async loadAll() {
    try {
      const [cfgRes, dishRes, evRes] = await Promise.all([
        db.collection('config').doc('main').get().catch(() => null),
        db.collection('dishes').where({ status: 'on' }).orderBy('sort', 'asc').limit(100).get(),
        db.collection('events').where({ status: 'open' }).orderBy('mealTime', 'asc').limit(10).get(),
      ])
      const dishes = dishRes.data
      const cats = (cfgRes && cfgRes.data.categories) || []
      const categories = cats.filter((c) => dishes.some((d) => d.category === c))
      const now = Date.now()
      const active = evRes.data.find((e) => e.deadline > now) || null
      this.setData({
        dishes, categories,
        curCat: categories.includes(this.data.curCat) ? this.data.curCat : (categories[0] || ''),
        activeEvent: active ? { ...active, deadlineText: fmtDateTime(active.deadline) } : null,
      })
      this.applyFilter()
      this.refreshCart()
      this.loadLikes()
    } catch (e) {
      wx.showToast({ title: '加载失败，下拉重试', icon: 'none' })
    }
  },
  async loadLikes() {
    const { openid } = await getApp().whoamiReady
    if (!openid) return
    const r = await db.collection('likes').where({ openid }).limit(1000).get().catch(() => ({ data: [] }))
    const likedMap = {}
    for (const l of r.data) likedMap[l.dishId] = true
    this.setData({ likedMap })
  },
  applyFilter() {
    const { dishes, curCat } = this.data
    this.setData({ shown: curCat ? dishes.filter((d) => d.category === curCat) : dishes })
  },
  onCat(e) { this.setData({ curCat: e.currentTarget.dataset.cat }); this.applyFilter() },
  refreshCart() { this.setData({ qtyMap: cart.qtyMap(), count: cart.cartCount(), cartItems: cart.getCart() }) },
  onQty(e) { cart.setQty(e.detail.dish, e.detail.qty); this.refreshCart() },
  onCartQty(e) { cart.setQty({ dishId: e.currentTarget.dataset.dishid }, e.detail.value); this.refreshCart() },
  onItemNote(e) { cart.setNote(e.currentTarget.dataset.dishid, e.detail.value) },
  ensureProfile() {
    if (wx.getStorageSync('profile')) return true
    this.setData({ profileVisible: true })
    return false
  },
  onProfileClose() { this.setData({ profileVisible: false }) },
  async onLike(e) {
    if (!this.ensureProfile()) return
    const dish = e.detail.dish
    const d = await callWithToast('toggleLike', { dishId: dish._id }).catch(() => null)
    if (!d) return
    const dishes = this.data.dishes.map((x) =>
      x._id === dish._id ? { ...x, likeCount: (x.likeCount || 0) + (d.liked ? 1 : -1) } : x)
    this.setData({ dishes, ['likedMap.' + dish._id]: d.liked })
    this.applyFilter()
  },
  openCart() { if (this.data.count > 0) this.setData({ cartVisible: true, cartItems: cart.getCart() }) },
  onCartVisible(e) { if (!e.detail.visible) this.setData({ cartVisible: false }) },
  clearAll() { cart.clearCart(); this.refreshCart(); this.setData({ cartVisible: false }) },
  goCheckout() {
    if (cart.cartCount() === 0) return wx.showToast({ title: '先选几道菜吧', icon: 'none' })
    this.setData({ cartVisible: false })
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },
  onPullDownRefresh() { this.loadAll().then(() => wx.stopPullDownRefresh()) },
})
```

- [ ] **Step 3: 写 `menu.wxml`**

```xml
<view wx:if="{{activeEvent}}" class="banner">
  🍲 「{{activeEvent.title}}」饭局点菜中 · 截止 {{activeEvent.deadlineText}}
</view>

<scroll-view scroll-x class="cats" enable-flex>
  <view wx:for="{{categories}}" wx:key="*this"
        class="chip {{curCat === item ? 'chip-on' : ''}}"
        data-cat="{{item}}" bind:tap="onCat">{{item}}</view>
</scroll-view>

<view wx:if="{{!shown.length}}" class="card muted">主厨还没上菜，敬请期待～</view>
<dish-card wx:for="{{shown}}" wx:key="_id" dish="{{item}}"
           qty="{{qtyMap[item._id] || 0}}" liked="{{likedMap[item._id]}}"
           bind:like="onLike" bind:qty="onQty" />

<view class="cart-bar" bind:tap="openCart">
  <view class="flex1">🛒 已选 {{count}} 份</view>
  <t-button size="small" theme="primary" disabled="{{!count}}" catch:tap="goCheckout">去下单</t-button>
</view>

<t-popup visible="{{cartVisible}}" placement="bottom" bind:visible-change="onCartVisible">
  <view class="cart-pop">
    <view class="row">
      <view class="flex1 section-title">已选的菜</view>
      <view class="muted" bind:tap="clearAll">清空</view>
    </view>
    <view wx:for="{{cartItems}}" wx:key="dishId" class="cart-item">
      <view class="row">
        <view class="flex1">{{item.name}}</view>
        <t-stepper theme="filled" min="{{0}}" value="{{item.qty}}"
                   data-dishid="{{item.dishId}}" bind:change="onCartQty" />
      </view>
      <input class="note-input" placeholder="备注：少辣 / 不要香菜…" value="{{item.note}}"
             data-dishid="{{item.dishId}}" bindinput="onItemNote" />
    </view>
    <t-button block theme="primary" bind:tap="goCheckout">去下单</t-button>
  </view>
</t-popup>

<profile-sheet visible="{{profileVisible}}" bind:close="onProfileClose" />
```

- [ ] **Step 4: 写 `menu.wxss`**

```css
.banner { background: #fff3ec; border: 1rpx solid #f0c3ab; color: #c4501f; border-radius: 12rpx; padding: 16rpx 24rpx; margin: 16rpx 24rpx; font-size: 26rpx; }
.cats { white-space: nowrap; padding: 8rpx 24rpx; }
.chip { display: inline-block; background: #fff; border-radius: 28rpx; padding: 10rpx 28rpx; margin-right: 16rpx; font-size: 26rpx; color: #666; }
.chip-on { background: #e3592c; color: #fff; font-weight: 600; }
.cart-bar { position: fixed; left: 24rpx; right: 24rpx; bottom: 24rpx; background: #2d2d2d; color: #fff; border-radius: 40rpx; padding: 16rpx 16rpx 16rpx 32rpx; display: flex; align-items: center; z-index: 10; }
page { padding-bottom: 140rpx; }
.cart-pop { background: #fff; border-radius: 24rpx 24rpx 0 0; padding: 32rpx; max-height: 70vh; overflow-y: auto; }
.cart-item { border-bottom: 1rpx solid #f0f0f0; padding: 16rpx 0; }
.note-input { background: #f6f6f6; border-radius: 8rpx; padding: 12rpx 16rpx; margin-top: 12rpx; font-size: 24rpx; }
.cart-pop .t-button { margin-top: 24rpx; }
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/menu/
git commit -m "feat: 点菜页（菜单、点赞、购物车、饭局横幅）"
```

### Task 16: 下单页（checkout）

**Files:**
- Create: `miniprogram/pages/checkout/checkout.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `checkout.json`**

```json
{
  "navigationBarTitleText": "确认下单",
  "usingComponents": { "profile-sheet": "/components/profile-sheet/profile-sheet" }
}
```

- [ ] **Step 2: 写 `checkout.js`**

```js
const { call, toast } = require('../../utils/api')
const cart = require('../../utils/cart')
const { fmtDateTime } = require('../../utils/format')
const db = wx.cloud.database()

const SLOTS = [{ label: '午餐 12:00', hour: 12 }, { label: '晚餐 18:00', hour: 18 }]
const DAY = 86400000

Page({
  data: {
    items: [], openEvent: null, forEvent: false,
    dateOptions: [], dateIndex: 0, slots: SLOTS.map((s) => s.label), slotIndex: 1,
    headcount: 1, orderNote: '', submitting: false, profileVisible: false,
  },
  async onLoad() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const names = ['今天', '明天', '后天']
    const dateOptions = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() + i * DAY)
      dateOptions.push({ ts: d.getTime(), label: `${names[i] || ''}${i < 3 ? ' ' : ''}${d.getMonth() + 1}/${d.getDate()}` })
    }
    this.setData({ items: cart.getCart(), dateOptions })
    const r = await db.collection('events').where({ status: 'open' }).limit(10).get().catch(() => ({ data: [] }))
    const open = r.data.find((e) => e.deadline > Date.now()) || null
    if (open) this.setData({ openEvent: { ...open, mealText: fmtDateTime(open.mealTime) }, forEvent: true })
  },
  onMode(e) { this.setData({ forEvent: e.currentTarget.dataset.mode === 'event' }) },
  onDate(e) { this.setData({ dateIndex: Number(e.detail.value) }) },
  onSlot(e) { this.setData({ slotIndex: Number(e.detail.value) }) },
  onHeadcount(e) { this.setData({ headcount: e.detail.value }) },
  onNote(e) { this.setData({ orderNote: e.detail.value }) },
  ensureProfile() {
    if (wx.getStorageSync('profile')) return true
    this.setData({ profileVisible: true })
    return false
  },
  onProfileClose() { this.setData({ profileVisible: false }) },
  async submit() {
    if (!this.ensureProfile()) return
    const { items, forEvent, openEvent, dateOptions, dateIndex, slotIndex, headcount, orderNote } = this.data
    if (!items.length) return toast('购物车是空的')
    const payload = {
      items: items.map((i) => ({ dishId: i.dishId, qty: i.qty, note: i.note || '' })),
      orderNote, headcount,
    }
    if (forEvent && openEvent) payload.eventId = openEvent._id
    else payload.mealTime = dateOptions[dateIndex].ts + SLOTS[slotIndex].hour * 3600000
    this.setData({ submitting: true })
    try {
      await call('submitOrder', payload)
      cart.clearCart()
      wx.showModal({
        title: '下单成功', content: '主厨已收到你的菜单 🍳', showCancel: false,
        success: () => wx.switchTab({ url: '/pages/mine/mine' }),
      })
    } catch (e) {
      toast(e.message || '下单失败')
    }
    this.setData({ submitting: false })
  },
})
```

- [ ] **Step 3: 写 `checkout.wxml`**

```xml
<view class="card">
  <view class="section-title">菜单</view>
  <view wx:for="{{items}}" wx:key="dishId" class="row line">
    <view class="flex1">{{item.name}}<text wx:if="{{item.note}}" class="muted">（{{item.note}}）</text></view>
    <view>×{{item.qty}}</view>
  </view>
</view>

<view class="card" wx:if="{{openEvent}}">
  <view class="section-title">这单算到</view>
  <view class="mode {{forEvent ? 'mode-on' : ''}}" data-mode="event" bind:tap="onMode">
    🍲 「{{openEvent.title}}」饭局（{{openEvent.mealText}} 开饭）
  </view>
  <view class="mode {{!forEvent ? 'mode-on' : ''}}" data-mode="anytime" bind:tap="onMode">📅 随时单（自选时间）</view>
</view>

<view class="card" wx:if="{{!forEvent || !openEvent}}">
  <view class="section-title">什么时候吃</view>
  <picker mode="selector" range="{{dateOptions}}" range-key="label" value="{{dateIndex}}" bindchange="onDate">
    <view class="picker-cell">{{dateOptions[dateIndex].label}} ›</view>
  </picker>
  <picker mode="selector" range="{{slots}}" value="{{slotIndex}}" bindchange="onSlot">
    <view class="picker-cell">{{slots[slotIndex]}} ›</view>
  </picker>
</view>

<view class="card row">
  <view class="flex1">{{forEvent && openEvent ? '我带几个人来' : '几个人吃'}}</view>
  <t-stepper theme="filled" min="{{1}}" max="{{50}}" value="{{headcount}}" bind:change="onHeadcount" />
</view>

<view class="card">
  <t-textarea placeholder="整单备注：忌口、过敏、特别要求…" value="{{orderNote}}"
              maxlength="{{100}}" indicator bind:change="onNote" />
</view>

<view class="footer">
  <t-button block theme="primary" loading="{{submitting}}" bind:tap="submit">提交给主厨</t-button>
</view>

<profile-sheet visible="{{profileVisible}}" bind:close="onProfileClose" />
```

- [ ] **Step 4: 写 `checkout.wxss`**

```css
.section-title { margin-bottom: 16rpx; }
.mode { border: 2rpx solid #eee; border-radius: 12rpx; padding: 20rpx; margin-top: 16rpx; }
.mode-on { border-color: #e3592c; background: #fff3ec; }
.picker-cell { padding: 20rpx 0; border-bottom: 1rpx solid #f0f0f0; }
.footer { padding: 24rpx; }
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/checkout/
git commit -m "feat: 下单确认页（饭局归属选择、时间人数备注）"
```

### Task 17: 饭局列表页与饭局详情页

**Files:**
- Create: `miniprogram/pages/events/events.{js,wxml,wxss,json}`、`miniprogram/pages/event-detail/event-detail.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `events.json` 与 `events.js`**

```json
{ "navigationBarTitleText": "饭局", "enablePullDownRefresh": true, "usingComponents": {} }
```

```js
const { fmtDateTime, eventStatusText } = require('../../utils/format')
const db = wx.cloud.database()

Page({
  data: { events: [] },
  onShow() { this.load() },
  async load() {
    const r = await db.collection('events').orderBy('mealTime', 'desc').limit(50).get().catch(() => ({ data: [] }))
    const now = Date.now()
    this.setData({
      events: r.data.map((e) => ({
        ...e,
        mealText: fmtDateTime(e.mealTime),
        deadlineText: fmtDateTime(e.deadline),
        statusText: eventStatusText(e, now),
        isOpen: eventStatusText(e, now) === '点菜中',
      })),
    })
  },
  go(e) { wx.navigateTo({ url: '/pages/event-detail/event-detail?id=' + e.currentTarget.dataset.id }) },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()) },
})
```

- [ ] **Step 2: 写 `events.wxml` 与 `events.wxss`**

```xml
<t-empty wx:if="{{!events.length}}" description="还没有饭局，等主厨发起吧" />
<view wx:for="{{events}}" wx:key="_id" class="card" data-id="{{item._id}}" bind:tap="go">
  <view class="row">
    <view class="flex1 section-title">{{item.title}}</view>
    <t-tag theme="{{item.isOpen ? 'warning' : 'default'}}" variant="light">{{item.statusText}}</t-tag>
  </view>
  <view class="muted" style="margin-top:8rpx">用餐 {{item.mealText}} · 截止 {{item.deadlineText}}</view>
  <view class="muted" wx:if="{{item.note}}">{{item.note}}</view>
</view>
```

```css
/* events 复用全局样式即可 */
```

- [ ] **Step 3: 写 `event-detail.json` 与 `event-detail.js`**

```json
{ "navigationBarTitleText": "饭局详情", "enablePullDownRefresh": true, "usingComponents": {} }
```

```js
const { fmtDateTime, eventStatusText } = require('../../utils/format')
const db = wx.cloud.database()

Page({
  data: { ev: null, statusText: '', isOpen: false, people: [], summary: [] },
  onLoad(q) { this.id = q.id },
  onShow() { this.load() },
  async load() {
    try {
      const [evRes, odRes] = await Promise.all([
        db.collection('events').doc(this.id).get(),
        db.collection('orders').where({ eventId: this.id }).orderBy('createdAt', 'asc').limit(100).get(),
      ])
      const ev = evRes.data
      const now = Date.now()
      const orders = odRes.data.filter((o) => o.status !== 'declined')
      const byPerson = new Map()
      const agg = new Map()
      for (const o of orders) {
        if (!byPerson.has(o.openid)) {
          byPerson.set(o.openid, { openid: o.openid, nickname: o.nickname, avatar: o.avatar, items: [], notes: [], extra: 0 })
        }
        const p = byPerson.get(o.openid)
        p.items.push(...o.items)
        if (o.orderNote) p.notes.push(o.orderNote)
        p.extra = Math.max(p.extra, (o.headcount || 1) - 1)
        for (const it of o.items) agg.set(it.name, (agg.get(it.name) || 0) + it.qty)
      }
      this.setData({
        ev: { ...ev, mealText: fmtDateTime(ev.mealTime), deadlineText: fmtDateTime(ev.deadline) },
        statusText: eventStatusText(ev, now),
        isOpen: eventStatusText(ev, now) === '点菜中',
        people: [...byPerson.values()],
        summary: [...agg.entries()].map(([name, qty]) => ({ name, qty })),
      })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },
  goOrder() { wx.switchTab({ url: '/pages/menu/menu' }) },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()) },
})
```

- [ ] **Step 4: 写 `event-detail.wxml` 与 `event-detail.wxss`**

```xml
<view class="card" wx:if="{{ev}}">
  <view class="row">
    <view class="flex1 section-title">{{ev.title}}</view>
    <t-tag theme="{{isOpen ? 'warning' : 'default'}}" variant="light">{{statusText}}</t-tag>
  </view>
  <view class="muted" style="margin-top:8rpx">用餐 {{ev.mealText}} · 截止 {{ev.deadlineText}}</view>
  <view class="muted" wx:if="{{ev.note}}">{{ev.note}}</view>
</view>

<view class="card" wx:if="{{summary.length}}">
  <view class="section-title">菜品汇总</view>
  <view wx:for="{{summary}}" wx:key="name" class="row line">
    <view class="flex1">{{item.name}}</view><view>×{{item.qty}}</view>
  </view>
</view>

<view class="section-title" style="margin:24rpx 24rpx 0" wx:if="{{people.length}}">大家点的菜</view>
<t-empty wx:if="{{!people.length}}" description="还没人点菜，抢个头香？" />
<view wx:for="{{people}}" wx:key="openid" class="card">
  <view class="row">
    <image wx:if="{{item.avatar}}" class="p-avatar" src="{{item.avatar}}" />
    <view wx:else class="p-avatar p-avatar-empty">👤</view>
    <view class="flex1" style="margin-left:16rpx; font-weight:600">{{item.nickname}}</view>
    <view class="muted" wx:if="{{item.extra}}">+{{item.extra}} 人同来</view>
  </view>
  <view wx:for="{{item.items}}" wx:for-item="dish" wx:key="index" class="muted" style="margin-top:8rpx">
    {{dish.name}} ×{{dish.qty}}<text wx:if="{{dish.note}}">「{{dish.note}}」</text>
  </view>
  <view wx:for="{{item.notes}}" wx:for-item="note" wx:key="*this" class="muted">📝 {{note}}</view>
</view>

<view class="footer" wx:if="{{isOpen}}">
  <t-button block theme="primary" bind:tap="goOrder">去点菜</t-button>
</view>
```

```css
.p-avatar { width: 64rpx; height: 64rpx; border-radius: 50%; }
.p-avatar-empty { background: #f0f0f0; display: flex; align-items: center; justify-content: center; }
.footer { padding: 24rpx; }
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/events/ miniprogram/pages/event-detail/
git commit -m "feat: 饭局列表与围观详情页"
```

### Task 18: 我的页（mine）

**Files:**
- Create: `miniprogram/pages/mine/mine.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `mine.json`**

```json
{
  "navigationBarTitleText": "我的",
  "enablePullDownRefresh": true,
  "usingComponents": { "profile-sheet": "/components/profile-sheet/profile-sheet" }
}
```

- [ ] **Step 2: 写 `mine.js`**

```js
const { callWithToast, toast } = require('../../utils/api')
const { fmtDateTime, orderStatusText, orderStatusTheme, wishStatusText } = require('../../utils/format')
const db = wx.cloud.database()

Page({
  data: {
    profile: null, orders: [], wishes: [],
    isAdmin: false, claimed: true, newCount: 0,
    profileVisible: false, wishVisible: false, wishText: '',
  },
  async onShow() {
    this.setData({ profile: wx.getStorageSync('profile') || null })
    const app = getApp()
    const who = await app.whoamiReady
    const isAdmin = app.globalData.isAdmin || who.isAdmin
    this.setData({ isAdmin, claimed: who.claimed !== false })
    if (who.openid) this.loadMine(who.openid)
    if (isAdmin) this.loadBadge()
  },
  async loadMine(openid) {
    const [od, ws] = await Promise.all([
      db.collection('orders').where({ openid }).orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ data: [] })),
      db.collection('wishes').where({ openid }).orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ data: [] })),
    ])
    this.setData({
      orders: od.data.map((o) => ({
        ...o,
        title: o.eventId ? '🍲 ' + o.eventTitle : '📅 ' + fmtDateTime(o.mealTime),
        itemsText: o.items.map((i) => i.name + '×' + i.qty).join('、'),
        statusText: orderStatusText(o.status),
        statusTheme: orderStatusTheme(o.status),
      })),
      wishes: ws.data.map((w) => ({ ...w, statusText: wishStatusText(w.status) })),
    })
  },
  async loadBadge() {
    const r = await db.collection('orders').where({ status: 'new' }).count().catch(() => ({ total: 0 }))
    this.setData({ newCount: r.total })
  },
  editProfile() { this.setData({ profileVisible: true }) },
  onProfileClose() { this.setData({ profileVisible: false, profile: wx.getStorageSync('profile') || null }) },
  openWish() {
    if (!wx.getStorageSync('profile')) return this.setData({ profileVisible: true })
    this.setData({ wishVisible: true })
  },
  onWishVisible(e) { if (!e.detail.visible) this.setData({ wishVisible: false }) },
  onWishText(e) { this.setData({ wishText: e.detail.value }) },
  async sendWish() {
    const text = this.data.wishText.trim()
    if (!text) return toast('想吃什么写一句吧')
    const d = await callWithToast('submitWish', { text }).catch(() => null)
    if (d === null) return
    this.setData({ wishVisible: false, wishText: '' })
    toast('愿望已送达 🌠', 'success')
    const who = await getApp().whoamiReady
    if (who.openid) this.loadMine(who.openid)
  },
  async claim() {
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: '认领主厨之位',
      content: '只有第一个认领的人会成为主厨，确定是你吗？',
      success: (r) => resolve(r.confirm),
    }))
    if (!confirmed) return
    const d = await callWithToast('claimAdmin', {}).catch(() => null)
    if (d === null) return
    getApp().globalData.isAdmin = true
    this.setData({ isAdmin: true, claimed: true })
    toast('你已是主厨 👨‍🍳', 'success')
  },
  goAdmin() { wx.navigateTo({ url: '/pages/admin/index/index' }) },
  onPullDownRefresh() { this.onShow().then(() => wx.stopPullDownRefresh()) },
})
```

- [ ] **Step 3: 写 `mine.wxml`**

```xml
<view class="card row" bind:tap="editProfile">
  <image wx:if="{{profile.avatar}}" class="me-avatar" src="{{profile.avatar}}" />
  <view wx:else class="me-avatar me-avatar-empty">👤</view>
  <view class="flex1" style="margin-left:20rpx">
    <view style="font-weight:600">{{profile ? profile.nickname : '点这里设置昵称头像'}}</view>
    <view class="muted">点击修改资料</view>
  </view>
</view>

<view class="card row" wx:if="{{isAdmin}}" bind:tap="goAdmin">
  <view class="flex1 section-title">👨‍🍳 主厨入口</view>
  <t-badge count="{{newCount}}" max-count="{{99}}"><view class="muted">进入管理 ›</view></t-badge>
</view>
<view class="card row" wx:elif="{{!claimed}}" bind:tap="claim">
  <view class="flex1 section-title">👨‍🍳 认领主厨之位</view>
  <view class="muted">仅限第一人 ›</view>
</view>

<view class="section-title" style="margin:24rpx 24rpx 0">我的订单</view>
<t-empty wx:if="{{!orders.length}}" description="还没点过菜" />
<view wx:for="{{orders}}" wx:key="_id" class="card">
  <view class="row">
    <view class="flex1">{{item.title}}</view>
    <t-tag theme="{{item.statusTheme}}" variant="light">{{item.statusText}}</t-tag>
  </view>
  <view class="muted" style="margin-top:8rpx">{{item.itemsText}}</view>
  <view class="muted" wx:if="{{item.status === 'declined' && item.declineReason}}">主厨说：{{item.declineReason}}</view>
</view>

<view class="row" style="margin:24rpx 24rpx 0">
  <view class="flex1 section-title">想吃许愿 🌠</view>
  <t-button size="small" variant="outline" bind:tap="openWish">我要许愿</t-button>
</view>
<t-empty wx:if="{{!wishes.length}}" description="还没许过愿" />
<view wx:for="{{wishes}}" wx:key="_id" class="card">
  <view class="row">
    <view class="flex1">「{{item.text}}」</view>
    <view class="muted">{{item.statusText}}</view>
  </view>
  <view class="muted" wx:if="{{item.reply}}">主厨：{{item.reply}}</view>
</view>

<t-popup visible="{{wishVisible}}" placement="bottom" bind:visible-change="onWishVisible">
  <view class="wish-pop">
    <view class="section-title" style="margin-bottom:16rpx">想吃什么？</view>
    <t-textarea placeholder="菜单上没有但想吃的菜…" value="{{wishText}}" maxlength="{{100}}" indicator bind:change="onWishText" />
    <t-button block theme="primary" style="margin-top:24rpx" bind:tap="sendWish">送出愿望</t-button>
  </view>
</t-popup>

<profile-sheet visible="{{profileVisible}}" bind:close="onProfileClose" />
```

- [ ] **Step 4: 写 `mine.wxss`**

```css
.me-avatar { width: 96rpx; height: 96rpx; border-radius: 50%; }
.me-avatar-empty { background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 40rpx; }
.wish-pop { background: #fff; border-radius: 24rpx 24rpx 0 0; padding: 32rpx 32rpx 48rpx; }
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/mine/
git commit -m "feat: 我的页（订单、许愿、资料、主厨认领与入口）"
```

---

## Phase 4：管理侧页面

### Task 19: 管理首页（admin/index）

**Files:**
- Create: `miniprogram/pages/admin/index/index.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `index.json`**

```json
{ "navigationBarTitleText": "主厨管理", "usingComponents": {} }
```

- [ ] **Step 2: 写 `index.js`**

```js
const guard = require('../../../utils/guard')
const db = wx.cloud.database()

Page({
  data: { newOrders: 0, dishCount: 0, openEvents: 0, newWishes: 0 },
  async onShow() {
    if (!(await guard())) return
    const c = (coll, q) => {
      let col = db.collection(coll)
      if (q) col = col.where(q)
      return col.count().then((r) => r.total).catch(() => 0)
    }
    const [newOrders, dishCount, openEvents, newWishes] = await Promise.all([
      c('orders', { status: 'new' }), c('dishes', null), c('events', { status: 'open' }), c('wishes', { status: 'new' }),
    ])
    this.setData({ newOrders, dishCount, openEvents, newWishes })
  },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
})
```

- [ ] **Step 3: 写 `index.wxml` 与 `index.wxss`**

```xml
<view class="card row" data-url="/pages/admin/orders/orders" bind:tap="go">
  <view class="flex1 section-title">📋 订单管理</view>
  <view class="muted">{{newOrders ? newOrders + ' 个新订单' : '没有新订单'}} ›</view>
</view>
<view class="card row" data-url="/pages/admin/dishes/dishes" bind:tap="go">
  <view class="flex1 section-title">🍳 菜品管理</view>
  <view class="muted">{{dishCount}} 道菜 ›</view>
</view>
<view class="card row" data-url="/pages/admin/events/events" bind:tap="go">
  <view class="flex1 section-title">🍲 饭局管理</view>
  <view class="muted">{{openEvents ? openEvents + ' 场进行中' : '无进行中' }} ›</view>
</view>
<view class="card row" data-url="/pages/admin/wishes/wishes" bind:tap="go">
  <view class="flex1 section-title">🌠 许愿箱</view>
  <view class="muted">{{newWishes ? newWishes + ' 条新愿望' : '没有新愿望'}} ›</view>
</view>
```

```css
/* 复用全局样式 */
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/pages/admin/index/
git commit -m "feat: 管理首页"
```

### Task 20: 订单管理（admin/orders）

**Files:**
- Create: `miniprogram/pages/admin/orders/orders.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `orders.json`**

```json
{ "navigationBarTitleText": "订单管理", "enablePullDownRefresh": true, "usingComponents": {} }
```

- [ ] **Step 2: 写 `orders.js`**

```js
const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const { fmtDateTime, orderStatusText, orderStatusTheme } = require('../../../utils/format')
const db = wx.cloud.database()

Page({
  data: { orders: [] },
  async onShow() { if (await guard()) this.load() },
  async load() {
    const r = await db.collection('orders').orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ data: [] }))
    this.setData({
      orders: r.data.map((o) => ({
        ...o,
        timeText: o.eventId ? '🍲 ' + o.eventTitle : '📅 ' + fmtDateTime(o.mealTime),
        createdText: fmtDateTime(o.createdAt),
        statusText: orderStatusText(o.status),
        statusTheme: orderStatusTheme(o.status),
      })),
    })
  },
  async setStatus(e) {
    const { id, status } = e.currentTarget.dataset
    let declineReason = ''
    if (status === 'declined') {
      const res = await new Promise((resolve) => wx.showModal({
        title: '婉拒原因', editable: true, placeholderText: '比如：这周食材买不到啦', success: (r) => resolve(r),
      }))
      if (!res.confirm) return
      declineReason = res.content || ''
    }
    const d = await callWithToast('adminOp', { op: 'orderSetStatus', orderId: id, status, declineReason }).catch(() => null)
    if (d !== null) this.load()
  },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()) },
})
```

- [ ] **Step 3: 写 `orders.wxml` 与 `orders.wxss`**

```xml
<t-empty wx:if="{{!orders.length}}" description="还没有订单" />
<view wx:for="{{orders}}" wx:key="_id" class="card">
  <view class="row">
    <image wx:if="{{item.avatar}}" class="o-avatar" src="{{item.avatar}}" />
    <view class="flex1" style="margin-left:12rpx; font-weight:600">{{item.nickname}}</view>
    <t-tag theme="{{item.statusTheme}}" variant="light">{{item.statusText}}</t-tag>
  </view>
  <view class="muted" style="margin-top:8rpx">{{item.timeText}} · {{item.headcount}} 人 · 下单于 {{item.createdText}}</view>
  <view wx:for="{{item.items}}" wx:for-item="dish" wx:key="index" class="line">
    {{dish.name}} ×{{dish.qty}}<text wx:if="{{dish.note}}" class="muted">「{{dish.note}}」</text>
  </view>
  <view class="muted" wx:if="{{item.orderNote}}">📝 {{item.orderNote}}</view>
  <view class="row btns" wx:if="{{item.status === 'new' || item.status === 'accepted'}}">
    <block wx:if="{{item.status === 'new'}}">
      <t-button size="small" theme="primary" data-id="{{item._id}}" data-status="accepted" bind:tap="setStatus">接单</t-button>
      <t-button size="small" variant="outline" data-id="{{item._id}}" data-status="declined" bind:tap="setStatus">婉拒</t-button>
    </block>
    <t-button wx:if="{{item.status === 'accepted'}}" size="small" theme="success"
              data-id="{{item._id}}" data-status="done" bind:tap="setStatus">做完了</t-button>
  </view>
</view>
```

```css
.o-avatar { width: 56rpx; height: 56rpx; border-radius: 50%; }
.btns { gap: 16rpx; margin-top: 16rpx; }
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/pages/admin/orders/
git commit -m "feat: 订单管理（接单/婉拒/做完）"
```

### Task 21: 菜品管理（admin/dishes + admin/dish-edit）

**Files:**
- Create: `miniprogram/pages/admin/dishes/dishes.{js,wxml,wxss,json}`、`miniprogram/pages/admin/dish-edit/dish-edit.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `dishes.json` 与 `dishes.js`**

```json
{ "navigationBarTitleText": "菜品管理", "enablePullDownRefresh": true, "usingComponents": {} }
```

```js
const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const db = wx.cloud.database()

Page({
  data: { dishes: [] },
  async onShow() { if (await guard()) this.load() },
  async load() {
    const r = await db.collection('dishes').orderBy('sort', 'asc').limit(100).get().catch(() => ({ data: [] }))
    this.setData({ dishes: r.data })
  },
  add() { wx.navigateTo({ url: '/pages/admin/dish-edit/dish-edit' }) },
  edit(e) { wx.navigateTo({ url: '/pages/admin/dish-edit/dish-edit?id=' + e.currentTarget.dataset.id }) },
  async toggle(e) {
    const { id, status } = e.currentTarget.dataset
    const d = await callWithToast('adminOp', {
      op: 'dishUpdate', dishId: id, patch: { status: status === 'on' ? 'off' : 'on' },
    }).catch(() => null)
    if (d !== null) this.load()
  },
  async remove(e) {
    const { id, name } = e.currentTarget.dataset
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: '删除「' + name + '」？', content: '历史订单不受影响', success: (r) => resolve(r.confirm),
    }))
    if (!confirmed) return
    const d = await callWithToast('adminOp', { op: 'dishDelete', dishId: id }).catch(() => null)
    if (d !== null) this.load()
  },
})
```

- [ ] **Step 2: 写 `dishes.wxml` 与 `dishes.wxss`**

```xml
<view class="card row" bind:tap="add">
  <view class="flex1 section-title">＋ 上新菜</view>
</view>
<view wx:for="{{dishes}}" wx:key="_id" class="card">
  <view class="row">
    <image wx:if="{{item.photo}}" class="d-photo" src="{{item.photo}}" mode="aspectFill" />
    <view wx:else class="d-photo d-photo-empty">🍳</view>
    <view class="flex1" style="margin-left:16rpx">
      <view style="font-weight:600">{{item.name}}</view>
      <view class="muted">{{item.category}} · ❤️ {{item.likeCount || 0}}</view>
    </view>
    <t-tag theme="{{item.status === 'on' ? 'success' : 'default'}}" variant="light">{{item.status === 'on' ? '在售' : '下架'}}</t-tag>
  </view>
  <view class="row btns">
    <t-button size="small" variant="outline" data-id="{{item._id}}" bind:tap="edit">编辑</t-button>
    <t-button size="small" variant="outline" data-id="{{item._id}}" data-status="{{item.status}}" bind:tap="toggle">
      {{item.status === 'on' ? '下架' : '上架'}}
    </t-button>
    <t-button size="small" variant="outline" theme="danger" data-id="{{item._id}}" data-name="{{item.name}}" bind:tap="remove">删除</t-button>
  </view>
</view>
```

```css
.d-photo { width: 88rpx; height: 88rpx; border-radius: 12rpx; }
.d-photo-empty { background: #f3ece4; display: flex; align-items: center; justify-content: center; }
.btns { gap: 16rpx; margin-top: 16rpx; }
```

- [ ] **Step 3: 写 `dish-edit.json` 与 `dish-edit.js`**

```json
{ "navigationBarTitleText": "编辑菜品", "usingComponents": {} }
```

```js
const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const db = wx.cloud.database()

Page({
  data: {
    id: '', name: '', category: '', desc: '', sort: 0, photo: '',
    categories: [], catOptions: [], catVisible: false, saving: false,
  },
  async onLoad(q) {
    if (!(await guard())) return
    const cfg = await db.collection('config').doc('main').get().catch(() => null)
    const categories = cfg ? cfg.data.categories : []
    this.setData({ categories, catOptions: categories.map((c) => ({ label: c, value: c })) })
    if (q.id) {
      const r = await db.collection('dishes').doc(q.id).get()
      const d = r.data
      this.setData({ id: q.id, name: d.name, category: d.category, desc: d.desc || '', sort: d.sort || 0, photo: d.photo || '' })
      wx.setNavigationBarTitle({ title: d.name })
    } else {
      this.setData({ category: categories[0] || '' })
    }
  },
  onField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  openCat() { this.setData({ catVisible: true }) },
  onCatConfirm(e) { this.setData({ category: e.detail.value[0], catVisible: false }) },
  onCatCancel() { this.setData({ catVisible: false }) },
  async choosePhoto() {
    const m = await wx.chooseMedia({ count: 1, mediaType: ['image'] }).catch(() => null)
    if (!m) return
    wx.showLoading({ title: '上传中' })
    try {
      const up = await wx.cloud.uploadFile({
        cloudPath: 'dishes/' + Date.now() + '.jpg',
        filePath: m.tempFiles[0].tempFilePath,
      })
      this.setData({ photo: up.fileID })
    } catch (e) {
      wx.showToast({ title: '上传失败，再试一次', icon: 'none' })
    }
    wx.hideLoading()
  },
  async save() {
    const { id, name, category, desc, sort, photo } = this.data
    if (!name.trim()) return wx.showToast({ title: '菜名不能为空', icon: 'none' })
    this.setData({ saving: true })
    const fields = { name: name.trim(), category, desc, sort: Number(sort) || 0, photo }
    const payload = id ? { op: 'dishUpdate', dishId: id, patch: fields } : { op: 'dishCreate', ...fields }
    const d = await callWithToast('adminOp', payload).catch(() => null)
    this.setData({ saving: false })
    if (d !== null) wx.navigateBack()
  },
})
```

- [ ] **Step 4: 写 `dish-edit.wxml` 与 `dish-edit.wxss`**

```xml
<view class="card">
  <view class="photo-box" bind:tap="choosePhoto">
    <image wx:if="{{photo}}" class="big-photo" src="{{photo}}" mode="aspectFill" />
    <view wx:else class="big-photo big-photo-empty">📷 点击传照片（可不传）</view>
  </view>
  <t-input label="菜名" placeholder="比如：红烧肉" value="{{name}}" data-field="name" bind:change="onField" />
  <view class="row line" bind:tap="openCat">
    <view class="flex1">分类</view>
    <view class="muted">{{category || '请选择'}} ›</view>
  </view>
  <t-input label="一句话介绍" placeholder="可不填" value="{{desc}}" data-field="desc" bind:change="onField" />
  <t-input label="排序" type="number" placeholder="数字小的排前面" value="{{sort}}" data-field="sort" bind:change="onField" />
</view>
<view class="footer">
  <t-button block theme="primary" loading="{{saving}}" bind:tap="save">保存</t-button>
</view>

<t-picker visible="{{catVisible}}" value="{{[category]}}" title="选分类"
          bind:confirm="onCatConfirm" bind:cancel="onCatCancel">
  <t-picker-item options="{{catOptions}}" />
</t-picker>
```

```css
.photo-box { margin-bottom: 16rpx; }
.big-photo { width: 100%; height: 320rpx; border-radius: 12rpx; }
.big-photo-empty { background: #f3ece4; color: #999; display: flex; align-items: center; justify-content: center; font-size: 26rpx; }
.footer { padding: 24rpx; }
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/admin/dishes/ miniprogram/pages/admin/dish-edit/
git commit -m "feat: 菜品管理（列表、编辑、照片、上下架、删除）"
```

### Task 22: 饭局管理（admin/events）

**Files:**
- Create: `miniprogram/pages/admin/events/events.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `events.json`**

```json
{ "navigationBarTitleText": "饭局管理", "enablePullDownRefresh": true, "usingComponents": {} }
```

- [ ] **Step 2: 写 `events.js`**

```js
const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const { fmtDateTime, fmtPickerValue, parsePickerValue, eventStatusText } = require('../../../utils/format')
const db = wx.cloud.database()

Page({
  data: {
    events: [], createVisible: false, saving: false,
    title: '', note: '', mealTime: 0, deadline: 0,
    mealText: '选择时间 ›', deadlineText: '选择时间 ›',
    mealPickerVisible: false, deadlinePickerVisible: false,
    pickerStart: '', pickerEnd: '',
  },
  async onShow() { if (await guard()) this.load() },
  async load() {
    const now = Date.now()
    const r = await db.collection('events').orderBy('mealTime', 'desc').limit(50).get().catch(() => ({ data: [] }))
    this.setData({
      events: r.data.map((e) => ({
        ...e,
        mealText: fmtDateTime(e.mealTime),
        deadlineText: fmtDateTime(e.deadline),
        statusText: eventStatusText(e, now),
      })),
    })
  },
  openCreate() {
    const now = new Date()
    this.setData({
      createVisible: true, title: '', note: '', mealTime: 0, deadline: 0,
      mealText: '选择时间 ›', deadlineText: '选择时间 ›',
      pickerStart: fmtPickerValue(now),
      pickerEnd: fmtPickerValue(new Date(now.getTime() + 30 * 86400000)),
    })
  },
  onCreateVisible(e) { if (!e.detail.visible) this.setData({ createVisible: false }) },
  onField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  openMealPicker() { this.setData({ mealPickerVisible: true }) },
  openDeadlinePicker() { this.setData({ deadlinePickerVisible: true }) },
  onMealConfirm(e) {
    const ts = parsePickerValue(e.detail.value)
    this.setData({ mealTime: ts, mealText: fmtDateTime(ts), mealPickerVisible: false })
  },
  onDeadlineConfirm(e) {
    const ts = parsePickerValue(e.detail.value)
    this.setData({ deadline: ts, deadlineText: fmtDateTime(ts), deadlinePickerVisible: false })
  },
  onMealCancel() { this.setData({ mealPickerVisible: false }) },
  onDeadlineCancel() { this.setData({ deadlinePickerVisible: false }) },
  async create() {
    const { title, note, mealTime, deadline } = this.data
    if (!title.trim()) return wx.showToast({ title: '起个饭局名吧', icon: 'none' })
    if (!mealTime || !deadline) return wx.showToast({ title: '把时间选了', icon: 'none' })
    this.setData({ saving: true })
    const d = await callWithToast('adminOp', { op: 'eventCreate', title: title.trim(), note, mealTime, deadline }).catch(() => null)
    this.setData({ saving: false })
    if (d === null) return
    this.setData({ createVisible: false })
    this.load()
  },
  async setStatus(e) {
    const { id, status } = e.currentTarget.dataset
    const d = await callWithToast('adminOp', { op: 'eventSetStatus', eventId: id, status }).catch(() => null)
    if (d !== null) this.load()
  },
})
```

- [ ] **Step 3: 写 `events.wxml` 与 `events.wxss`**

```xml
<view class="card row" bind:tap="openCreate">
  <view class="flex1 section-title">＋ 发起饭局</view>
</view>

<t-empty wx:if="{{!events.length}}" description="还没发起过饭局" />
<view wx:for="{{events}}" wx:key="_id" class="card">
  <view class="row">
    <view class="flex1 section-title">{{item.title}}</view>
    <t-tag theme="{{item.statusText === '点菜中' ? 'warning' : 'default'}}" variant="light">{{item.statusText}}</t-tag>
  </view>
  <view class="muted" style="margin-top:8rpx">用餐 {{item.mealText}} · 截止 {{item.deadlineText}}</view>
  <view class="row btns">
    <t-button wx:if="{{item.status === 'open'}}" size="small" variant="outline"
              data-id="{{item._id}}" data-status="closed" bind:tap="setStatus">提前截止</t-button>
    <t-button wx:if="{{item.status === 'open' || item.status === 'closed'}}" size="small" variant="outline"
              data-id="{{item._id}}" data-status="done" bind:tap="setStatus">标记结束</t-button>
  </view>
</view>

<t-popup visible="{{createVisible}}" placement="bottom" bind:visible-change="onCreateVisible">
  <view class="create-pop">
    <view class="section-title" style="margin-bottom:16rpx">发起饭局</view>
    <t-input label="名字" placeholder="比如：周六晚餐" value="{{title}}" data-field="title" bind:change="onField" />
    <view class="row line" bind:tap="openMealPicker">
      <view class="flex1">开饭时间</view><view class="muted">{{mealText}}</view>
    </view>
    <view class="row line" bind:tap="openDeadlinePicker">
      <view class="flex1">点菜截止</view><view class="muted">{{deadlineText}}</view>
    </view>
    <t-input label="说明" placeholder="可不填" value="{{note}}" data-field="note" bind:change="onField" />
    <t-button block theme="primary" style="margin-top:24rpx" loading="{{saving}}" bind:tap="create">发起</t-button>
  </view>
</t-popup>

<t-date-time-picker visible="{{mealPickerVisible}}" mode="minute" title="开饭时间"
                    start="{{pickerStart}}" end="{{pickerEnd}}"
                    bind:confirm="onMealConfirm" bind:cancel="onMealCancel" />
<t-date-time-picker visible="{{deadlinePickerVisible}}" mode="minute" title="点菜截止"
                    start="{{pickerStart}}" end="{{pickerEnd}}"
                    bind:confirm="onDeadlineConfirm" bind:cancel="onDeadlineCancel" />
```

```css
.btns { gap: 16rpx; margin-top: 16rpx; }
.create-pop { background: #fff; border-radius: 24rpx 24rpx 0 0; padding: 32rpx 32rpx 48rpx; }
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/pages/admin/events/
git commit -m "feat: 饭局管理（发起、截止、结束）"
```

### Task 23: 许愿箱（admin/wishes）

**Files:**
- Create: `miniprogram/pages/admin/wishes/wishes.{js,wxml,wxss,json}`

- [ ] **Step 1: 写 `wishes.json` 与 `wishes.js`**

```json
{ "navigationBarTitleText": "许愿箱", "enablePullDownRefresh": true, "usingComponents": {} }
```

```js
const guard = require('../../../utils/guard')
const { callWithToast } = require('../../../utils/api')
const { fmtDateTime, wishStatusText } = require('../../../utils/format')
const db = wx.cloud.database()

Page({
  data: { wishes: [] },
  async onShow() { if (await guard()) this.load() },
  async load() {
    const r = await db.collection('wishes').orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ data: [] }))
    this.setData({
      wishes: r.data.map((w) => ({ ...w, statusText: wishStatusText(w.status), timeText: fmtDateTime(w.createdAt) })),
    })
  },
  async reply(e) {
    const { id, status } = e.currentTarget.dataset
    const res = await new Promise((resolve) => wx.showModal({
      title: status === 'accepted' ? '安排上！' : '下次一定',
      editable: true, placeholderText: '想回一句什么？（可留空）',
      success: (r) => resolve(r),
    }))
    if (!res.confirm) return
    const d = await callWithToast('adminOp', { op: 'wishReply', wishId: id, status, reply: res.content || '' }).catch(() => null)
    if (d !== null) this.load()
  },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()) },
})
```

- [ ] **Step 2: 写 `wishes.wxml` 与 `wishes.wxss`**

```xml
<t-empty wx:if="{{!wishes.length}}" description="还没人许愿" />
<view wx:for="{{wishes}}" wx:key="_id" class="card">
  <view class="row">
    <view class="flex1" style="font-weight:600">{{item.nickname}}</view>
    <view class="muted">{{item.timeText}}</view>
  </view>
  <view style="margin-top:8rpx">「{{item.text}}」</view>
  <view class="muted" wx:if="{{item.status !== 'new'}}">{{item.statusText}}{{item.reply ? ' · ' + item.reply : ''}}</view>
  <view class="row btns" wx:if="{{item.status === 'new'}}">
    <t-button size="small" theme="primary" data-id="{{item._id}}" data-status="accepted" bind:tap="reply">安排上</t-button>
    <t-button size="small" variant="outline" data-id="{{item._id}}" data-status="declined" bind:tap="reply">下次一定</t-button>
  </view>
</view>
```

```css
.btns { gap: 16rpx; margin-top: 16rpx; }
```

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/admin/wishes/
git commit -m "feat: 许愿箱管理"
```

---

## Phase 5：收尾

### Task 24: README 部署手册与手动测试清单

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 `README.md`**

````markdown
# 李娃私厨 🍳

给朋友用的私人点餐微信小程序：朋友们点菜，主厨照单下厨。

设计文档：`docs/superpowers/specs/2026-06-12-liwa-sichu-design.md`

## 部署步骤（一次性）

1. **AppID**：在 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册小程序（个人主体即可），
   把 `project.config.json` 里的 `appid` 从 `touristappid` 改成你的 AppID。
2. **导入项目**：微信开发者工具 → 导入本仓库根目录。
3. **开通云开发**：工具栏「云开发」→ 开通（基础套餐约 ¥19.9/月），创建一个环境（用默认环境即可）。
4. **创建集合**：云开发控制台 → 数据库 → 创建 7 个集合：
   `dishes` `events` `orders` `likes` `wishes` `users` `config`
5. **设置安全规则**：每个集合 → 权限设置 → 自定义安全规则，全部填：
   ```json
   { "read": true, "write": false }
   ```
   （客户端只读，所有写入走云函数）
6. **部署云函数**：开发者工具中右键 `cloudfunctions/api` → 上传并部署：云端安装依赖。
7. **构建 npm**：工具 → 构建 npm（TDesign 组件库需要）。
8. **认领主厨**：预览/真机打开小程序 → 「我的」→「认领主厨之位」。
   ⚠️ 只有第一个点的人会成为主厨，部署完先自己点。
9. **上菜**：主厨入口 → 菜品管理 → 上新菜。

## 本地开发

```bash
npm install        # root：vitest
npm test           # 跑云函数逻辑单测
```

云函数业务逻辑在 `cloudfunctions/api/actions/`，数据库通过接口注入，
测试用 `tests/fakeDb.js` 内存实现，不需要云环境。

## 手动测试清单（发布前过一遍）

**朋友侧**
- [ ] 首次打开能浏览菜单，无任何弹窗
- [ ] 点赞时弹出资料卡；保存头像昵称后点赞成功，❤️ 数 +1，再点取消
- [ ] 加购 2 道菜 → 购物车里改数量、写备注 → 下单页选「随时单」+ 时间人数 → 提交成功
- [ ] 「我的」页能看到订单和状态
- [ ] 主厨发起饭局后：点菜页出现横幅；下单页默认勾选饭局；提交后饭局详情能看到自己的菜
- [ ] 饭局详情：多人点菜互相可见，菜品汇总数量正确
- [ ] 截止时间过后提交 → 提示「手慢了」
- [ ] 菜被下架后再提交含它的购物车 → 提示具体菜名
- [ ] 许愿 → 「我的」页显示「主厨考虑中」；主厨回复后能看到回复
- [ ] 换设备/清缓存后打开 → 资料自动恢复（昵称头像不用重填）

**主厨侧**
- [ ] 非主厨用户看不到「主厨入口」；第二人点「认领」失败
- [ ] 新订单出现在订单管理；接单 → 朋友侧状态变「已接单」；做完 → 「已完成」
- [ ] 婉拒 + 理由 → 朋友侧能看到理由
- [ ] 菜品：新建（含照片上传）、改名、上下架、删除（确认弹窗）
- [ ] 饭局：发起（时间校验：截止晚于现在、早于开饭）、提前截止、标记结束
- [ ] 「我的」页主厨入口角标 = 新订单数
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: 部署手册与手动测试清单"
```

### Task 25: 全量验证与推送

- [ ] **Step 1: 跑全部单测**

Run: `npx vitest run`
Expected: 全部 PASS（fakeDb 3 + identity 5 + profile 3 + order 8 + like 3 + wish 2 + adminOp 8 ≈ 32 用例）

- [ ] **Step 2: 检查工作区干净并推送**

Run: `git status --short`（应为空）然后 `git push origin main`
Expected: push 成功

- [ ] **Step 3: 提醒用户做 README 中的部署步骤与手动测试清单**

云函数部署、构建 npm、真机验证必须在微信开发者工具中由用户完成。
