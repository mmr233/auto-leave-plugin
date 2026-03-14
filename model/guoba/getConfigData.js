import { Config } from '../../components/config.js'

/**
 * 获取配置数据
 */
export async function getConfigData() {
  const config = Config.loadConfig() || {}
  const bannedWords = Config.getBannedWords() || []

  return {
    ...config,
    // 违禁词列表（数组形式，用于 Select tags 组件）
    bannedWordsList: bannedWords
  }
}