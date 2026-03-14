import plugin from '../../../lib/plugins/plugin.js'
import { update as Update } from '../../../other/update.js'

// 更新锁，防止并发更新
let updateLock = false

/**
 * 插件更新命令
 * 复用 Yunzai 内置更新器，支持普通更新、强制更新、更新日志三种模式
 */
export class UpdateHandler extends plugin {
  constructor() {
    super({
      name: '自动退群-更新',
      dsc: '插件更新管理',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: '^#?[tT]更新(强制)?(日志)?$',
          fnc: 'update',
          permission: 'master'
        }
      ]
    })
  }

  /**
   * 更新插件
   * 复用 Yunzai 内置更新器
   */
  async update(e) {
    // 并发锁检查
    if (updateLock) {
      await e.reply('已有更新任务正在进行中，请勿重复操作！')
      return true
    }

    updateLock = true

    try {
      const msg = e.msg.replace(/^#?[tT]更新/, '')
      const isLog = msg.includes('日志')
      const isForce = msg.includes('强制')

      // 构造命令类型
      const Type = isLog
        ? '#更新日志'
        : (isForce ? '#强制更新' : '#更新')

      // 修改消息内容，复用 Yunzai 内置更新器
      e.msg = Type + '自动退群'

      const up = new Update()
      up.e = e

      if (isLog) {
        await up.updateLog()
      } else {
        await up.update()
      }

    } catch (err) {
      logger.error('[自动退群] 更新失败:', err)
      await e.reply(`更新失败：${err.message}`)
    } finally {
      updateLock = false
    }

    return true
  }
}