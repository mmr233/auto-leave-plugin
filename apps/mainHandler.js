import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../components/config.js'
import { checkBannedWords, handleBannedWordTrigger, handleWhitelistBannedWord } from '../model/bannedWordCheck.js'
import { initEventListener } from '../model/index.js'

// 初始化事件监听
initEventListener()

/**
 * 自动退群主处理器
 */
export class AutoLeaveHandler extends plugin {
  constructor() {
    super({
      name: '自动退群',
      dsc: '群成员少于配置值时自动退群，违禁词自动退群，被禁言自动退群，白名单群聊违禁词管理',
      event: 'message',
      priority: -1000,
      rule: []
    })

    // 单例模式
    if (AutoLeaveHandler.instance) {
      return AutoLeaveHandler.instance
    }
    AutoLeaveHandler.instance = this
  }

  async accept(e) {
    // 检查是否为群消息
    if (!e.group_id) {
      return false
    }

    // 检查是否是白名单群
    const whitelist = Config.getWhitelist()
    if (whitelist.includes(parseInt(e.group_id))) {
      // 白名单群特殊处理：只处理艾特机器人的违禁词
      if (e.atBot) {
        const foundWords = checkBannedWords(e.msg)
        if (foundWords && foundWords.length > 0) {
          await handleWhitelistBannedWord(e)
          return false
        }
      }
      return false
    }

    // 非白名单群的原有逻辑：艾特机器人且包含违禁词
    if (e.atBot) {
      const bannedWords = checkBannedWords(e.msg)
      if (bannedWords && bannedWords.length > 0) {
        logger.warn(`[自动退群] 检测到用户 ${e.nickname || e.user_id}(${e.user_id}) 在群 ${e.group_id} 艾特机器人发送违禁词: ${bannedWords.join('、')}`)
        await handleBannedWordTrigger(e)
        return false
      }
    }

    return false
  }
}