import plugin from '../../../lib/plugins/plugin.js'
import { extractAtIds } from '../utils/groupAdmin.js'
import {
  addUsersToBlacklist,
  normalizeUserIds,
  removeUserFromBlacklist,
  getUserBlacklist
} from '../utils/yunzaiConfig.js'

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
          reg: '^[tT]拉黑用户(?:\\s+.*)?$',
          fnc: 'addUserBlacklist'
        },
        {
          reg: '^[tT]批量拉黑(?:\\s+.*)?$',
          fnc: 'addUsersBlacklist'
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

    const text = String(e.msg || e.raw_message || '')
    const numericIds = text.replace(/^[tT]拉黑用户/, '').match(/\d+/g) || []
    const userIds = normalizeUserIds([...extractAtIds(e), ...numericIds])
    if (userIds.length === 0) {
      await e.reply('请指定要拉黑的用户QQ号或@用户，可一次填写多个')
      return true
    }

    const result = addUsersToBlacklist(userIds, '主人手动添加')
    if (!result.ok) {
      await e.reply(`添加用户黑名单失败：${result.failed?.join('、') || userIds.join('、')}`)
      return true
    }

    if (userIds.length === 1) {
      await e.reply(result.added.length
        ? `成功将用户 ${userIds[0]} 添加到黑名单`
        : `用户 ${userIds[0]} 已在黑名单中`)
    } else {
      await e.reply(`批量拉黑完成：新增 ${result.added.length} 个${result.existing.length ? `，已在黑名单 ${result.existing.length} 个` : ''}`)
    }

    return true
  }

  async addUsersBlacklist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能操作用户黑名单')
      return true
    }

    const text = String(e.msg || e.raw_message || '')
    const numericIds = text.replace(/^[tT]批量拉黑/, '').match(/\d+/g) || []
    const userIds = normalizeUserIds([...extractAtIds(e), ...numericIds])
    if (userIds.length === 0) {
      await e.reply('请指定要拉黑的用户QQ号或@用户，可一次填写多个')
      return true
    }

    const result = addUsersToBlacklist(userIds, '主人批量添加')
    if (!result.ok) {
      await e.reply(`批量拉黑失败：${result.failed?.join('、') || userIds.join('、')}`)
      return true
    }

    await e.reply(`批量拉黑完成：新增 ${result.added.length} 个${result.existing.length ? `，已在黑名单 ${result.existing.length} 个` : ''}`)
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
