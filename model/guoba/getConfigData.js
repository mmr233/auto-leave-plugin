import { Config } from '../../components/config.js'
import { getUserBlacklist } from '../../utils/yunzaiConfig.js'

/**
 * 获取配置数据
 */
export async function getConfigData() {
  const config = Config.loadConfig() || {}
  const bannedWords = Config.getBannedWords() || []
  const whitelistGroups = Config.getWhitelist() || []
  const blacklistGroups = Config.getBlacklist() || []
  const blacklistUsers = getUserBlacklist() || []

  return {
    ...config,
    // 违禁词列表（数组格式，用于 GTags 组件）
    bannedWordsList: bannedWords.map(String),
    // 白名单群聊（数组格式，用于 GSelectGroup 组件）
    whitelistGroups: whitelistGroups.map(String),
    // 黑名单群聊（数组格式，用于 GSelectGroup 组件）
    blacklistGroups: blacklistGroups.map(String),
    // 黑名单用户（数组格式，用于 GSelectFriend 组件）
    blacklistUsers: blacklistUsers.map(String)
  }
}