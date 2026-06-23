import { Config } from '../../components/config.js'
import { getUserBlacklist } from '../../utils/yunzaiConfig.js'
import { getInviteConfig } from '../inviteManagement.js'

function toGroupSelectValues(value) {
  const list = Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value])
  const groups = []

  for (const item of list) {
    const raw = typeof item === 'object' && item !== null
      ? (item.group_id ?? item.groupId ?? item.value ?? item.id)
      : item
    const text = String(raw ?? '').trim()
    if (!/^\d+$/.test(text)) {
      continue
    }

    const groupId = Number(text)
    if (Number.isFinite(groupId) && groupId > 0) {
      groups.push(groupId)
    }
  }

  return [...new Set(groups)]
}

function toFriendSelectValues(value) {
  const list = Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value])
  const friends = []

  for (const item of list) {
    const raw = typeof item === 'object' && item !== null
      ? (item.user_id ?? item.userId ?? item.value ?? item.id ?? item.qq)
      : item
    const text = String(raw ?? '').trim()
    if (!/^\d+$/.test(text)) {
      continue
    }

    const userId = Number(text)
    if (Number.isFinite(userId) && userId > 0) {
      friends.push(userId)
    }
  }

  return [...new Set(friends)]
}

/**
 * 获取配置数据
 */
export async function getConfigData() {
  const config = Config.loadConfig() || {}
  const bannedWords = Config.getBannedWords() || []
  const whitelistGroups = Config.getWhitelist() || []
  const blacklistGroups = Config.getBlacklist() || []
  const blacklistUsers = getUserBlacklist() || []
  const inviteManagement = getInviteConfig(config)

  return {
    ...config,
    inviteManagement: {
      ...(config.inviteManagement || {}),
      ...inviteManagement,
      notifyGroups: toGroupSelectValues(inviteManagement.notifyGroups),
      notifyUsers: toFriendSelectValues(inviteManagement.notifyUsers),
      blackGroups: toGroupSelectValues(inviteManagement.blackGroups),
      whiteGroups: toGroupSelectValues(inviteManagement.whiteGroups),
      pendingRequests: config.inviteManagement?.pendingRequests || []
    },
    groupAdmin: {
      ...(config.groupAdmin || {}),
      whiteQQ: toFriendSelectValues(config.groupAdmin?.whiteQQ),
      groupVerify: {
        ...(config.groupAdmin?.groupVerify || {}),
        openGroup: toGroupSelectValues(config.groupAdmin?.groupVerify?.openGroup),
        successMsgs: Object.entries(config.groupAdmin?.groupVerify?.successMsgs || {}).map(([groupId, msg]) => ({
          groupId: String(groupId),
          msg: String(msg)
        }))
      },
      groupAddNotice: {
        ...(config.groupAdmin?.groupAddNotice || {}),
        openGroup: toGroupSelectValues(config.groupAdmin?.groupAddNotice?.openGroup)
      }
    },
    // 违禁词列表（数组格式，用于 GTags 组件）
    bannedWordsList: bannedWords.map(String),
    // 群选择器使用数字数组，保证刷新后可按群号回显群名称
    whitelistGroups: toGroupSelectValues(whitelistGroups),
    blacklistGroups: toGroupSelectValues(blacklistGroups),
    // 好友选择器使用数字数组，保证刷新后可按 QQ 号回显昵称
    blacklistUsers: toFriendSelectValues(blacklistUsers)
  }
}
