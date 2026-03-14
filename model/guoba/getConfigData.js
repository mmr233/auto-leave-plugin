import { Config } from '../../components/config.js'

/**
 * 获取配置数据
 */
export async function getConfigData() {
  const config = Config.loadConfig() || {}
  const bannedWords = Config.getBannedWords() || []

  return {
    ...config,
    // 违禁词列表（转换为换行分隔的文本）
    bannedWordsText: bannedWords.join('\n')
  }
}