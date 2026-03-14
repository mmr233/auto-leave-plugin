import plugin from '../../../lib/plugins/plugin.js'
import { addUserToBlacklist, removeUserFromBlacklist, getUserBlacklist } from '../utils/yunzaiConfig.js'

/**
 * 用户黑名单管理
 */
export class UserBlacklistHandler extends plugin {
  constructor() {
    super({
      name: '自动退群-用户黑名单',
      dsc: '用户黑名单管理命令',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^[tT]拉黑用户\\s*(\\d+)?$',
          fnc: 'addUserBlacklist'
        },
        {
          reg: '^[tT]取消拉黑用户\\s*(\\d+)?$',
          fnc: 'removeUserBlacklist'
        },
        {
          reg: '^[tT]用户黑名单$',
          fnc: 'showUserBlacklist'
        }
      ]
    })
  }

  async addUserBlacklist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能操作用户黑名单')
      return true
    }

    const match = e.msg.match(/^[tT]拉黑用户\s*(\d+)?$/)
    let userId = match?.[1]

    // 如果没有指定用户ID且消息中有@用户，获取被@的用户
    if (!userId && e.at) {
      userId = e.at
    }

    if (!userId) {
      await e.reply('请指定要拉黑的用户QQ号或@用户')
      return true
    }

    const success = addUserToBlacklist(userId, '主人手动添加')
    if (success) {
      await e.reply(`成功将用户 ${userId} 添加到黑名单`)
    } else {
      await e.reply('添加用户黑名单失败或用户已在黑名单中')
    }

    return true
  }

  async removeUserBlacklist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能操作用户黑名单')
      return true
    }

    const match = e.msg.match(/^[tT]取消拉黑用户\s*(\d+)?$/)
    let userId = match?.[1]

    if (!userId && e.at) {
      userId = e.at
    }

    if (!userId) {
      await e.reply('请指定要取消拉黑的用户QQ号或@用户')
      return true
    }

    const success = removeUserFromBlacklist(userId)
    if (success) {
      await e.reply(`成功将用户 ${userId} 从黑名单移除`)
    } else {
      await e.reply('移除用户黑名单失败或用户不在黑名单中')
    }

    return true
  }

  async showUserBlacklist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能查看用户黑名单')
      return true
    }

    const blackUsers = getUserBlacklist()
    if (blackUsers.length === 0) {
      await e.reply('用户黑名单为空')
    } else {
      const msg = `用户黑名单 (${blackUsers.length}个):\n${blackUsers.join('\n')}`
      await e.reply(msg)
    }

    return true
  }
}