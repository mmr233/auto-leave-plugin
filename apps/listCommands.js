import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../../components/config.js'
import { addToWhitelist, removeFromWhitelist, addToBlacklist, removeFromBlacklist } from '../../model/listManager.js'
import { clearMuteCount } from '../../model/muteCheck.js'

/**
 * 白名单管理
 */
export class WhitelistHandler extends plugin {
  constructor() {
    super({
      name: '自动退群-白名单',
      dsc: '白名单管理命令',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^[tT]拉白\\s*(\\d+)?$',
          fnc: 'addWhitelist'
        },
        {
          reg: '^[tT]白名单$',
          fnc: 'showWhitelist'
        },
        {
          reg: '^[tT]取消拉白\\s*(\\d+)?$',
          fnc: 'removeWhitelist'
        }
      ]
    })
  }

  async addWhitelist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能操作白名单')
      return true
    }

    const match = e.msg.match(/^[tT]拉白\s*(\d+)?$/)
    const groupId = match?.[1] || e.group_id

    if (!groupId) {
      await e.reply('请指定群号或在群内使用此命令')
      return true
    }

    // 清除该群的禁言次数记录
    clearMuteCount(groupId)

    const result = addToWhitelist(groupId)
    await e.reply(result.message)
    logger.info(`[自动退群] 群 ${groupId} 已添加到白名单`)

    return true
  }

  async showWhitelist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能查看白名单')
      return true
    }

    const whitelist = Config.getWhitelist()
    if (whitelist.length === 0) {
      await e.reply('白名单为空')
    } else {
      const msg = `白名单群聊 (${whitelist.length}个):\n${whitelist.join('\n')}`
      await e.reply(msg)
    }

    return true
  }

  async removeWhitelist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能操作白名单')
      return true
    }

    const match = e.msg.match(/^[tT]取消拉白\s*(\d+)?$/)
    const groupId = match?.[1] || e.group_id

    if (!groupId) {
      await e.reply('请指定群号或在群内使用此命令')
      return true
    }

    const result = removeFromWhitelist(groupId)
    await e.reply(result.message)

    return true
  }
}

/**
 * 黑名单管理
 */
export class BlacklistHandler extends plugin {
  constructor() {
    super({
      name: '自动退群-黑名单',
      dsc: '黑名单管理命令',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^[tT]拉黑\\s*(\\d+)?$',
          fnc: 'addBlacklist'
        },
        {
          reg: '^[tT]黑名单$',
          fnc: 'showBlacklist'
        },
        {
          reg: '^[tT]取消拉黑\\s*(\\d+)?$',
          fnc: 'removeBlacklist'
        }
      ]
    })
  }

  async addBlacklist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能操作黑名单')
      return true
    }

    const match = e.msg.match(/^[tT]拉黑\s*(\d+)?$/)
    const groupId = match?.[1] || e.group_id

    if (!groupId) {
      await e.reply('请指定群号或在群内使用此命令')
      return true
    }

    const result = addToBlacklist(groupId)
    await e.reply(result.message)
    logger.info(`[自动退群] 群 ${groupId} 已添加到黑名单`)

    return true
  }

  async showBlacklist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能查看黑名单')
      return true
    }

    const blacklist = Config.getBlacklist()
    if (blacklist.length === 0) {
      await e.reply('黑名单为空')
    } else {
      const msg = `黑名单群聊 (${blacklist.length}个):\n${blacklist.join('\n')}`
      await e.reply(msg)
    }

    return true
  }

  async removeBlacklist(e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能操作黑名单')
      return true
    }

    const match = e.msg.match(/^[tT]取消拉黑\s*(\d+)?$/)
    const groupId = match?.[1] || e.group_id

    if (!groupId) {
      await e.reply('请指定群号或在群内使用此命令')
      return true
    }

    const result = removeFromBlacklist(groupId)
    await e.reply(result.message)

    return true
  }
}