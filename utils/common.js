import YAML from 'yaml'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 获取主人QQ号
 * @param {string} botId - 机器人ID
 * @returns {string|null} 主人QQ号
 */
export function getMasterQQ(botId = null) {
  try {
    let masterQQ = null

    // 方式1: 从Yunzai配置文件读取
    const yunzaiConfig = readYunzaiConfig()
    if (yunzaiConfig) {
      // 如果有master配置且提供了botId，优先使用对应的主人
      if (yunzaiConfig.master && botId) {
        for (const masterPair of yunzaiConfig.master) {
          if (typeof masterPair === 'string' && masterPair.includes(':')) {
            const [bot, master] = masterPair.split(':')
            if (bot === String(botId)) {
              masterQQ = master
              logger.info(`[自动退群] 从master配置获取到Bot ${botId} 的主人QQ: ${masterQQ}`)
              break
            }
          }
        }
      }
      // 如果没找到对应Bot的主人，使用masterQQ列表中的第一个有效QQ号
      if (!masterQQ && yunzaiConfig.masterQQ) {
        for (const qq of yunzaiConfig.masterQQ) {
          if (qq !== 'stdin' && qq !== null && qq !== undefined) {
            masterQQ = String(qq)
            logger.info(`[自动退群] 从masterQQ配置获取到主人QQ: ${masterQQ}`)
            break
          }
        }
      }
    }

    // 方式2: 从全局配置获取
    if (!masterQQ && global.Bot?.cfg?.master?.length > 0) {
      masterQQ = String(global.Bot.cfg.master[0])
      logger.info(`[自动退群] 从global.Bot.cfg.master获取到主人QQ: ${masterQQ}`)
    }
    // 方式3: 从Bot配置获取
    if (!masterQQ && Bot?.cfg?.master?.length > 0) {
      masterQQ = String(Bot.cfg.master[0])
      logger.info(`[自动退群] 从Bot.cfg.master获取到主人QQ: ${masterQQ}`)
    }
    // 方式4: 从环境变量获取
    if (!masterQQ && process.env.MASTER_QQ) {
      masterQQ = String(process.env.MASTER_QQ)
      logger.info(`[自动退群] 从环境变量获取到主人QQ: ${masterQQ}`)
    }
    if (!masterQQ) {
      logger.warn('[自动退群] 未找到主人QQ号')
    }

    return masterQQ
  } catch (err) {
    logger.error('[自动退群] 获取主人QQ失败:', err)
    return null
  }
}

/**
 * 读取Yunzai配置文件
 */
export function readYunzaiConfig() {
  try {
    // 尝试多个可能的配置文件路径
    const possiblePaths = [
      path.join(process.cwd(), 'config', 'config', 'other.yaml'),
      path.join(process.cwd(), 'config', 'other.yaml'),
      path.join(process.cwd(), '..', 'config', 'config', 'other.yaml'),
      '/root/Yunzai/config/config/other.yaml'
    ]
    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        logger.info(`[自动退群] 找到配置文件: ${configPath}`)
        const yamlContent = fs.readFileSync(configPath, 'utf8')
        const config = YAML.parse(yamlContent)
        return config
      }
    }

    logger.warn('[自动退群] 未找到other.yaml配置文件')
    return null
  } catch (err) {
    logger.error('[自动退群] 读取Yunzai配置失败:', err)
    return null
  }
}

/**
 * 延迟函数
 * @param {number} ms - 毫秒数
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 分割逗号（支持中文和英文逗号）
 * @param {string} text - 输入文本
 * @returns {string[]} 分割后的数组
 */
export function splitByComma(text) {
  return text.split(/[，,]/).map(item => item.trim()).filter(item => item.length > 0)
}