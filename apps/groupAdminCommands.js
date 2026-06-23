import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../components/config.js'
import { GroupAdminService, GroupBannedWords, bannedWordMatchTypeMap, bannedWordPenaltyTypeMap } from '../model/groupAdminConfig.js'
import { hasVerifySession, passVerify, reverifyUser, startVerifyForUser } from '../model/groupAdminRuntime.js'
import {
  TIME_UNIT,
  addGroupAdminBlacklist,
  checkPermission,
  deleteGroupEssenceMessage,
  deleteGroupNotice,
  extractAtIds,
  getGroupNoticeList,
  getMessageText,
  getQuotedMessage,
  kickGroupMember,
  muteGroupMember,
  normalizeId,
  recallGroupMessage,
  sendForwardMsg,
  sendGroupNotice,
  setGroupAdminRole,
  setGroupEssenceMessage,
  setGroupSpecialTitle,
  setGroupWholeBan,
  translateChinaNum
} from '../utils/groupAdmin.js'

const Numreg = '[零一壹二两三四五六七八九十百千万亿\\d]+'
const TimeUnitReg = Object.keys(TIME_UNIT).join('|')
const noactiveReg = new RegExp(`^#(查看|清理|获取)(${Numreg})个?(${TimeUnitReg})(?:没|未)发言的人(第(${Numreg})页)?$`)
const autisticReg = new RegExp(`^#?我要(自闭|禅定)(${Numreg})?个?(${TimeUnitReg})?$`, 'i')

function getGroupConfig() {
  return Config.loadConfig()
}

function getService(e) {
  return new GroupAdminService(e)
}

async function withForwardReply(e, messages, title) {
  return sendForwardMsg(e, messages, { title })
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseMuteCommand(e) {
  const text = getMessageText(e)
  const atIds = extractAtIds(e)
  const explicitUser = text.match(/^#禁言\s*(\d{5,})/)?.[1]
  const target = atIds[0] || explicitUser || ''
  let tail = text.replace(/^#禁言/, '').trim()

  if (explicitUser && tail.startsWith(explicitUser)) {
    tail = tail.slice(explicitUser.length).trim()
  }

  const durationMatch = tail.match(new RegExp(`(${Numreg})\\s*(${TimeUnitReg})?`))
  return {
    target,
    time: translateChinaNum(durationMatch?.[1] || 5) || 5,
    unit: durationMatch?.[2] || '分'
  }
}

function isGroupAdminFeatureEnabled(key = '', config = getGroupConfig()) {
  const groupAdmin = config.groupAdmin || {}
  if (groupAdmin.enabled !== true) {
    return false
  }
  return key ? groupAdmin[key] !== false : true
}

function isWhitelistGroup(groupId) {
  return Config.getWhitelist().map(item => String(item)).includes(String(groupId))
}

function getBlacklistScopeStatus(e, config = getGroupConfig()) {
  if (!isWhitelistGroup(e.group_id)) {
    return { ok: false, message: '踢黑仅对白名单群聊开放' }
  }
  if (!config.whitelistManagement?.enabled || !config.whitelistManagement?.enableUserBlacklist) {
    return { ok: false, message: '用户黑名单功能未开启' }
  }
  return { ok: true, message: '' }
}

function canUseUserBlacklist(e, config = getGroupConfig()) {
  return getBlacklistScopeStatus(e, config).ok
}

export class GroupAdminCommands extends plugin {
  constructor() {
    super({
      name: '自动退群:群管命令',
      dsc: '迁移自 yenai 的群管理功能，适配 NapCat/OneBot',
      event: 'message.group',
      priority: 500,
      rule: [
        { reg: `^#禁言\\s?((\\d+)\\s)?(${Numreg})?(${TimeUnitReg})?$`, fnc: 'muteMember' },
        { reg: '^#解禁(\\d+)?$', fnc: 'unmuteMember' },
        { reg: '^#全(体|员)(禁言|解禁)$', fnc: 'muteAll' },
        { reg: '^#踢黑?(\\d+)?$', fnc: 'kickMember' },
        { reg: '^#(设置|取消)管理(\\d+)?$', fnc: 'setAdmin' },
        { reg: '^#(修改|设置)头衔', fnc: 'setUserTitle' },
        { reg: '^#(申请|我要)头衔', fnc: 'applyOwnTitle' },
        { reg: '^#(获取|查看)?禁言列表$', fnc: 'muteList' },
        { reg: '^#解除全部禁言$', fnc: 'relieveAllMute' },
        { reg: `^#(查看|清理)从未发言过?的人(第(${Numreg})页)?$`, fnc: 'neverSpeak' },
        { reg: `^#(查看|获取)?(不活跃|潜水)排行榜(${Numreg})?$`, fnc: 'rankingList' },
        { reg: `^#(查看|获取)?最近的?入群(情况|记录)(${Numreg})?$`, fnc: 'recentlyJoined' },
        { reg: noactiveReg, fnc: 'noactive' },
        { reg: '^#发通知', fnc: 'sendNotice' },
        { reg: '^#(设置)?定时(禁言|解禁)(.*)$|^#定时禁言任务$|^#取消定时(禁言|解禁)$', fnc: 'timeMute' },
        { reg: '^#?(开启|关闭)加群通知$', fnc: 'handleGroupAdd' },
        { reg: '^#?(加|设|移)精$', fnc: 'essenceMessage' },
        { reg: autisticReg, fnc: 'autistic' }
      ]
    })
  }

  async muteMember(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const { target, time, unit } = parseMuteCommand(e)
    try {
      const res = await getService(e).muteMember(e.group_id, target, e.user_id, time, unit, getGroupConfig())
      await e.reply(res)
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async unmuteMember(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    let qq = extractAtIds(e)
    if (qq.length < 2) {
      qq = qq[0] || getMessageText(e).match(/#解禁(\d+)/)?.[1]
    }
    try {
      const res = await getService(e).muteMember(e.group_id, qq, e.user_id, 0, '秒', getGroupConfig())
      await e.reply(res)
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async muteAll(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const enable = /全(体|员)禁言/.test(getMessageText(e))
    const ok = await setGroupWholeBan(e, e.group_id, enable)
    await e.reply(ok ? `已${enable ? '开启' : '关闭'}全体禁言` : '未知错误', true)
    return true
  }

  async kickMember(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    let qq = extractAtIds(e)
    if (qq.length < 2) {
      qq = qq[0] || getMessageText(e).replace(/#|踢黑?/g, '').trim()
    }

    try {
      const config = getGroupConfig()
      const block = /黑/.test(getMessageText(e))
      if (block) {
        const scope = getBlacklistScopeStatus(e, config)
        if (!scope.ok) {
          await e.reply(scope.message, true)
          return true
        }
      }
      const res = await getService(e).kickMember(e.group_id, qq, e.user_id, block, getGroupConfig())
      await e.reply(res)
      if (block) {
        const ids = Array.isArray(qq) ? qq : [qq]
        for (const id of ids) {
          addGroupAdminBlacklist(id, '群管踢黑')
        }
      }
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async setAdmin(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'master', 'owner')) return true
    let qq = extractAtIds(e)
    if (qq.length < 1) {
      qq = [getMessageText(e).replace(/#|(设置|取消)管理/g, '').trim()]
    }
    if (!qq || !/\d{5,}/.test(String(qq[0] || ''))) {
      await e.reply('请输入正确的QQ号')
      return true
    }

    const add = /设置管理/.test(getMessageText(e))
    const names = []
    for (const id of qq) {
      const ok = await setGroupAdminRole(e, e.group_id, id, add)
      if (!ok) {
        await e.reply(`设置 ${id} 失败`)
        return true
      }
      let info = null
      try {
        if (typeof getService(e).bot.sendApi === 'function') {
          info = await getService(e).bot.sendApi('get_group_member_info', {
            group_id: Number(e.group_id),
            user_id: Number(id),
            no_cache: false
          })
        }
      } catch {}
      const data = info?.data || info?.response
      names.push(data?.card || data?.nickname || String(id))
    }
    await e.reply(add ? `已将「${names.join('，')}」设置为管理` : `已取消「${names.join('，')}」的管理`)
    return true
  }

  async setUserTitle(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'master', 'owner')) return true
    const qq = extractAtIds(e)[0]
    if (!qq) {
      await e.reply('请艾特要修改的人')
      return true
    }
    const text = getMessageText(e).replace(/#?(修改|设置)头衔/g, '').trim()
    const ok = await setGroupSpecialTitle(e, e.group_id, qq, text)
    await e.reply(ok ? `已将头衔设置为「${text}」` : '未知错误')
    return true
  }

  async applyOwnTitle(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'all', 'owner')) return true
    const title = getMessageText(e).replace(/#(申请|我要)头衔/g, '').trim()
    const filterMode = GroupBannedWords.getTitleFilterModeChange(e.group_id)
    const bannedWords = GroupBannedWords.getTitleBannedWords(e.group_id).filter(Boolean)

    if (!e.isMaster && bannedWords.length > 0) {
      const reg = new RegExp(bannedWords.map(escapeRegExp).join('|'))
      if ((filterMode ? reg.test(title) : bannedWords.includes(title))) {
        await e.reply('包含违禁词', true)
        return true
      }
    }

    const ok = await setGroupSpecialTitle(e, e.group_id, e.user_id, title)
    await e.reply(ok ? `已将你的头衔更换为「${title}」` : '未知错误', true)
    return true
  }

  async muteList(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    try {
      const res = await getService(e).getMuteList(e.group_id, true)
      await withForwardReply(e, res, '禁言列表')
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async relieveAllMute(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    try {
      await getService(e).releaseAllMute(e.group_id)
      await e.reply('已将全部禁言解除')
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async noactive(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    const role = getMessageText(e).includes('查看') ? 'all' : 'admin'
    if (!await checkPermission(e, 'admin', role)) return true
    const regRet = noactiveReg.exec(getMessageText(e))
    regRet[2] = translateChinaNum(regRet[2] || 1)
    try {
      if (regRet[1] === '清理') {
        const list = await getService(e).noactiveList(e.group_id, regRet[2], regRet[3])
        e.groupAdminCleanupContext = {
          type: 'noactive',
          params: regRet,
          list
        }
        this.setContext('confirmCleanup')
        await e.reply([`本次共需清理「${list.length}」人\n`, '请发送："#确认清理" 开始清理'])
        return true
      }
      const page = translateChinaNum(regRet[5] || 1)
      const msg = await getService(e).getNoactiveInfo(e.group_id, regRet[2], regRet[3], page)
      await withForwardReply(e, msg, getMessageText(e).replace(/#|查看|清理/g, ''))
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async confirmCleanup(ctx) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    const e = this.e
    if (/^#?确认清理$/.test(getMessageText(e))) {
      try {
        if (ctx.groupAdminCleanupContext?.type === 'noactive') {
          const msg = await getService(e).clearNoactive(
            e.group_id,
            ctx.groupAdminCleanupContext.params[2],
            ctx.groupAdminCleanupContext.params[3],
            ctx.groupAdminCleanupContext.list
          )
          await withForwardReply(e, msg, '清理结果')
        } else if (ctx.groupAdminCleanupContext?.type === 'neverSpeak') {
          await e.reply('开始清理，这可能需要一点时间')
          const msg = await getService(e).batchKickMember(e.group_id, ctx.groupAdminCleanupContext.list.map(item => item.user_id))
          await withForwardReply(e, msg, '清理结果')
        }
      } catch (err) {
        await e.reply(err.message || String(err))
      }
    } else {
      await e.reply('已取消')
    }
    this.finish('confirmCleanup')
    return true
  }

  async neverSpeak(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    const role = getMessageText(e).includes('查看') ? 'all' : 'admin'
    if (!await checkPermission(e, 'admin', role)) return true
    try {
      const list = await getService(e).getNeverSpeak(e.group_id)
      if (/^#?清理/.test(getMessageText(e))) {
        this.setContext('confirmCleanup')
        e.groupAdminCleanupContext = {
          type: 'neverSpeak',
          list
        }
        await e.reply([`本次共需清理「${list.length}」人，防止误触发\n`, '请发送："#确认清理" 开始清理'])
      } else {
        const page = translateChinaNum(getMessageText(e).match(new RegExp(Numreg))?.[0] || 1)
        const res = await getService(e).getNeverSpeakInfo(e.group_id, page, list)
        await withForwardReply(e, res, '从未发言')
      }
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async rankingList(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    const num = translateChinaNum(getMessageText(e).match(new RegExp(Numreg))?.[0] || 10)
    const msg = await getService(e).inactiveRanking(e.group_id, num)
    await withForwardReply(e, msg, '不活跃排行')
    return true
  }

  async recentlyJoined(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    const num = translateChinaNum(getMessageText(e).match(new RegExp(Numreg))?.[0] || 10)
    const msg = await getService(e).getRecentlyJoined(e.group_id, num)
    await withForwardReply(e, msg, '最近入群')
    return true
  }

  async sendNotice(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const message = Array.isArray(e.message) ? [...e.message] : []
    if (message[0]?.text) {
      message[0].text = message[0].text.replace('#发通知', '').trim()
      if (!message[0].text) {
        message.shift()
      }
    }
    if (message.length === 0) {
      await e.reply('通知不能为空')
      return true
    }
    message.unshift(segment.at('all'))
    await e.reply(message)
    return true
  }

  async timeMute(e) {
    if (!isGroupAdminFeatureEnabled('scheduledMuteEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const text = getMessageText(e)
    const type = /禁言/.test(text)
    try {
      if (/任务/.test(text)) {
        const task = getService(e).getMuteTask()
        if (!task.length) {
          await e.reply('目前还没有定时禁言任务')
          return true
        }
        await withForwardReply(e, task, '定时禁言任务')
        return true
      }
      if (/取消/.test(text)) {
        await getService(e).deleteMuteTask(e.group_id, type)
        await e.reply(`已取消本群定时${type ? '禁言' : '解禁'}`)
        return true
      }

      const regRet = text.match(/定时(禁言|解禁)((\d{1,2})(:|：)(\d{1,2})|.*)/)
      if (!regRet || !regRet[2]) {
        await e.reply(`格式不对\n示范：#定时${type ? '禁言' : '解禁'}00:00 或 #定时${type ? '禁言' : '解禁'} + cron表达式`)
        return true
      }
      const cron = regRet[3] && regRet[5] ? `0 ${regRet[5]} ${regRet[3]} * * ?` : regRet[2]
      const ok = await getService(e).setMuteTask(e.group_id, cron.trim(), type, e.self_id ?? getService(e).bot?.uin)
      await e.reply(ok ? '设置定时禁言成功，可发【#定时禁言任务】查看' : `该群定时${type ? '禁言' : '解禁'}已存在不可重复设置`)
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async handleGroupAdd(e) {
    if (!isGroupAdminFeatureEnabled('noticeEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const config = getGroupConfig()
    const type = /开启/.test(getMessageText(e)) ? 'add' : 'del'
    const openGroups = config.groupAdmin?.groupAddNotice?.openGroup || []
    const isOpen = openGroups.includes(Number(e.group_id))
    if (isOpen && type === 'add') {
      await e.reply('本群加群申请通知已处于开启状态')
      return true
    }
    if (!isOpen && type === 'del') {
      await e.reply('本群暂未开启加群申请通知')
      return true
    }
    const nextOpenGroups = type === 'add'
      ? [...new Set([...openGroups, Number(e.group_id)])]
      : openGroups.filter(item => Number(item) !== Number(e.group_id))
    config.groupAdmin.groupAddNotice.openGroup = nextOpenGroups
    Config.saveConfig(config)
    await e.reply(`已${type === 'add' ? '开启' : '关闭'}「${e.group_id}」的加群申请通知`)
    return true
  }

  async essenceMessage(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const source = await getQuotedMessage(e)
    if (!source) {
      await e.reply('请对要加精的消息进行引用')
      return true
    }
    const isAdd = getMessageText(e).match(/加|设|移/)?.[0]
    const messageId = source.message_id || source.messageId
    const ok = isAdd === '加' || isAdd === '设'
      ? await setGroupEssenceMessage(e, messageId)
      : await deleteGroupEssenceMessage(e, messageId)
    await e.reply(ok ? `已${isAdd === '移' ? '移出' : '设置'}精华消息` : `${isAdd}精失败`)
    return true
  }

  async autistic(e) {
    if (!isGroupAdminFeatureEnabled('commandsEnabled')) return false
    const group = e.group
    if (!group?.is_admin && !group?.is_owner) return true
    if (e.isMaster || (e.member?.is_admin && !group?.is_owner)) {
      await e.reply('已取消操作', true)
      return true
    }
    const regRet = autisticReg.exec(getMessageText(e))
    const tabooTime = translateChinaNum(regRet?.[2] || 5)
    const unit = TIME_UNIT[String(regRet?.[3] || '分').toUpperCase()] ?? TIME_UNIT[regRet?.[3] || '分'] ?? 60
    await muteGroupMember(e, e.group_id, e.user_id, tabooTime * unit)
    await e.reply('已禁言', true)
    return true
  }
}

export class GroupBannedWordsCommands extends plugin {
  constructor() {
    super({
      name: '自动退群:群违禁词',
      dsc: '群聊内细粒度违禁词管理',
      event: 'message.group',
      priority: 1,
      rule: [
        { reg: '^#?新增(模糊|精确|正则1|正则2|正则)?(踢|禁|撤|踢撤|禁撤|踢黑)?违禁词', fnc: 'add' },
        { reg: '^#?删除违禁词', fnc: 'deleteWord' },
        { reg: '^#?查看违禁词', fnc: 'query' },
        { reg: '^#?违禁词列表(原始|raw)?$', fnc: 'list' },
        { reg: '^#?设置违禁词禁言时间(\\d+)$', fnc: 'muteTime' },
        { reg: '^#(增加|减少|查看)头衔屏蔽词', fnc: 'prohibitedTitle' },
        { reg: '^#切换头衔屏蔽词匹配(模式)?$', fnc: 'prohibitedTitlePattern' },
        { reg: '^#?违禁词帮助$', fnc: 'help' }
      ]
    })
  }

  get message() {
    return getMessageText(this.e)
  }

  trimAlias(msg) {
    return String(msg || '').trim()
  }

  async accept(e) {
    const config = getGroupConfig()
    if (!isGroupAdminFeatureEnabled('bannedWordsEnabled', config)) {
      return false
    }
    const isWhite = (config.groupAdmin?.whiteQQ || []).includes(Number(e.user_id))
    if (!e.message || e.isMaster || e.member?.is_owner || e.member?.is_admin || isWhite) {
      return false
    }
    const bannedWords = GroupBannedWords.initTextArr(e.group_id)
    if (!bannedWords || bannedWords.size === 0) {
      return false
    }

    const trimmed = this.trimAlias(this.message)
    let data = null
    for (const [reg, value] of bannedWords) {
      if (reg.test(trimmed)) {
        data = value
        break
      }
    }
    if (!data) {
      return false
    }

    const muteTime = GroupBannedWords.getMuteTime(e.group_id)
    const actions = {
      1: async () => kickGroupMember(e, e.group_id, e.user_id, false),
      2: async () => muteGroupMember(e, e.group_id, e.user_id, muteTime),
      3: async () => recallGroupMessage(e, e.message_id),
      4: async () => {
        await kickGroupMember(e, e.group_id, e.user_id, false)
        await recallGroupMessage(e, e.message_id)
      },
      5: async () => {
        await muteGroupMember(e, e.group_id, e.user_id, muteTime)
        await recallGroupMessage(e, e.message_id)
      },
      6: async () => {
        const useBlacklist = canUseUserBlacklist(e, config)
        if (useBlacklist) {
          addGroupAdminBlacklist(e.user_id, '群违禁词踢黑')
        }
        await kickGroupMember(e, e.group_id, e.user_id, useBlacklist)
      }
    }

    const actionLabels = {
      1: '踢出群聊',
      2: `禁言${muteTime}秒`,
      3: '撤回消息',
      4: '踢出群聊并撤回消息',
      5: `禁言${muteTime}秒并撤回消息`,
      6: canUseUserBlacklist(e, config) ? '踢出群聊并加入黑名单' : '踢出群聊'
    }

    if (actions[data.penaltyType]) {
      await actions[data.penaltyType]()
      const senderCard = e.sender?.card || e.sender?.nickname || e.nickname || e.user_id
      const rawWord = data.rawItem || ''
      const masked = rawWord.length > 2 ? rawWord.slice(0, 2) + '*'.repeat(Math.max(0, rawWord.length - 2)) : rawWord
      await e.reply([
        `触发违禁词：${masked}\n`,
        `触发者：${senderCard}(${e.user_id})\n`,
        `执行：${actionLabels[data.penaltyType]}`
      ], false, { recallMsg: 30 })
      return 'return'
    }

    return false
  }

  async help(e) {
    if (!isGroupAdminFeatureEnabled('bannedWordsEnabled')) return false
    const msg = [
      '该命令匹配正则：',
      '^#?新增(模糊|精确|正则1|正则2|正则)?(踢|禁|撤|踢撤|禁撤|踢黑)?违禁词',
      '-------------------',
      '支持的模式：模糊，精确，正则1，正则2',
      '支持的处理方式：踢，禁，撤，踢撤，禁撤，踢黑',
      '-------------------',
      '命令示例：',
      '"#新增违禁词123" --- 默认添加精确禁违禁词',
      '"#新增正则1违禁词^123456$" --- 该种方法需将"\\"转义，如：\\d+\\d+\\d+',
      '"#新增正则2违禁词/^123456$/" --- 该种方法无需转义',
      '"#新增模糊踢违禁词123" --- 添加模糊匹配处理方法为踢出群聊的正则'
    ].join('\n')
    await e.reply(msg)
    return true
  }

  async add(e) {
    if (!isGroupAdminFeatureEnabled('bannedWordsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const word = this.trimAlias(this.message)
    let [, matchType, penaltyType, words] = word.match(/#?新增(模糊|精确|正则1|正则2|正则)?(踢|禁|撤|踢撤|禁撤|踢黑)?违禁词(.*)/) || []
    if (!words) {
      return this.help(e)
    }
    if (penaltyType === '踢黑') {
      const scope = getBlacklistScopeStatus(e)
      if (!scope.ok) {
        await e.reply(scope.message, true)
        return true
      }
    }

    let storedWord = words.trim()
    if (/正则(1|2)?/.test(matchType || '')) {
      try {
        if (matchType === '正则2') {
          storedWord = storedWord.replace(/^\/|\/$/g, '')
        }
        new RegExp(storedWord)
      } catch (err) {
        await e.reply('正则表达式错误')
        return true
      }
      matchType = '正则'
    }

    try {
      const res = GroupBannedWords.addBannedWord(e.group_id, storedWord, matchType || '精确', penaltyType || '禁', e.user_id)
      await e.reply([
        '成功添加屏蔽词\n',
        '屏蔽词：',
        res.words,
        `\n匹配模式：${res.matchType}\n`,
        `处理方式：${res.penaltyType}`
      ])
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async deleteWord(e) {
    if (!isGroupAdminFeatureEnabled('bannedWordsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const word = this.trimAlias(this.message).replace(/#?删除违禁词/, '').trim()
    if (!word) {
      await e.reply('需要删除的屏蔽词为空')
      return true
    }
    try {
      const msg = GroupBannedWords.deleteBannedWord(e.group_id, word)
      await e.reply(['成功删除：', msg])
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async query(e) {
    if (!isGroupAdminFeatureEnabled('bannedWordsEnabled')) return false
    const word = this.trimAlias(this.message).replace(/#?查看违禁词/, '').trim()
    if (!word) {
      await e.reply('需要查询的屏蔽词为空')
      return true
    }
    try {
      const { words, matchType, penaltyType, addedBy, date } = GroupBannedWords.queryBannedWord(e.group_id, word)
      await e.reply([
        '查询屏蔽词\n',
        '屏蔽词：',
        words,
        `\n匹配模式：${matchType}\n`,
        `处理方式：${penaltyType}\n`,
        `添加人：${addedBy ?? '未知'}\n`,
        `添加时间：${date ?? '未知'}`
      ])
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async list(e) {
    if (!isGroupAdminFeatureEnabled('bannedWordsEnabled')) return false
    const bannedWords = GroupBannedWords.initTextArr(e.group_id)
    if (!bannedWords || bannedWords.size === 0) {
      await e.reply('没有违禁词')
      return true
    }
    const isRaw = /(原始)|(raw)/.test(getMessageText(e))
    const msg = []
    for (const [, value] of bannedWords) {
      msg.push([
        '屏蔽词：',
        isRaw ? value.rawItem : value.rawItem,
        `\n匹配模式：${bannedWordMatchTypeMap[value.matchType]}\n`,
        `处理方式：${bannedWordPenaltyTypeMap[value.penaltyType]}\n`,
        `添加人：${value.addedBy ?? '未知'}\n`,
        `添加时间：${value.date ?? '未知'}`
      ])
    }
    await withForwardReply(e, msg, '违禁词列表')
    return true
  }

  async muteTime(e) {
    if (!isGroupAdminFeatureEnabled('bannedWordsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const time = Number(getMessageText(e).match(/\d+/)?.[0] || 300)
    GroupBannedWords.setMuteTime(e.group_id, time)
    await e.reply(`群${e.group_id}违禁词禁言时间已设置为${time}s`)
    return true
  }

  async prohibitedTitle(e) {
    if (!isGroupAdminFeatureEnabled('bannedWordsEnabled')) return false
    const shieldingWords = GroupBannedWords.getTitleBannedWords(e.group_id)
    if (/查看/.test(getMessageText(e))) {
      await e.reply(`现有的头衔屏蔽词如下：${shieldingWords.join('\n')}`)
      return true
    }
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const message = getMessageText(e).replace(/#|(增加|减少)头衔屏蔽词/g, '').trim().split(',')
    const isAddition = /增加/.test(getMessageText(e))
    const existingWords = []
    const newWords = []

    for (const word of message) {
      const item = word.trim()
      if (!item) continue
      if (shieldingWords.includes(item)) {
        existingWords.push(item)
      } else {
        newWords.push(item)
      }
    }

    if (isAddition) {
      if (newWords.length > 0) {
        GroupBannedWords.addTitleBannedWords(e.group_id, [...new Set(newWords)])
        await e.reply(`成功添加：${[...new Set(newWords)].join(',')}`)
      }
      if (existingWords.length > 0) {
        await e.reply(`以下词已存在：${[...new Set(existingWords)].join(',')}`)
      }
    } else {
      if (existingWords.length > 0) {
        GroupBannedWords.deleteTitleBannedWords(e.group_id, [...new Set(existingWords)])
        await e.reply(`成功删除：${[...new Set(existingWords)].join(',')}`)
      }
      if (newWords.length > 0) {
        await e.reply(`以下词未在屏蔽词中：${[...new Set(newWords)].join(',')}`)
      }
    }
    return true
  }

  async prohibitedTitlePattern(e) {
    if (!isGroupAdminFeatureEnabled('bannedWordsEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const res = GroupBannedWords.setTitleFilterModeChange(e.group_id)
    await e.reply(`已修改匹配模式为${res ? '精确' : '模糊'}匹配`)
    return true
  }
}

export class GroupVoteCommands extends plugin {
  constructor() {
    super({
      name: '自动退群:群投票',
      dsc: '群员投票禁言/踢人',
      event: 'message.group',
      priority: 5000,
      rule: [
        { reg: '^#(发起)?投票(禁言|踢人)', fnc: 'initiate' },
        { reg: '^#(支持|反对)投票', fnc: 'follow' },
        { reg: '^#(启用|禁用)投票(禁言|踢人)$', fnc: 'switchVote' },
        { reg: /^#?投票设置(超时时间|最低票数|禁言时间)?(\d*)$/, fnc: 'settings' }
      ]
    })
    this.vote = {}
  }

  async switchVote(e) {
    if (!isGroupAdminFeatureEnabled('voteEnabled')) return false
    if (!await checkPermission(e, 'master')) return true
    const config = getGroupConfig()
    const enable = /启用/.test(getMessageText(e))
    const isBan = /禁言/.test(getMessageText(e))
    const name = isBan ? '禁言' : '踢人'
    const key = isBan ? 'voteBan' : 'voteKick'
    const open = config.groupAdmin[key]
    if (open && enable) {
      await e.reply(`投票${name}功能已处于启用状态`)
      return true
    }
    if (!open && !enable) {
      await e.reply(`投票${name}功能已处于禁用状态`)
      return true
    }
    config.groupAdmin[key] = enable
    Config.saveConfig(config)
    await e.reply(`已${enable ? '启用' : '禁用'}投票${name}功能`)
    return true
  }

  async settings(e) {
    if (!isGroupAdminFeatureEnabled('voteEnabled')) return false
    if (!await checkPermission(e, 'master')) return true
    const config = getGroupConfig()
    const regRet = /^#?投票设置(超时时间|最低票数|禁言时间)?(\d*)$/.exec(getMessageText(e))
    const text = regRet?.[1]
    const value = Number(regRet?.[2])
    if (!text || !value) {
      await e.reply('投票配置参数:\n\n#(启用|禁用)投票(禁言|踢人)\n\n(超时时间: 投票限时，单位:秒\n最低票数: 投票成功的最低票数\n禁言时间: 禁言的时长，单位:秒')
      return true
    }
    const key = text === '超时时间' ? 'outTime' : text === '最低票数' ? 'minNum' : 'banTime'
    if (config.groupAdmin[key] === value) {
      await e.reply(`当前${text}已经是${value}了`)
      return true
    }
    config.groupAdmin[key] = value
    Config.saveConfig(config)
    await e.reply(`已把${text}设置成${value}了`)
    return true
  }

  async initiate(e) {
    if (!isGroupAdminFeatureEnabled('voteEnabled')) return false
    if (!await checkPermission(e, 'all', 'admin')) return true
    const config = getGroupConfig()
    const isBan = /禁言/.test(getMessageText(e))
    const disabledMsg = isBan ? '该功能已被禁用，请发送 #启用投票禁言 来启用该功能。' : '该功能已被禁用，请发送 #启用投票踢人 来启用该功能。'
    if ((isBan && !config.groupAdmin.voteBan) || (!isBan && !config.groupAdmin.voteKick)) {
      await e.reply(disabledMsg, true)
      return true
    }
    let targetQQ = extractAtIds(e)[0] || getMessageText(e).match(/\d+/)?.[0] || ''
    targetQQ = normalizeId(targetQQ)
    const key = `${e.group_id}:${targetQQ}`
    if (Number(e.user_id) === Number(targetQQ)) {
      await e.reply('您不能对自己进行投票')
      return true
    }
    if (!targetQQ) {
      await e.reply('请艾特或输入被投票人的QQ')
      return true
    }
    if (this.vote[key]) {
      await e.reply('已有相同投票，请勿重复发起')
      return true
    }
    let info = null
    try {
      if (typeof getService(e).bot.sendApi === 'function') {
        info = await getService(e).bot.sendApi('get_group_member_info', {
          group_id: Number(e.group_id),
          user_id: Number(targetQQ),
          no_cache: false
        })
      }
    } catch {}
    const memberInfo = info?.data || info?.response
    const botRole = e.group?.is_owner ? 'owner' : e.group?.is_admin ? 'admin' : 'member'
    if (!memberInfo) {
      await e.reply('该群没有这个人')
      return true
    }
    if (memberInfo.role === 'owner') {
      await e.reply('权限不足，该命令对群主无效')
      return true
    }
    if (memberInfo.role === 'admin' && (!config.groupAdmin.voteAdmin || botRole !== 'owner')) {
      await e.reply('该命令对管理员无效或Bot权限不足，需要群主权限')
      return true
    }

    this.vote[key] = {
      supportCount: 1,
      opposeCount: 0,
      list: [e.user_id],
      type: isBan ? 'Ban' : 'Kick'
    }

    await e.reply([
      segment.at(targetQQ), `(${targetQQ})的${isBan ? '禁言' : '踢出'}投票已发起\n`,
      '发起人:', segment.at(e.user_id), `(${e.user_id})\n`,
      '请支持者发送：\n', `「#支持投票${targetQQ}」\n`,
      '不支持者请发送：\n', `「#反对投票${targetQQ}」\n`,
      `超时时间：${config.groupAdmin.outTime}秒\n`,
      isBan ? `禁言时间：${config.groupAdmin.banTime}秒\n` : '投票成功将会被移出群聊\n',
      `规则：支持票大于反对票且参与人高于${config.groupAdmin.minNum}人即可成功投票`,
      config.groupAdmin.veto ? '\n管理员拥有一票权' : ''
    ], true)

    setTimeout(async () => {
      if (!this.vote[key]) return
      const { supportCount, opposeCount } = this.vote[key]
      const success = supportCount > opposeCount && supportCount >= config.groupAdmin.minNum
      delete this.vote[key]
      if (success) {
        if (isBan) {
          await muteGroupMember(e, e.group_id, targetQQ, config.groupAdmin.banTime)
        } else {
          await kickGroupMember(e, e.group_id, targetQQ, false)
        }
      }
      await e.reply(`投票结束，投票结果：\n支持票数：${supportCount}\n反对票数：${opposeCount}\n${success ? `支持票数大于反对票\n投票成功。${isBan ? '禁言' : '踢出'}目标` : `反对票数大于支持票数或支持票数小于${config.groupAdmin.minNum}，投票失败。`}`, true)
    }, config.groupAdmin.outTime * 1000)

    if (config.groupAdmin.outTime > 60) {
      setTimeout(async () => {
        const vote = this.vote[key]
        if (!vote) return
        await e.reply([
          segment.at(targetQQ), `(${targetQQ})的${isBan ? '禁言' : '踢出'}投票仅剩一分钟结束\n`,
          '当前票数：\n', `支持票数：${vote.supportCount}\n反对票数：${vote.opposeCount}\n`,
          '请支持者发送：\n', `「#支持投票${targetQQ}」\n`,
          '不支持者请发送：\n', `「#反对投票${targetQQ}」\n`,
          `发起人：${e.user_id}`
        ])
      }, (config.groupAdmin.outTime - 60) * 1000)
    }
    return true
  }

  async follow(e) {
    if (!isGroupAdminFeatureEnabled('voteEnabled')) return false
    if (!await checkPermission(e, 'all', 'admin')) return true
    const config = getGroupConfig()
    const support = /支持/.test(getMessageText(e))
    let targetQQ = extractAtIds(e)[0] || getMessageText(e).match(/\d+/)?.[0] || ''
    targetQQ = normalizeId(targetQQ)
    const key = `${e.group_id}:${targetQQ}`
    if (!targetQQ) {
      await e.reply('请艾特或输入需要进行跟票的被禁言人QQ')
      return true
    }
    if (Number(e.user_id) === Number(targetQQ)) {
      await e.reply('您不能对自己进行投票')
      return true
    }
    if (!this.vote[key]) {
      await e.reply('未找到对应投票')
      return true
    }
    const { list, type } = this.vote[key]
    if (config.groupAdmin.veto && (e.member?.is_admin || e.member?.is_owner)) {
      await e.reply(support ? '投票结束，管理员介入，执行操作。' : '投票取消，管理员介入。', true)
      if (support) {
        if (type === 'Ban') {
          await muteGroupMember(e, e.group_id, targetQQ, config.groupAdmin.banTime)
        } else {
          await kickGroupMember(e, e.group_id, targetQQ, false)
        }
      }
      delete this.vote[key]
      return true
    }
    if (list.includes(e.user_id)) {
      await e.reply('你已参与过投票，请勿重复参与')
      return true
    }
    if (support) {
      this.vote[key].supportCount++
    } else {
      this.vote[key].opposeCount++
    }
    this.vote[key].list.push(e.user_id)
    await e.reply(`投票成功，当前票数\n支持：${this.vote[key].supportCount} 反对：${this.vote[key].opposeCount}`, true)
    return true
  }
}

export class GroupVerifyCommands extends plugin {
  constructor() {
    super({
      name: '自动退群:入群验证命令',
      dsc: '入群验证和人工放行',
      event: 'message.group',
      priority: 5,
      rule: [
        { reg: '^#重新验证(\\d+)?$', fnc: 'reverify' },
        { reg: '^#重新验证从未发言的人$', fnc: 'reverifyNeverSpeak' },
        { reg: '^#绕过验证(\\d+)?$', fnc: 'pass' },
        { reg: '^#(开启|关闭)验证$', fnc: 'switchVerify' },
        { reg: '^#切换验证模式$', fnc: 'switchMode' },
        { reg: '^#设置验证超时时间(\\d+)(s|秒)?$', fnc: 'setOvertime' }
      ]
    })
  }

  async reverify(e) {
    if (!isGroupAdminFeatureEnabled('verifyEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const config = getGroupConfig()
    if (!(config.groupAdmin?.groupVerify?.openGroup || []).includes(Number(e.group_id))) {
      await e.reply('当前群未开启验证', true)
      return true
    }
    let qq = extractAtIds(e)[0]
    if (!qq) {
      qq = getMessageText(e).replace(/#|重新验证/g, '').trim()
    }
    qq = Number(qq) || String(qq)
    if (qq === (e.bot ?? Bot).uin) {
      return true
    }
    try {
      await reverifyUser(e, qq)
      await e.reply('已重新发起验证')
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async reverifyNeverSpeak(e) {
    if (!isGroupAdminFeatureEnabled('verifyEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    try {
      const list = await getService(e).getNeverSpeak(e.group_id)
      let successCount = 0
      for (const item of list) {
        await startVerifyForUser(e, item.user_id, e.group_id)
        successCount++
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      await e.reply(`已重新发起 ${successCount} 位成员的验证`)
    } catch (err) {
      await e.reply(err.message || String(err))
    }
    return true
  }

  async pass(e) {
    if (!isGroupAdminFeatureEnabled('verifyEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const config = getGroupConfig()
    if (!(config.groupAdmin?.groupVerify?.openGroup || []).includes(Number(e.group_id))) {
      await e.reply('当前群未开启验证', true)
      return true
    }
    let qq = extractAtIds(e)[0]
    if (!qq) {
      qq = getMessageText(e).replace(/#|绕过验证/g, '').trim()
    }
    qq = Number(qq) || String(qq)
    if (!/^\d{5,}$/.test(String(qq))) {
      await e.reply('请输入正确的QQ号')
      return true
    }
    if (!hasVerifySession(e.group_id, qq)) {
      await e.reply('目标群成员当前无需验证')
      return true
    }
    const msg = await passVerify(e.group_id, qq)
    await e.reply(msg)
    return true
  }

  async switchVerify(e) {
    if (!isGroupAdminFeatureEnabled('verifyEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const config = getGroupConfig()
    const enable = /开启/.test(getMessageText(e))
    const list = config.groupAdmin.groupVerify.openGroup || []
    const exists = list.includes(Number(e.group_id))
    if (exists && enable) {
      await e.reply('本群验证已处于开启状态')
      return true
    }
    if (!exists && !enable) {
      await e.reply('本群暂未开启验证')
      return true
    }
    config.groupAdmin.groupVerify.openGroup = enable
      ? [...new Set([...list, Number(e.group_id)])]
      : list.filter(item => Number(item) !== Number(e.group_id))
    Config.saveConfig(config)
    await e.reply(`已${enable ? '开启' : '关闭'}本群验证`)
    return true
  }

  async switchMode(e) {
    if (!isGroupAdminFeatureEnabled('verifyEnabled')) return false
    if (!await checkPermission(e, 'master')) return true
    const config = getGroupConfig()
    const value = config.groupAdmin.groupVerify.mode === '模糊' ? '精确' : '模糊'
    config.groupAdmin.groupVerify.mode = value
    Config.saveConfig(config)
    await e.reply(`已切换验证模式为${value}验证`)
    return true
  }

  async setOvertime(e) {
    if (!isGroupAdminFeatureEnabled('verifyEnabled')) return false
    if (!await checkPermission(e, 'master')) return true
    const config = getGroupConfig()
    const overtime = Number(getMessageText(e).match(/\d+/)?.[0] || 300)
    config.groupAdmin.groupVerify.time = overtime
    Config.saveConfig(config)
    await e.reply(`已将验证超时时间设置为${overtime}秒`)
    if (overtime < 60) {
      await e.reply('建议至少一分钟(60秒)')
    }
    return true
  }
}

export class GroupAnnounceCommands extends plugin {
  constructor() {
    super({
      name: '自动退群:群公告',
      dsc: 'NapCat 群公告管理',
      event: 'message.group',
      priority: 500,
      rule: [
        { reg: '^#发群?公告', fnc: 'addAnnounce' },
        { reg: '^#删群?公告(\\d+)$', fnc: 'deleteAnnounce' },
        { reg: '^#查群?公告$', fnc: 'getAnnounce' }
      ]
    })
  }

  async addAnnounce(e) {
    if (!isGroupAdminFeatureEnabled('announceEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const msg = getMessageText(e).replace(/#发群?公告/g, '').trim()
    if (!msg) {
      await e.reply('公告不能为空')
      return true
    }
    const ok = await sendGroupNotice(e, e.group_id, msg, e.img?.[0] || '')
    await e.reply(ok ? '公告已发送' : '发送失败')
    return true
  }

  async getAnnounce(e) {
    if (!isGroupAdminFeatureEnabled('announceEnabled')) return false
    const list = await getGroupNoticeList(e, e.group_id)
    if (!Array.isArray(list) || list.length === 0) {
      await e.reply('当前群暂无公告')
      return true
    }
    const msg = list.map((item, index) => [
      `序号：${index + 1}\n`,
      `标题：${item.title || item.text || '无标题'}\n`,
      `内容：${item.text || item.message?.text || item.content || '无内容'}\n`,
      `公告ID：${item.notice_id || item.id || '未知'}`
    ])
    await withForwardReply(e, msg, '群公告列表')
    return true
  }

  async deleteAnnounce(e) {
    if (!isGroupAdminFeatureEnabled('announceEnabled')) return false
    if (!await checkPermission(e, 'admin', 'admin')) return true
    const index = Number(getMessageText(e).replace(/#删群?公告/g, '').trim())
    if (!index) {
      await e.reply('序号不可为空')
      return true
    }
    const list = await getGroupNoticeList(e, e.group_id)
    const target = list[index - 1]
    if (!target) {
      await e.reply('未找到对应公告')
      return true
    }
    const ok = await deleteGroupNotice(e, e.group_id, target.notice_id || target.id)
    await e.reply(ok ? `已删除「${target.title || target.text || target.notice_id || target.id}」` : '删除失败')
    return true
  }
}
