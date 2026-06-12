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
