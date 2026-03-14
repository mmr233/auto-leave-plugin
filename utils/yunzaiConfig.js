import YAML from 'yaml'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Yunzai 配置文件路径
 */
const yunzaiConfigPath = '/root/Yunzai/config/config/other.yaml'

/**
 * 初始化 Yunzai 配置文件
 */
export function initYunzaiConfig() {
  try {
    if (!fs.existsSync(yunzaiConfigPath)) {
      // 创建目录
      const configDir = path.dirname(yunzaiConfigPath)
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true })
      }

      // 创建初始配置文件
      const yamlContent = '#黑名单用户\nblackUser:\n  - 31528952540'
      fs.writeFileSync(yunzaiConfigPath, yamlContent, 'utf8')
      logger.info('[自动退群] 已创建Yunzai配置文件模板')
    }
  } catch (err) {
    logger.error('[自动退群] 初始化Yunzai配置文件失败:', err)
  }
}

/**
 * 获取用户黑名单
 */
export function getUserBlacklist() {
  try {
    if (!fs.existsSync(yunzaiConfigPath)) {
      logger.warn('[自动退群] Yunzai配置文件不存在，创建默认配置')
      return []
    }

    const yamlContent = fs.readFileSync(yunzaiConfigPath, 'utf8')
    const config = YAML.parse(yamlContent)
    return config.blackUser || []
  } catch (err) {
    logger.error('[自动退群] 读取用户黑名单失败:', err)
    return []
  }
}

/**
 * 保存用户黑名单
 */
export function saveUserBlacklist(blackUsers) {
  try {
    let config = {}

    if (fs.existsSync(yunzaiConfigPath)) {
      const yamlContent = fs.readFileSync(yunzaiConfigPath, 'utf8')
      config = YAML.parse(yamlContent) || {}
    }

    // 确保blackUser字段存在且格式正确
    config.blackUser = blackUsers || []

    // 生成YAML字符串
    const yamlString = YAML.stringify(config, {
      lineWidth: 0,
      minContentWidth: 0,
      doubleQuotedAsJSON: false
    })

    // 在blackUser字段前添加注释
    const lines = yamlString.split('\n')
    const blackUserIndex = lines.findIndex(line => line.startsWith('blackUser:'))
    if (blackUserIndex !== -1) {
      lines.splice(blackUserIndex, 0, '#黑名单用户')
    }

    const finalYaml = lines.join('\n')
    fs.writeFileSync(yunzaiConfigPath, finalYaml, 'utf8')
    logger.info('[自动退群] 用户黑名单已保存')
    return true
  } catch (err) {
    logger.error('[自动退群] 保存用户黑名单失败:', err)
    return false
  }
}

/**
 * 添加用户到黑名单
 */
export function addUserToBlacklist(userId, reason = '') {
  try {
    const blackUsers = getUserBlacklist()
    const userIdNum = parseInt(userId)

    if (!blackUsers.includes(userIdNum)) {
      blackUsers.push(userIdNum)
      if (saveUserBlacklist(blackUsers)) {
        logger.warn(`[自动退群] 用户 ${userId} 已添加到黑名单，原因: ${reason}`)
        return true
      }
    } else {
      logger.info(`[自动退群] 用户 ${userId} 已在黑名单中`)
    }
    return false
  } catch (err) {
    logger.error('[自动退群] 添加用户到黑名单失败:', err)
    return false
  }
}

/**
 * 从黑名单移除用户
 */
export function removeUserFromBlacklist(userId) {
  try {
    const blackUsers = getUserBlacklist()
    const userIdNum = parseInt(userId)
    const index = blackUsers.indexOf(userIdNum)

    if (index !== -1) {
      blackUsers.splice(index, 1)
      if (saveUserBlacklist(blackUsers)) {
        logger.info(`[自动退群] 用户 ${userId} 已从黑名单移除`)
        return true
      }
    } else {
      logger.info(`[自动退群] 用户 ${userId} 不在黑名单中`)
    }
    return false
  } catch (err) {
    logger.error('[自动退群] 从黑名单移除用户失败:', err)
    return false
  }
}