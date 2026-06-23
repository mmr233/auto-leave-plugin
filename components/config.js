import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import lodash from 'lodash'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 插件根目录
const pluginRoot = path.join(__dirname, '..')

// 数据目录（Yunzai/data/自动退群）
const dataRoot = path.join(process.cwd(), 'data/自动退群')
const DEFAULT_NOTIFICATION_MESSAGE = '自动退群通知\n\n群号：{groupId}\n\n群名：{groupName}\n\n退群原因：{reason}\n\n时间：{time}'
const LEGACY_NOTIFICATION_MESSAGES = [
  '自动退群通知\n群号：{groupId}\n群名：{groupName}\n退群原因：{reason}\n时间：{time}',
  '\u{1F6A8} 自动退群通知 \u{1F6A8}\n\u{1F4CD} 群号：{groupId}\n\u{1F4DD} 群名：{groupName}\n\u26A0\uFE0F 退群原因：{reason}\n\u{1F550} 时间：{time}'
]

const DEFAULT_INVITE_MANAGEMENT = {
  enabled: true,
  reviewMode: 2,
  requestExpireMinutes: 5,
  maxPendingRequests: 20,
  allowInviterConfirm: true,
  notifyGroups: [],
  notifyUsers: [],
  blackGroups: [],
  whiteGroups: [],
  pendingRequests: []
}

export const DEFAULT_INVITE_MESSAGES = {
  reviewNotification: '机器人加群邀请\n群号：{groupId}\n群名：{groupName}\n邀请人：{userId}\n邀请人昵称：{nickname}\n请求ID：{requestId}\n\n处理方式：引用本消息发送 #确认加群 或 #拒绝加群\n备用方式：#确认加群 {groupId}\n有效期：{expireMinutes} 分钟',
  inviteSubmitted: '加群邀请已提交审核\n群号：{groupId}\n群名：{groupName}\n有效期：{expireMinutes} 分钟',
  inviteApproved: '加群邀请已通过\n群号：{groupId}\n群名：{groupName}',
  inviteRejected: '加群邀请已拒绝\n群号：{groupId}\n群名：{groupName}',
  resultApproved: '加群请求已同意\n群号：{groupId}\n群名：{groupName}\n邀请人：{userId}',
  resultRejected: '加群请求已拒绝\n群号：{groupId}\n群名：{groupName}\n邀请人：{userId}',
  autoApproved: '加群邀请已自动同意\n群号：{groupId}\n群名：{groupName}',
  autoRejected: '加群邀请已自动拒绝\n群号：{groupId}\n群名：{groupName}',
  blackGroupRejected: '加群邀请已拒绝\n群号：{groupId}\n群名：{groupName}\n原因：该群在黑名单中',
  reviewDisabled: '加群审核已关闭\n群号：{groupId}\n机器人不会处理本次邀请',
  noNotifyTarget: '加群邀请已收到，但没有配置可用的审核通知群或通知用户',
  pendingNotFound: '未找到对应的加群请求，可能已过期或已处理',
  permissionDenied: '权限不足，只有主人、通知用户、审核群管理员或邀请者可处理',
  processFailed: '处理失败：{error}',
  blackGroupRejectReason: '群聊在黑名单中',
  autoRejectReason: '已开启自动拒绝',
  manualRejectReason: '审核拒绝'
}

const LEGACY_DEFAULT_TEXTS = [
  {
    path: 'groupAdmin.groupVerify.successMsgs.0',
    legacy: ['\u2705 验证成功，欢迎入群'],
    next: '验证成功，欢迎入群'
  },
  {
    path: 'managementMessages.muteWarning',
    legacy: ['\u26A0\uFE0F 检测到违禁词，你已被禁言 {duration} 分钟。请注意言辞，再次违规将延长禁言时间。'],
    next: '检测到违禁词，你已被禁言 {duration} 分钟。请注意言辞，再次违规将延长禁言时间。'
  },
  {
    path: 'managementMessages.kickWarning',
    legacy: ['\u{1F6AB} 你因多次发送违禁词被踢出群聊并加入黑名单。如有异议请联系管理员。'],
    next: '你因多次发送违禁词被踢出群聊并加入黑名单。如有异议请联系管理员。'
  },
  {
    path: 'managementMessages.blacklistUserKick',
    legacy: ['\u{1F6AB} 检测到黑名单用户，已自动踢出。'],
    next: '检测到黑名单用户，已自动踢出。'
  }
]

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

  // 群管配置
  groupAdmin: {
    enabled: false,
    commandsEnabled: true,
    bannedWordsEnabled: true,
    voteEnabled: true,
    verifyEnabled: true,
    noticeEnabled: true,
    announceEnabled: true,
    scheduledMuteEnabled: true,
    blacklistRequestRejectEnabled: true,
    whiteQQ: [],
    noBan: false,
    voteBan: true,
    voteKick: false,
    outTime: 180,
    minNum: 4,
    banTime: 3600,
    veto: true,
    voteAdmin: false,
    groupVerify: {
      openGroup: [],
      successMsgs: {
        0: '验证成功，欢迎入群'
      },
      mode: '精确',
      times: 7,
      remindAtLastMinute: true,
      time: 300,
      range: {
        min: 10,
        max: 100
      },
      delayTime: 2
    },
    groupAddNotice: {
      openGroup: [],
      msg: '收到加群申请'
    },
    title: {
      selfApply: true
    }
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
    muteWarning: '检测到违禁词，你已被禁言 {duration} 分钟。请注意言辞，再次违规将延长禁言时间。',
    kickWarning: '你因多次发送违禁词被踢出群聊并加入黑名单。如有异议请联系管理员。',
    blacklistUserKick: '检测到黑名单用户，已自动踢出。',
    adminReply: '管理员触发违禁词'
  },

  // 机器人群邀请审核消息配置
  inviteMessages: DEFAULT_INVITE_MESSAGES,

  // 机器人群邀请审核
  inviteManagement: DEFAULT_INVITE_MANAGEMENT,

  // 通知相关设置
  notification: {
    enabled: true,
    message: DEFAULT_NOTIFICATION_MESSAGE
  }
}

function toId(value) {
  const id = String(value ?? '').trim()
  return /^\d+$/.test(id) ? id : ''
}

function collectLegacyIds(value) {
  if (value === undefined || value === null || value === '') {
    return []
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => collectLegacyIds(item))
  }
  if (typeof value === 'object') {
    if (value.isEnabled === false) {
      return []
    }
    return [
      ...collectLegacyIds(value.groupId),
      ...collectLegacyIds(value.groupIdInput),
      ...collectLegacyIds(value.groupIds)
    ]
  }
  const id = toId(value)
  return id ? [id] : []
}

function normalizeLegacyIds(value) {
  return [...new Set(collectLegacyIds(value))]
}

function normalizeLegacyNotifyUsers(value) {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set()
  const users = []
  for (const item of value) {
    const userId = toId(typeof item === 'object' ? item.userId : item)
    if (!userId || seen.has(userId)) {
      continue
    }
    seen.add(userId)
    users.push({
      userId,
      remark: typeof item === 'object' ? String(item.remark || '') : ''
    })
  }
  return users
}

class ConfigManager {
  constructor() {
    // 配置文件存储在 Yunzai/data/自动退群 目录，防止插件删除时数据丢失
    this.configPath = path.join(dataRoot, 'config')
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

    // 初始化默认配置文件（在插件目录）
    const defaultConfigFile = path.join(this.defaultConfigPath, 'config.json')
    if (!fs.existsSync(defaultConfigFile)) {
      fs.writeFileSync(defaultConfigFile, JSON.stringify(DEFAULT_CONFIG, null, 2))
    }

    // 迁移旧配置文件（如果存在）
    this.migrateOldConfig()

    // 初始化其他配置文件
    this.initListFile('whitelist.json', [])
    this.initListFile('blacklist.json', [])
    this.initListFile('bannedWords.json', [])
    this.initListFile('muteCount.json', {})
  }

  /**
   * 迁移旧配置文件
   */
  migrateOldConfig() {
    const oldConfigPath = path.join(pluginRoot, 'config/config')
    const oldFiles = ['config.json', 'whitelist.json', 'blacklist.json', 'bannedWords.json', 'muteCount.json']

    for (const file of oldFiles) {
      const oldFile = path.join(oldConfigPath, file)
      const newFile = path.join(this.configPath, file)

      // 如果旧文件存在且新文件不存在，则迁移
      if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
        try {
          const content = fs.readFileSync(oldFile, 'utf8')
          fs.writeFileSync(newFile, content)
          logger.info(`[自动退群] 已迁移配置文件: ${file}`)
        } catch (err) {
          logger.error(`[自动退群] 迁移配置文件失败: ${file}`, err)
        }
      }
    }
  }

  /**
   * 迁移旧默认文案中的表情符号
   */
  migrateDefaultTexts(config) {
    for (const item of LEGACY_DEFAULT_TEXTS) {
      const value = lodash.get(config, item.path)
      if (item.legacy.includes(value)) {
        lodash.set(config, item.path, item.next)
      }
    }
  }

  /**
   * 获取 GroupEntry_Plugin 旧配置候选路径
   */
  getGroupEntryConfigCandidates() {
    return [
      path.join(pluginRoot, '..', 'GroupEntry_Plugin', 'config', 'config.json'),
      path.join(process.cwd(), 'plugins', 'GroupEntry_Plugin', 'config', 'config.json'),
      path.join(process.cwd(), 'yunzai-plugins', 'GroupEntry_Plugin', 'config', 'config.json')
    ]
  }

  /**
   * 读取第一个存在且可解析的 JSON 配置
   */
  readFirstJson(paths) {
    for (const filePath of paths) {
      try {
        if (!fs.existsSync(filePath)) {
          continue
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'))
      } catch (err) {
        logger.warn(`[自动退群] 读取旧群邀请配置失败 ${filePath}: ${err.message}`)
      }
    }
    return null
  }

  /**
   * 迁移 GroupEntry_Plugin 的机器人群邀请管理配置
   */
  migrateGroupEntryInviteConfig(mergedConfig, userConfig) {
    if (userConfig?.inviteManagement) {
      return
    }

    const legacyConfig = this.readFirstJson(this.getGroupEntryConfigCandidates())
    if (!legacyConfig) {
      return
    }

    const pendingRequests = Array.isArray(legacyConfig.pendingRequests)
      ? legacyConfig.pendingRequests.map(item => {
          const groupId = toId(item.groupId)
          const flag = String(item.flag || '').trim()
          return {
            requestId: String(item.requestId || `${groupId}-${flag || item.requestTime || Date.now()}`),
            msgIds: normalizeLegacyIds(item.msgIds ?? item.msgId),
            manageGroupIds: normalizeLegacyIds(item.manageGroupIds ?? item.manageGroupId),
            groupId,
            groupName: String(item.groupName || '未知群名'),
            userId: toId(item.userId),
            nickname: String(item.nickname || '未知用户'),
            flag,
            subType: String(item.subType || item.sub_type || 'invite'),
            requestTime: Number(item.requestTime || Date.now())
          }
        }).filter(item => item.groupId && item.flag)
      : []

    mergedConfig.inviteManagement = lodash.merge({}, DEFAULT_INVITE_MANAGEMENT, {
      enabled: true,
      reviewMode: [0, 1, 2, 3].includes(Number(legacyConfig.reviewMode)) ? Number(legacyConfig.reviewMode) : 2,
      requestExpireMinutes: Number(legacyConfig.requestExpireMinutes) || 5,
      maxPendingRequests: Number(legacyConfig.maxPendingRequests) || 20,
      allowInviterConfirm: legacyConfig.allowInviterConfirm !== false,
      notifyGroups: normalizeLegacyIds(legacyConfig.groups),
      notifyUsers: normalizeLegacyNotifyUsers(legacyConfig.notifyUsers),
      blackGroups: normalizeLegacyIds(legacyConfig.blackGroups),
      whiteGroups: normalizeLegacyIds(legacyConfig.whiteGroups),
      pendingRequests
    })

    logger.info('[自动退群] 已导入 GroupEntry_Plugin 群邀请管理配置')
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

      // 仅当用户仍在使用旧默认模板时，自动迁移到新的通知文案
      if (LEGACY_NOTIFICATION_MESSAGES.includes(mergedConfig?.notification?.message)) {
        mergedConfig.notification.message = DEFAULT_NOTIFICATION_MESSAGE
      }

      this.migrateDefaultTexts(mergedConfig)
      this.migrateGroupEntryInviteConfig(mergedConfig, userConfig)

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
