import fs from 'node:fs'
import path from 'node:path'
import lodash from 'lodash'
import schedule from 'node-schedule'
import { Config } from '../components/config.js'
import {
  TIME_UNIT,
  ROLE_MAP,
  formatDateTime,
  formatDuration,
  getBot,
  getGroup,
  getGroupMemberInfo,
  getGroupMemberList,
  getMemberDisplayName,
  kickGroupMember,
  muteGroupMember,
  normalizeId,
  setGroupWholeBan
} from '../utils/groupAdmin.js'

const dataRoot = path.join(process.cwd(), 'data/自动退群')
const groupAdminRoot = path.join(dataRoot, 'groupAdmin')
const groupBannedWordsFile = path.join(groupAdminRoot, 'groupBannedWords.json')
const muteTaskFile = path.join(groupAdminRoot, 'muteTasks.json')

const defaultGroupAdminState = {
  bannedWords: {},
  muteTime: 300,
  titleFilterModeChange: 0,
  titleBannedWords: []
}

function ensureDir() {
  if (!fs.existsSync(groupAdminRoot)) {
    fs.mkdirSync(groupAdminRoot, { recursive: true })
  }
}

function ensureJsonFile(filePath, defaultValue) {
  ensureDir()
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2))
  }
}

function readJson(filePath, defaultValue) {
  try {
    ensureJsonFile(filePath, defaultValue)
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (err) {
    logger.error(`[自动退群] 读取配置文件失败 ${filePath}: ${err.message}`)
    return lodash.cloneDeep(defaultValue)
  }
}

function writeJson(filePath, value) {
  ensureJsonFile(filePath, {})
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function getGroupStateAll() {
  return readJson(groupBannedWordsFile, {})
}

function saveGroupStateAll(data) {
  writeJson(groupBannedWordsFile, data)
}

function getGroupState(groupId) {
  const all = getGroupStateAll()
  const key = String(groupId)
  return lodash.merge({}, defaultGroupAdminState, all[key] || {})
}

function setGroupState(groupId, updater) {
  const all = getGroupStateAll()
  const key = String(groupId)
  const current = lodash.merge({}, defaultGroupAdminState, all[key] || {})
  const next = typeof updater === 'function' ? updater(current) : updater
  all[key] = lodash.merge({}, defaultGroupAdminState, next)
  saveGroupStateAll(all)
  return all[key]
}

export const bannedWordMatchTypeMap = {
  1: '精确',
  2: '模糊',
  3: '正则'
}

export const bannedWordPenaltyTypeMap = {
  1: '踢',
  2: '禁',
  3: '撤',
  4: '踢撤',
  5: '禁撤',
  6: '踢黑'
}

function escapeRegExp(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class GroupBannedWordsModel {
  constructor() {
    this.cache = new Map()
    this.muteTimeCache = new Map()
    this.titleCache = new Map()
  }

  getGroupState(groupId) {
    return getGroupState(groupId)
  }

  saveGroupState(groupId, state) {
    const result = setGroupState(groupId, state)
    this.cache.delete(String(groupId))
    this.muteTimeCache.delete(String(groupId))
    this.titleCache.delete(String(groupId))
    return result
  }

  addBannedWord(groupId, words, matchType = '精确', penaltyType = '禁', addedBy = '') {
    const state = this.getGroupState(groupId)
    if (state.bannedWords[words]) {
      throw new Error(`❎ 违禁词${words}已存在`)
    }

    const matchTypeId = Number(Object.entries(bannedWordMatchTypeMap).find(([, label]) => label === (matchType || '精确'))?.[0] || 1)
    const penaltyTypeId = Number(Object.entries(bannedWordPenaltyTypeMap).find(([, label]) => label === (penaltyType || '禁'))?.[0] || 2)
    state.bannedWords[words] = {
      matchType: matchTypeId,
      penaltyType: penaltyTypeId,
      addedBy,
      date: new Date().toISOString()
    }

    this.saveGroupState(groupId, state)
    return {
      words,
      matchType: bannedWordMatchTypeMap[matchTypeId],
      penaltyType: bannedWordPenaltyTypeMap[penaltyTypeId]
    }
  }

  deleteBannedWord(groupId, words) {
    const state = this.getGroupState(groupId)
    if (!state.bannedWords[words]) {
      throw new Error(`❎ 违禁词${words}不存在`)
    }
    delete state.bannedWords[words]
    this.saveGroupState(groupId, state)
    return words
  }

  queryBannedWord(groupId, words) {
    const state = this.getGroupState(groupId)
    const item = state.bannedWords[words]
    if (!item) {
      throw new Error(`❎ 违禁词${words}不存在`)
    }
    return {
      ...item,
      words,
      matchType: bannedWordMatchTypeMap[item.matchType] || '精确',
      penaltyType: bannedWordPenaltyTypeMap[item.penaltyType] || '禁'
    }
  }

  initTextArr(groupId) {
    const cacheKey = String(groupId)
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)
    }

    const state = this.getGroupState(groupId)
    const data = new Map()
    for (const [word, config] of Object.entries(state.bannedWords || {})) {
      const item = { ...config, rawItem: word }
      let reg = null
      try {
        if (item.matchType === 2) {
          reg = new RegExp(escapeRegExp(word))
        } else if (item.matchType === 3) {
          reg = new RegExp(word)
        } else {
          reg = new RegExp(`^${escapeRegExp(word)}$`)
        }
      } catch (err) {
        logger.warn(`[自动退群] 群 ${groupId} 违禁词正则无效 ${word}: ${err.message}`)
        continue
      }
      data.set(reg, item)
    }

    this.cache.set(cacheKey, data)
    return data
  }

  setMuteTime(groupId, time) {
    const state = this.getGroupState(groupId)
    state.muteTime = Number(time) || 300
    this.saveGroupState(groupId, state)
    return true
  }

  getMuteTime(groupId) {
    const cacheKey = String(groupId)
    if (this.muteTimeCache.has(cacheKey)) {
      return this.muteTimeCache.get(cacheKey)
    }
    const time = Number(this.getGroupState(groupId).muteTime || 300)
    this.muteTimeCache.set(cacheKey, time)
    return time
  }

  setTitleFilterModeChange(groupId) {
    const state = this.getGroupState(groupId)
    state.titleFilterModeChange = state.titleFilterModeChange ? 0 : 1
    this.saveGroupState(groupId, state)
    return state.titleFilterModeChange
  }

  getTitleFilterModeChange(groupId) {
    return Number(this.getGroupState(groupId).titleFilterModeChange || 0)
  }

  addTitleBannedWords(groupId, arr) {
    const state = this.getGroupState(groupId)
    state.titleBannedWords = [...new Set([...(state.titleBannedWords || []), ...arr.map(item => String(item).trim()).filter(Boolean)])]
    this.saveGroupState(groupId, state)
  }

  getTitleBannedWords(groupId) {
    const cacheKey = String(groupId)
    if (this.titleCache.has(cacheKey)) {
      return this.titleCache.get(cacheKey)
    }
    const list = this.getGroupState(groupId).titleBannedWords || []
    this.titleCache.set(cacheKey, list)
    return list
  }

  deleteTitleBannedWords(groupId, arr) {
    const set = new Set(arr.map(item => String(item).trim()))
    const state = this.getGroupState(groupId)
    state.titleBannedWords = (state.titleBannedWords || []).filter(item => !set.has(String(item)))
    this.saveGroupState(groupId, state)
  }
}

const muteJobs = new Map()

function taskKey(task) {
  return `${task.groupId}:${task.type}`
}

function normalizeTask(task) {
  return {
    groupId: Number(task.groupId),
    cron: String(task.cron).trim(),
    type: task.type === 'unmute' ? 'unmute' : 'mute',
    botId: String(task.botId || '')
  }
}

function loadTasks() {
  return readJson(muteTaskFile, [])
}

function saveTasks(tasks) {
  writeJson(muteTaskFile, tasks.map(normalizeTask))
}

async function executeMuteTask(task) {
  const bot = task.botId && Bot?.[task.botId] ? Bot[task.botId] : getBot(Bot)
  const group = getGroup(bot, task.groupId)
  if (!group) {
    logger.warn(`[自动退群] 定时${task.type === 'mute' ? '禁言' : '解禁'}找不到群 ${task.groupId}`)
    return
  }

  await setGroupWholeBan(bot, task.groupId, task.type === 'mute')
}

function registerTask(task) {
  const normalized = normalizeTask(task)
  const key = taskKey(normalized)
  muteJobs.get(key)?.cancel?.()

  const job = schedule.scheduleJob(normalized.cron, async () => {
    try {
      await executeMuteTask(normalized)
    } catch (err) {
      logger.error(`[自动退群] 执行定时${normalized.type === 'mute' ? '禁言' : '解禁'}失败: ${err.message}`)
    }
  })
  if (!job) {
    throw new Error(`无效的 cron 表达式: ${normalized.cron}`)
  }
  muteJobs.set(key, job)
}

export class GroupAdminService {
  constructor(e) {
    this.e = e
    this.bot = getBot(e)
  }

  static loadMuteTasks() {
    const tasks = loadTasks()
    for (const task of tasks) {
      try {
        registerTask(task)
      } catch (err) {
        logger.error(`[自动退群] 加载定时禁言任务失败: ${err.message}`)
      }
    }
  }

  async getMuteList(groupId, detail = false) {
    let list = []
    try {
      if (typeof this.bot.sendApi === 'function') {
        const res = await this.bot.sendApi('get_group_shut_list', { group_id: Number(groupId) })
        const apiList = res?.data || res?.response || res?.list
        if (Array.isArray(apiList)) {
          list = apiList.map(item => ({
            ...item,
            user_id: normalizeId(item.user_id ?? item.uin),
            shut_up_timestamp: Number(item.shut_up_timestamp || item.shutup_time || 0)
          }))
        }
      }
    } catch (err) {
      logger.debug?.(`[自动退群] 读取禁言列表接口失败: ${err.message}`)
    }

    if (list.length === 0) {
      const members = await getGroupMemberList(this.bot, groupId)
      list = members.filter(item => item.shut_up_timestamp && (item.shut_up_timestamp - Date.now() / 1000) > 0)
    }

    if (list.length === 0) {
      throw new Error('❎ 该群没有被禁言的人')
    }

    if (!detail) {
      return list
    }

    return list.map(item => [
      segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${item.user_id}`),
      `\n昵称：${item.card || item.nickname || item.user_id}\n`,
      `QQ：${item.user_id}\n`,
      `群身份：${ROLE_MAP[item.role] || '群员'}\n`,
      `禁言剩余时间：${formatDuration(item.shut_up_timestamp - Date.now() / 1000)}\n`,
      `禁言到期时间：${formatDateTime(item.shut_up_timestamp)}`
    ])
  }

  async releaseAllMute(groupId = this.e.group_id) {
    const list = await this.getMuteList(groupId)
    for (const item of list) {
      await muteGroupMember(this.bot, groupId, item.user_id, 0)
    }
  }

  async muteMember(groupId, userId, executor, time = 300, unit = '秒', config) {
    const groupConfig = config || Config.loadConfig()
    const group = getGroup(this.bot, groupId)
    if (!group) {
      throw new Error('❎ 未找到群对象')
    }

    const unitKey = String(unit || '秒').toUpperCase?.() ? String(unit || '秒').toUpperCase() : String(unit || '秒')
    const seconds = Math.max(0, Number(time) * (TIME_UNIT[unitKey] ?? TIME_UNIT[unit] ?? 60))
    const whiteUsers = (groupConfig.groupAdmin?.whiteQQ || []).map(item => Number(item))
    const masters = new Set([
      ...(groupConfig.masterQQ || []),
      ...((global.Bot?.cfg?.masterQQ) || []),
      ...((Bot?.cfg?.masterQQ) || [])
    ].map(item => Number(item)))
    const botRole = await getBotRole(this.bot, groupId, group)
    const isMaster = masters.has(Number(executor))

    const handleOne = async id => {
      const targetId = Number(id) || id
      if (!/^\d{5,}$/.test(String(targetId))) {
        throw new Error('❎ 请输入正确的QQ号')
      }
      if (time !== 0 && masters.has(Number(targetId))) {
        throw new Error('❎ 该命令对主人无效')
      }
      const info = await getGroupMemberInfo(this.bot, groupId, targetId, group)
      if (!info) {
        throw new Error(`❎ 该群没有${Array.isArray(userId) ? targetId : '这个人'}哦~`)
      }
      if (info.role === 'owner') {
        throw new Error('❎ 权限不足，该命令对群主无效')
      }
      if (info.role === 'admin') {
        if (botRole !== 'owner') {
          throw new Error('❎ 权限不足，需要群主权限')
        }
        if (!isMaster) {
          throw new Error('❎ 只有主人才能对管理执行该命令')
        }
      }
      if (time !== 0 && whiteUsers.includes(Number(targetId)) && !isMaster) {
        throw new Error(`❎ ${Array.isArray(userId) ? targetId : '该用户'}为白名单成员，不可操作`)
      }
      const ok = await muteGroupMember(this.bot, groupId, targetId, seconds)
      if (!ok) {
        throw new Error(`❎ ${time === 0 ? '解除禁言' : '禁言'}失败`)
      }
      return getMemberDisplayName(info, targetId)
    }

    if (Array.isArray(userId)) {
      const names = []
      for (const id of userId) {
        names.push(await handleOne(id))
      }
      return time === 0 ? `✅ 已将「${names.join('，')}」解除禁言` : `✅ 已将「${names.join('，')}」禁言${time}${unit}`
    }

    const name = await handleOne(userId)
    return time === 0 ? `✅ 已将「${name}」解除禁言` : `✅ 已将「${name}」禁言${time}${unit}`
  }

  async kickMember(groupId, userId, executor, block = false, config) {
    const groupConfig = config || Config.loadConfig()
    const group = getGroup(this.bot, groupId)
    if (!group) {
      throw new Error('❎ 未找到群对象')
    }

    const whiteUsers = (groupConfig.groupAdmin?.whiteQQ || []).map(item => Number(item))
    const masters = new Set([
      ...(groupConfig.masterQQ || []),
      ...((global.Bot?.cfg?.masterQQ) || []),
      ...((Bot?.cfg?.masterQQ) || [])
    ].map(item => Number(item)))
    const botRole = await getBotRole(this.bot, groupId, group)
    const isMaster = masters.has(Number(executor))

    const handleOne = async id => {
      const targetId = Number(id) || id
      if (!/^\d{5,}$/.test(String(targetId))) {
        throw new Error('❎ 请输入正确的QQ号')
      }
      if (masters.has(Number(targetId))) {
        throw new Error('❎ 该命令对主人无效')
      }
      const info = await getGroupMemberInfo(this.bot, groupId, targetId, group)
      if (!info) {
        throw new Error(`❎ 这个群没有${Array.isArray(userId) ? targetId : '这个人'}哦~`)
      }
      if (info.role === 'owner') {
        throw new Error('❎ 权限不足，该命令对群主无效')
      }
      if (info.role === 'admin') {
        if (botRole !== 'owner') {
          throw new Error('❎ 权限不足，需要群主权限')
        }
        if (!isMaster) {
          throw new Error('❎ 只有主人才能对管理执行该命令')
        }
      }
      if (whiteUsers.includes(Number(targetId)) && !isMaster) {
        throw new Error(`❎ ${Array.isArray(userId) ? targetId : '该用户'}是白名单成员，不可操作`)
      }

      const ok = await kickGroupMember(this.bot, groupId, targetId, !!block)
      if (!ok) {
        throw new Error(`❎ 踢出${targetId}失败`)
      }
      return targetId
    }

    if (Array.isArray(userId)) {
      const kicked = []
      for (const id of userId) {
        kicked.push(await handleOne(id))
      }
      return `✅ 已将「${kicked.join('，')}」踢出群聊`
    }

    return `✅ 已将「${await handleOne(userId)}」踢出群聊`
  }

  async noactiveList(groupId, times = 1, unit = '月') {
    const now = Math.floor(Date.now() / 1000)
    const limit = now - Number(times) * (TIME_UNIT[unit] ?? TIME_UNIT[String(unit).toUpperCase()] ?? TIME_UNIT.月)
    const members = await getGroupMemberList(this.bot, groupId)
    const botId = Number(this.bot?.uin || this.bot?.self_id)
    const list = members.filter(item => item.last_sent_time < limit && item.role === 'member' && Number(item.user_id) !== botId)
    if (list.length === 0) {
      throw new Error(`✅ 暂时没有${times}${unit}没发言的人`)
    }
    return list
  }

  async getNoactiveInfo(groupId, times, unit, page = 1) {
    const list = await this.noactiveList(groupId, times, unit)
    list.sort((a, b) => a.last_sent_time - b.last_sent_time)
    const msg = list.map(item => [
      segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${item.user_id}`),
      `\nQQ：${item.user_id}\n`,
      `昵称：${getMemberDisplayName(item, item.user_id)}\n`,
      `最后发言时间：${formatDateTime(item.last_sent_time)}`
    ])
    const pages = lodash.chunk(msg, 30)
    if (page > pages.length) {
      throw new Error('❎ 页数超过最大值')
    }
    const pageMsg = pages[page - 1]
    pageMsg.unshift(`当前为第${page}页，共${pages.length}页，本页共${pageMsg.length}人，总共${msg.length}人`)
    pageMsg.unshift(`以下为${times}${unit}没发言过的人`)
    if (page < pages.length) {
      pageMsg.splice(2, 0, `可用 "#查看${times}${unit}没发言过的人第${page + 1}页" 翻页`)
    }
    return pageMsg
  }

  async clearNoactive(groupId, times, unit, list = null) {
    const members = list || await this.noactiveList(groupId, times, unit)
    return this.batchKickMember(groupId, members.map(item => item.user_id))
  }

  async getNeverSpeak(groupId) {
    const members = await getGroupMemberList(this.bot, groupId)
    const botId = Number(this.bot?.uin || this.bot?.self_id)
    const list = members.filter(item => item.join_time === item.last_sent_time && item.role === 'member' && Number(item.user_id) !== botId)
    if (list.length === 0) {
      throw new Error('✅ 本群暂无从未发言的人')
    }
    return list
  }

  async getNeverSpeakInfo(groupId, page = 1, list = null) {
    const members = list || await this.getNeverSpeak(groupId)
    members.sort((a, b) => a.join_time - b.join_time)
    const msg = members.map(item => [
      segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${item.user_id}`),
      `\nQQ：${item.user_id}\n`,
      `昵称：${getMemberDisplayName(item, item.user_id)}\n`,
      `进群时间：${formatDateTime(item.join_time)}`
    ])
    const pages = lodash.chunk(msg, 30)
    if (page > pages.length) {
      throw new Error('哪有那么多人辣o(´^｀)o')
    }
    const pageMsg = pages[page - 1]
    pageMsg.unshift(`当前为第${page}页，共${pages.length}页，本页共${pageMsg.length}人，总共${msg.length}人`)
    pageMsg.unshift('以下为进群后从未发言过的人')
    if (page < pages.length) {
      pageMsg.splice(2, 0, `可用 "#查看从未发言过的人第${page + 1}页" 翻页`)
    }
    return pageMsg
  }

  async inactiveRanking(groupId, num) {
    const members = await getGroupMemberList(this.bot, groupId)
    members.sort((a, b) => a.last_sent_time - b.last_sent_time)
    const msg = members.slice(0, num).map((item, index) => [
      `第${index + 1}名：\n`,
      segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${item.user_id}`),
      `\nQQ：${item.user_id}\n`,
      `昵称：${getMemberDisplayName(item, item.user_id)}\n`,
      `最后发言时间：${formatDateTime(item.last_sent_time)}`
    ])
    msg.unshift(`不活跃排行榜top1 - top${num}`)
    return msg
  }

  async getRecentlyJoined(groupId, num) {
    const members = await getGroupMemberList(this.bot, groupId)
    members.sort((a, b) => b.join_time - a.join_time)
    const msg = members.slice(0, num).map(item => [
      segment.image(`https://q1.qlogo.cn/g?b=qq&s=100&nk=${item.user_id}`),
      `\nQQ：${item.user_id}\n`,
      `昵称：${getMemberDisplayName(item, item.user_id)}\n`,
      `入群时间：${formatDateTime(item.join_time)}\n`,
      `最后发言时间：${formatDateTime(item.last_sent_time)}`
    ])
    msg.unshift(`最近的${num}条入群记录`)
    return msg
  }

  async batchKickMember(groupId, arr) {
    const targets = [...new Set(arr.map(item => Number(item)).filter(item => !Number.isNaN(item)))]
    const res = ['以下为每次清理的结果']

    try {
      if (typeof this.bot.sendApi === 'function') {
        const apiRes = await this.bot.sendApi('set_group_kick_members', {
          group_id: Number(groupId),
          user_ids: targets
        })
        const data = apiRes?.data || apiRes?.response || apiRes
        if (data && data.ul) {
          res.push(`成功清理如下人员\n${data.ul.map((item, index) => `${index + 1}、${item}`).join('\n')}`)
          return res
        }
      }
    } catch (err) {
      logger.debug?.(`[自动退群] 批量踢人接口失败: ${err.message}`)
    }

    const okList = []
    const failList = []
    for (const userId of targets) {
      const ok = await kickGroupMember(this.bot, groupId, userId)
      if (ok) {
        okList.push(userId)
      } else {
        failList.push(userId)
      }
    }
    if (okList.length > 0) {
      res.push(`成功清理如下人员\n${okList.map((item, index) => `${index + 1}、${item}`).join('\n')}`)
    }
    if (failList.length > 0) {
      res.push(`以下人员清理失败\n${failList.join('\n')}`)
    }
    return res
  }

  async setMuteTask(groupId, cron, type, botId) {
    const taskType = type ? 'mute' : 'unmute'
    const tasks = loadTasks()
    if (tasks.find(item => Number(item.groupId) === Number(groupId) && item.type === taskType)) {
      return false
    }
    const task = normalizeTask({ groupId, cron, type: taskType, botId: botId || this.bot?.uin || this.bot?.self_id })
    registerTask(task)
    tasks.push(task)
    saveTasks(tasks)
    return true
  }

  async deleteMuteTask(groupId, type) {
    const taskType = type ? 'mute' : 'unmute'
    const tasks = loadTasks().filter(item => !(Number(item.groupId) === Number(groupId) && item.type === taskType))
    saveTasks(tasks)
    const key = taskKey({ groupId: Number(groupId), type: taskType })
    muteJobs.get(key)?.cancel?.()
    muteJobs.delete(key)
    return true
  }

  getMuteTask() {
    const tasks = loadTasks()
    const grouped = new Map()
    for (const item of tasks) {
      const key = Number(item.groupId)
      const current = grouped.get(key) || {}
      current.groupId = key
      if (item.type === 'mute') {
        current.cron = item.cron
      } else {
        current.nocron = item.cron
      }
      grouped.set(key, current)
    }
    const result = []
    for (const [groupId, item] of grouped.entries()) {
      result.push([
        segment.image(`https://p.qlogo.cn/gh/${groupId}/${groupId}/100`),
        `\n群号：${groupId}`,
        item.cron ? `\n禁言时间："${item.cron}"` : '',
        item.nocron ? `\n解禁时间："${item.nocron}"` : ''
      ])
    }
    return result
  }
}

function getBotRole(bot, groupId, groupObj = null) {
  return groupObj?.is_owner ? 'owner' : groupObj?.is_admin ? 'admin' : 'member'
}

export const GroupBannedWords = new GroupBannedWordsModel()
