# 李娃私厨 — 点餐微信小程序设计文档

日期：2026-06-12
仓库：https://github.com/GraythornThanks/LiWaPrivateKitchen.git

## 1. 项目概述

给朋友用的私人点餐微信小程序。朋友们浏览菜单点菜，主厨（小程序拥有者）收到订单后采购下厨。支持两种点餐模式：

- **饭局模式**：主厨发起一场饭局（定用餐时间和点菜截止时间），朋友们在截止前集中点菜，订单公开可见，大家能围观彼此点了什么。
- **随时单模式**：菜单常驻，朋友任何时候都可以下单，附上期望的用餐时间，主厨决定接不接。

**成功标准**：朋友打开就能点菜（零门槛浏览）；主厨打开管理页能一眼看到新订单并照单备菜；菜单维护全程在手机上完成。

## 2. 范围

### 包含

- 菜单浏览（分类、照片、点赞数）与购物车式点菜
- 饭局的发起、点菜、围观、截止、结束
- 随时单（期望用餐时间 + 人数 + 备注）
- 订单状态流转：待接单 → 已接单 → 已完成；旁路：已婉拒（附理由）
- 菜品点赞（一人一菜一赞，可取消）
- 想吃许愿（朋友提交菜单外想吃的菜，主厨回复"安排上/下次一定"）
- 小程序内管理页（仅主厨可见）：订单处理、菜品 CRUD、饭局管理、许愿箱
- 用户资料：头像 + 昵称（微信头像昵称填写能力）

### 不包含（明确排除）

- **访问控制**：不做邀请码/审批，谁打开都能点（私密性靠不传播）
- **推送通知**：不做订阅消息，主厨打开小程序看角标
- **支付**：朋友间不收钱
- **多管理员协作流程**：数据结构支持多管理员（数组），但不做管理员管理界面
- **小程序 UI 自动化测试**

## 3. 技术选型

| 层 | 选择 | 理由 |
|----|------|------|
| 前端 | 原生小程序（WXML/WXSS/JS）+ TDesign 组件库 | 与云开发零磨合、无构建层、长期维护成本最低；只跑微信足够 |
| 后端 | 微信云开发（云函数 + 云数据库 + 云存储） | 免运维、免域名备案、小程序内免鉴权调用；约 ¥19.9/月 |
| 测试 | vitest（云函数业务逻辑单测）+ 手动测试清单（小程序端） | 个人项目务实分层 |

## 4. 页面结构

3 个底部 Tab + 隐藏管理区（线框图见本地 `.superpowers/brainstorm/`，已确认）：

```
TabBar
├── 点菜（首页）   分类菜单 + 点赞 + 购物车；有进行中饭局时顶部横幅
│   └── checkout  下单确认页：用餐时间/人数/整单备注/每菜备注
├── 饭局          饭局列表（点菜中/已截止/已结束）
│   └── event-detail  饭局详情：倒计时、所有人的菜（头像+昵称，公开围观）、继续点菜
└── 我的          我的订单及状态、想吃许愿、个人资料（头像昵称）
    └── admin     主厨入口（仅管理员可见，新订单红点角标）
        ├── orders     订单管理：接单/婉拒/做完
        ├── dishes     菜品列表 + dish-edit 编辑页（名称/分类/照片/介绍/上下架/排序）
        ├── events     饭局管理：发起/手动截止/标记结束
        └── wishes     许愿箱：安排上/下次一定（附回复）
```

**点菜统一入口**：饭局点菜和随时单共用同一套点菜流程，区别仅在订单是否携带 `eventId`。从饭局横幅/详情进入点菜则挂饭局（不填用餐时间，可填"带几个人"）；平时进入则为随时单（填用餐时间）。

## 5. 数据模型

云数据库 7 个集合：

### dishes（菜品）
| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 菜名 |
| category | string | 分类（取值来自 config.categories） |
| photo | string\|null | 云存储 fileID，允许无图 |
| desc | string | 一句话介绍，可空 |
| status | 'on'\|'off' | 上/下架 |
| likeCount | number | 点赞数冗余计数，云函数维护 |
| sort | number | 排序权重 |
| createdAt / updatedAt | Date | |

### events（饭局）
| 字段 | 类型 | 说明 |
|------|------|------|
| title | string | 如"周六晚餐" |
| mealTime | Date | 用餐时间 |
| deadline | Date | 点菜截止时间 |
| status | 'open'\|'closed'\|'done' | 点菜中/已截止/已结束 |
| note | string | 可空说明 |
| createdAt | Date | |

### orders（订单）
| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | string | 下单人（云开发自动注入） |
| nickname / avatar | string | 下单时的资料快照 |
| eventId | string\|null | null = 随时单 |
| items | array | [{dishId, name(快照), qty, note}] |
| orderNote | string | 整单备注 |
| mealTime | Date\|null | 随时单必填；饭局单为 null（以饭局为准）。UI 选"日期 + 午餐/晚餐"，映射为当日 12:00 / 18:00 |
| headcount | number | 随时单=几人吃；饭局单=带几个人（默认 1） |
| status | 'new'\|'accepted'\|'done'\|'declined' | 状态机见 §7 |
| declineReason | string | 仅 declined 时有 |
| createdAt / updatedAt | Date | |

### likes（点赞）
dishId + _openid + createdAt。唯一性（一人一菜一条）由云函数 toggle 语义保证。

### wishes（许愿）
| 字段 | 类型 | 说明 |
|------|------|------|
| _openid / nickname / avatar | string | 许愿人及资料快照 |
| text | string | 想吃什么 |
| status | 'new'\|'accepted'\|'declined' | 考虑中/安排上/下次一定 |
| reply | string | 主厨回复，可空 |
| createdAt | Date | |

### users（用户资料）
openid（_id）→ nickname、avatar（云存储 fileID）、updatedAt。换设备/清缓存后用于恢复资料。

### config（配置）
单文档 `main`：`adminOpenids: string[]`、`categories: string[]`（默认：热菜/凉菜/汤/主食/甜点）。

## 6. 云函数与权限

### 权限模型

- 全部集合安全规则：**所有用户可读、客户端不可写**。config 同样可读（点菜页需要 categories；openid 本就通过公开的 orders 可见，无额外暴露），管理员身份判断仍以 `whoami` 服务端结果为准。
- 所有写操作经由唯一云函数 `api`（action 路由），服务端 SDK 绕过客户端权限。陌生人无法用工具直写数据库。

### api 云函数 action 列表

| action | 鉴权 | 行为 |
|--------|------|------|
| whoami | 无 | 返回 {openid, isAdmin}，用于"我的"页显示主厨入口 |
| updateProfile | 本人 | 写 users（昵称 + 头像 fileID） |
| submitOrder | 本人 | 校验：饭局存在且 open 且未过 deadline（服务端时间）；菜品全部在架。通过则落库（含菜名/资料快照），status=new |
| toggleLike | 本人 | 有则删并 likeCount-1，无则增并 likeCount+1（幂等） |
| submitWish | 本人 | 落库 status=new |
| claimAdmin | 特殊 | 仅当 adminOpenids 为空时把调用者设为管理员，用数据库事务防并发双认领；之后永远拒绝 |
| adminOp | 管理员 | 子路由：菜品 CRUD（删除菜品时级联清理其 likes；历史订单因菜名快照不受影响）、发起/截止/结束饭局、订单状态流转（含婉拒理由）、许愿回复 |

统一返回 `{ok: boolean, code: string, msg: string, data?: any}`。

### 管理员认领

部署后第一个点击"我的 → 主厨入口"的人触发 `claimAdmin` 成为管理员（部署者自己先点）。此后入口仅对 adminOpenids 内的用户显示。

## 7. 核心流程

### 首次使用
打开即浏览，零授权。第一次**提交**（订单/点赞/许愿）时弹资料卡组件 profile-sheet：头像按钮（`open-type="chooseAvatar"`，临时文件上传到云存储）+ 昵称输入（`type="nickname"`）。存本地缓存 + users 集合。

### 随时单
点菜 Tab 加购 → checkout 页填用餐时间（日期 + 午/晚）、人数、备注 → submitOrder → status=new。

### 饭局
1. 主厨发起（标题/用餐时间/截止时间）→ status=open
2. 朋友看到点菜横幅 + 饭局 Tab，进入点菜（不填用餐时间，可填带几人）
3. 饭局详情公开显示每人（头像+昵称）所点的菜与备注
4. **截止不靠定时器**：到点后 submitOrder 服务端校验拒收；页面按 deadline 与当前时间自动渲染"已截止"。主厨也可手动提前截止（status=closed）
5. 主厨照汇总采购下厨，事后标记 status=done

### 订单状态机
```
new（待接单）──接单──> accepted（已接单）──做完──> done（已完成）
     └──────婉拒（附理由）──> declined
```
仅管理员可流转。朋友在"我的"页看状态。管理页角标 = status=new 的订单数。

### 许愿
我的页提交文本 → 管理页许愿箱 → 主厨标记"安排上/下次一定"并可附回复 → 许愿人在"我的"页看到。

## 8. 错误处理

- 云函数统一错误码 + 友好 msg，客户端统一 toast
- 提交时菜品刚下架 → 返回具体菜名列表，购物车标红提示移除后重交
- 饭局已截止/已关闭 → "手慢了，这场饭局已截止点菜"
- 头像/菜品图上传失败 → 可重试；菜品允许先无图保存
- 网络失败 → toast 提示，不清空已填表单
- claimAdmin 并发 → 数据库事务保证只有一人成功
- 客户端时间不可信 → 所有截止判断以云函数服务端时间为准，前端时间仅用于展示

## 9. 项目结构

```
LiWaPrivateKitchen/
├── project.config.json
├── cloudfunctions/
│   └── api/
│       ├── index.js          # action 路由 + 管理员鉴权
│       ├── actions/          # 每个 action 一个模块，数据库经接口注入
│       └── package.json
├── miniprogram/
│   ├── app.js / app.json / app.wxss
│   ├── pages/
│   │   ├── menu/  checkout/  events/  event-detail/  mine/
│   │   └── admin/            # orders / dishes / dish-edit / events / wishes
│   ├── components/           # dish-card / profile-sheet / order-card
│   └── utils/                # api.js（wx.cloud.callFunction 封装）/ format.js
└── docs/superpowers/specs/
```

## 10. 测试策略

1. **云函数业务逻辑（TDD，vitest）**：订单校验（截止/下架）、状态机合法流转、toggleLike 幂等、claimAdmin 单次性。actions 模块通过注入数据库接口实现，测试用内存假实现，本地直跑无需云环境。
2. **小程序端手动测试清单**（开发者工具 + 真机预览）：首单弹资料卡、饭局横幅出现与消失、截止后提交被拒、下架菜提示、管理员入口可见性、角标计数。

## 11. 部署前提

- 注册微信小程序获得 AppID（个人主体即可，本项目无支付无资质要求）
- 开通云开发环境（基础套餐约 ¥19.9/月）
- 名称：**李娃私厨**
- TDesign：npm 安装后用开发者工具"构建 npm"
