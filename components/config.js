import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import lodash from 'lodash'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 插件根目录
const pluginRoot = path.join(__dirname, '..')

// 默认配置
const DEFAULT_CONFIG = {
  // 群成员数量检查相关设置
  minMemberCount: 50,
  maxRetryCount: 3,
  retryDelay: 10000,

  // 违禁词检测相关设置
  bannedWordTriggerLimit: 3,
  autoBlacklistOnBannedWord: true,

  // 禁言检测相关设置
  muteCountLimit: 2,
  muteCountResetTime: 24 * 60 * 60 * 1000,
  autoBlacklistOnMute: true,

  // 白名单群聊管理功能设置
  whitelistManagement: {
    enabled: true,
    bannedWordMuteTrigger: 1,
    muteLimitBeforeKick: 2,
    baseMuteDuration: 5,
    muteIncrement: 5,
    enableUserBlacklist: true,
    autoKickBlacklistedUsers: true
  },

  // 退群提示消息配置
  leaveMessage: '检测到群成员数量仅有 {memberCount} 人，少于{minMemberCount}人标准，胡桃将自动退群。',
  blacklistMessage: '该群在黑名单中，胡桃将自动退群。',
  whitelistJoinMessage: '胡桃已进入白名单群聊 {groupId}，将不会自动退群。',
  bannedWordLeaveMessage: '检测到有用户多次发送违禁词，胡桃将自动退群并将此群加入黑名单。如有异议请联系管理员。',
  muteLeaveMessage: '检测到被禁言次数已达{muteCount}次，超过{muteCountLimit}次限制，胡桃将自动退群并将此群加入黑名单。',
  errorLeaveMessage: '出现错误，即将退群，如有疑问请联系管理员修复或申请白名单',

  // 白名单群聊管理消息配置
  managementMessages: {
    muteWarning: '⚠️ 检测到违禁词，你已被禁言 {duration} 分钟。请注意言辞，再次违规将延长禁言时间。',
    kickWarning: '🚫 你因多次发送违禁词被踢出群聊并加入黑名单。如有异议请联系管理员。',
    blacklistUserKick: '🚫 检测到黑名单用户，已自动踢出。',
    adminReply: '啊哈哈，我也是拿你没办法呢~'
  },

  // 通知相关设置
  notification: {
    enabled: true,
    message: '🚨 自动退群通知 🚨\n📍 群号：{groupId}\n📝 群名：{groupName}\n⚠️ 退群原因：{reason}\n🕐 时间：{time}'
  }
}

class ConfigManager {
  constructor() {
    this.configPath = path.join(pluginRoot, 'config/config')
    this.defaultConfigPath = path.join(pluginRoot, 'config/default')
    this.initConfigDir()
  }

  /**
   * 初始化配置目录
   */
  initConfigDir() {
    // 确保配置目录存在
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true })
    }
    if (!fs.existsSync(this.defaultConfigPath)) {
      fs.mkdirSync(this.defaultConfigPath, { recursive: true })
    }

    // 初始化默认配置文件
    const defaultConfigFile = path.join(this.defaultConfigPath, 'config.json')
    if (!fs.existsSync(defaultConfigFile)) {
      fs.writeFileSync(defaultConfigFile, JSON.stringify(DEFAULT_CONFIG, null, 2))
    }

    // 初始化其他配置文件
    this.initListFile('whitelist.json', [])
    this.initListFile('blacklist.json', [])
    this.initListFile('bannedWords.json', [])
    this.initListFile('muteCount.json', {})
  }

  /**
   * 初始化列表配置文件
   */
  initListFile(filename, defaultValue) {
    const filePath = path.join(this.configPath, filename)
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2))
    }
  }

  /**
   * 获取配置文件路径
   */
  getConfigFile(filename) {
    return path.join(this.configPath, filename)
  }

  /**
   * 加载主配置
   */
  loadConfig() {
    try {
      const configFile = path.join(this.configPath, 'config.json')
      const defaultFile = path.join(this.defaultConfigPath, 'config.json')

      let defaultConfig = {}
      let userConfig = {}

      if (fs.existsSync(defaultFile)) {
        defaultConfig = JSON.parse(fs.readFileSync(defaultFile, 'utf8'))
      }

      if (fs.existsSync(configFile)) {
        userConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'))
      }

      // 深度合并配置
      const mergedConfig = lodash.merge({}, defaultConfig, userConfig)

      // 检查是否需要更新配置文件（新增配置项）
      if (!lodash.isEqual(userConfig, mergedConfig)) {
        this.saveConfig(mergedConfig)
        logger.info('[自动退群] 配置文件已更新，添加了新的配置项')
      }

      return mergedConfig
    } catch (err) {
      logger.error('[自动退群] 加载配置失败:', err)
      return lodash.cloneDeep(DEFAULT_CONFIG)
    }
  }

  /**
   * 保存主配置
   */
  saveConfig(config) {
    try {
      const configFile = path.join(this.configPath, 'config.json')
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
      return true
    } catch (err) {
      logger.error('[自动退群] 保存配置失败:', err)
      return false
    }
  }

  /**
   * 加载列表配置
   */
  loadList(filename) {
    try {
      const filePath = path.join(this.configPath, filename)
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'))
      }
      return filename === 'muteCount.json' ? {} : []
    } catch (err) {
      logger.error(`[自动退群] 加载${filename}失败:`, err)
      return filename === 'muteCount.json' ? {} : []
    }
  }

  /**
   * 保存列表配置
   */
  saveList(filename, data) {
    try {
      const filePath = path.join(this.configPath, filename)
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
      return true
    } catch (err) {
      logger.error(`[自动退群] 保存${filename}失败:`, err)
      return false
    }
  }

  /**
   * 获取白名单
   */
  getWhitelist() {
    return this.loadList('whitelist.json')
  }

  /**
   * 保存白名单
   */
  saveWhitelist(list) {
    return this.saveList('whitelist.json', list)
  }

  /**
   * 获取黑名单
   */
  getBlacklist() {
    return this.loadList('blacklist.json')
  }

  /**
   * 保存黑名单
   */
  saveBlacklist(list) {
    return this.saveList('blacklist.json', list)
  }

  /**
   * 获取违禁词列表
   */
  getBannedWords() {
    return this.loadList('bannedWords.json')
  }

  /**
   * 保存违禁词列表
   */
  saveBannedWords(list) {
    return this.saveList('bannedWords.json', list)
  }

  /**
   * 获取禁言次数记录
   */
  getMuteCount() {
    return this.loadList('muteCount.json')
  }

  /**
   * 保存禁言次数记录
   */
  saveMuteCount(data) {
    return this.saveList('muteCount.json', data)
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return lodash.cloneDeep(DEFAULT_CONFIG)
  }
}

// 单例导出
export const Config = new ConfigManager()
export default Config