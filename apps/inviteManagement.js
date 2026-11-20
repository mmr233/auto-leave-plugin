import plugin from '../../../lib/plugins/plugin.js'
import {
  InviteManagementService,
  REVIEW_MODE,
  REVIEW_MODE_LABEL,
  PRECHECK_MODE_LABEL,
  PRECHECK_FAILURE_ACTION_LABEL,
  getInviteTargetId,
  isInviteForCurrentBot
} from '../model/inviteManagement.js'
import { decideStayReview } from '../model/stayReview.js'
import { getCommandText, prepareCommandRules } from '../utils/command.js'

function getText(e) {
  return getCommandText(e)
}

function getReplyMsgId(e) {
  const reply = Array.isArray(e.message)
    ? e.message.find(item => item?.type === 'reply')
    : null

  return reply?.id || reply?.data?.id || e.source?.message_id || e.source?.id || e.reply_id ||
    String(e.raw_message || '').match(/\[CQ:reply,id=([^,\]]+)/i)?.[1] || ''
}

function getEnabledInviteService(e) {
  const service = new InviteManagementService(e)
  return service.config.enabled ? service : null
}

export class BotInviteRequestHandler extends plugin {
  constructor() {
    super({
      name: '自动退群:群邀请审核',
      dsc: '机器人被邀请进群时通知管理群并等待确认',
      event: 'request.group.invite',
      priority: 1000
    })
  }

  async accept(e = this.e) {
    const service = new InviteManagementService(e)

    if (!service.config.enabled) {
      return false
    }

    const groupId = String(e.group_id || '')
    if (!groupId || !e.flag) {
      logger.warn('[自动退群] 收到群邀请事件，但缺少群号或 flag')
      return false
    }

    const inviteTargetId = getInviteTargetId(e)
    if (!isInviteForCurrentBot(e) || (!inviteTargetId && service.isBotAlreadyInGroup(groupId))) {
      logger.info(
        `[自动退群] 忽略群内成员邀请：群 ${groupId}，邀请人 ${e.user_id || '未知'}，被邀请人 ${inviteTargetId || '未知'}`
      )
      return false
    }

    if (service.isBlackGroup(groupId)) {
      try {
        const groupInfo = await service.getGroupInfo(groupId, e)
        const request = {
          userId: String(e.user_id || ''),
          groupId,
          groupName: groupInfo.groupName
        }
        await service.approveCurrentEvent(e, false, service.formatInviteMessage('blackGroupRejectReason', request))
        const msg = service.formatInviteMessage('blackGroupRejected', request)
        await service.notifyInviter(request, msg)
        await service.notifyUsers(msg, [String(e.user_id || '')])
      } catch (err) {
        logger.error(`[自动退群] 拒绝黑名单群邀请失败: ${err.message}`)
      }
      return true
    }

    if (service.isWhiteGroup(groupId)) {
      try {
        await service.approveCurrentEvent(e, true)
        const groupInfo = await service.getGroupInfo(groupId, e)
        const request = {
          userId: String(e.user_id || ''),
          groupId,
          groupName: groupInfo.groupName
        }
        const msg = service.formatInviteMessage('autoApproved', request)
        await service.notifyInviter(request, msg)
        await service.notifyUsers(msg, [String(e.user_id || '')])
      } catch (err) {
        logger.error(`[自动退群] 同意白名单群邀请失败: ${err.message}`)
      }
      return true
    }

    // 黑名单与白名单优先于普通邀请处理；已批准群仅用于放行本次邀请。
    if (service.isApprovedGroup(groupId)) {
      try {
        const [groupInfo, userInfo] = await Promise.all([
          service.getGroupInfo(groupId, e),
          service.getUserInfo(e.user_id)
        ])
        const request = service.createRequestInfo(e, groupInfo, userInfo)
        await service.approveCurrentEvent(e, true)
        const msg = service.formatInviteMessage('forceApproved', request)
        await service.notifyInviter(request, msg)
        await service.notifyUsers(msg, [String(e.user_id || '')])
      } catch (err) {
        logger.error(`[自动退群] 放行已批准群邀请失败: ${err.message}`)
      }
      return true
    }

    const cooldown = service.getStayCooldown(groupId)
    if (cooldown) {
      try {
        await service.approveCurrentEvent(e, false, '该群处于留群审核退群冷却期')
        await service.notifyInviter({ userId: String(e.user_id || '') }, `群 ${groupId} 仍处于退群冷却期，请稍后重新邀请`)
      } catch (err) {
        logger.error(`[自动退群] 拒绝冷却期群邀请失败: ${err.message}`)
      }
      return true
    }

    const mode = service.config.reviewMode
    if (mode === REVIEW_MODE.DISABLED) {
      const request = {
        userId: String(e.user_id || ''),
        groupId,
        groupName: '未知群名'
      }
      const msg = service.formatInviteMessage('reviewDisabled', request)
      await service.notifyInviter(request, msg)
      await service.notifyUsers(msg, [String(e.user_id || '')])
      return true
    }

    if (mode === REVIEW_MODE.AUTO_REJECT) {
      try {
        const groupInfo = await service.getGroupInfo(groupId, e)
        const request = {
          userId: String(e.user_id || ''),
          groupId,
          groupName: groupInfo.groupName
        }
        await service.approveCurrentEvent(e, false, service.formatInviteMessage('autoRejectReason', request))
        const msg = service.formatInviteMessage('autoRejected', request)
        await service.notifyInviter(request, msg)
        await service.notifyUsers(msg, [String(e.user_id || '')])
      } catch (err) {
        logger.error(`[自动退群] 自动拒绝群邀请失败: ${err.message}`)
      }
      return true
    }

    if (mode === REVIEW_MODE.POST_JOIN) {
      const join = service.savePendingJoin(groupId, e.user_id)
      if (!join) {
        logger.error(`[自动退群] 无法保存群 ${groupId} 的入群审核状态，未同意邀请`)
        return true
      }
      try {
        await service.approveCurrentEvent(e, true)
        await service.notifyInviter({ userId: String(e.user_id || '') }, `已同意加入群 ${groupId}，入群后等待留群审核`)
      } catch (err) {
        new InviteManagementService(e).removePendingJoin(join)
        logger.error(`[自动退群] 同意入群后审核邀请失败: ${err.message}`)
      }
      return true
    }

    const [groupInfo, userInfo] = await Promise.all([
      service.getGroupInfo(groupId, e),
      service.getUserInfo(e.user_id)
    ])
    const baseRequest = service.createRequestInfo(e, groupInfo, userInfo)
    const precheck = service.evaluatePrecheck(groupInfo)

    if (precheck.status === 'warning') {
      baseRequest.precheckStatus = 'warning'
      baseRequest.precheckReason = precheck.reason
      logger.info(`[自动退群] 群 ${groupId} 人数预检查仅提示：${precheck.reason || '检查通过'}`)
    }

    if (!precheck.passed) {
      const precheckAction = service.config.precheckFailureAction
      const request = {
        ...baseRequest,
        memberCount: precheck.memberCount,
        precheckStatus: 'failed',
        precheckReason: precheck.reason,
        precheckAction,
        status: 'precheck_failed'
      }

      if (precheckAction === 'reject') {
        try {
          await service.approveCurrentEvent(e, false, precheck.reason)
          const inviterMessage = service.buildInviteeMessage(request, 'inviteRejected')
          await service.notifyInviter(request, inviterMessage)
          await service.notifyUsers(service.buildPrecheckMessage(request), [request.userId])
          if (service.config.notifyMasterOnPrecheckReject) {
            await service.notifyMaster(service.buildPrecheckMessage(request))
          }
        } catch (err) {
          logger.error(`[自动退群] 拒绝预检查失败的群邀请失败: ${err.message}`)
        }
        return true
      }

      if (precheckAction === 'manual') {
        const savedRequest = await service.sendReviewNotifications(request)
        const hasMasterTarget = savedRequest.masterNotified

        if (savedRequest.manageGroupIds.length === 0 && savedRequest.notifiedUserIds.length === 0 && !hasMasterTarget) {
          await service.notifyInviter(request, service.formatInviteMessage('noNotifyTarget', request))
          logger.warn('[自动退群] 预检查未通过，但未配置可用的审核通知目标')
          return true
        }

        service.addPendingRequest(savedRequest)
        await service.notifyInviter(request, service.buildInviteeMessage(request, 'inviteSubmitted'))
        return true
      }
    }

    if (mode === REVIEW_MODE.AUTO_APPROVE) {
      try {
        await service.approveCurrentEvent(e, true)
        const msg = service.formatInviteMessage('autoApproved', baseRequest)
        await service.notifyInviter(baseRequest, msg)
        await service.notifyUsers(msg, [String(e.user_id || '')])
      } catch (err) {
        logger.error(`[自动退群] 自动同意群邀请失败: ${err.message}`)
      }
      return true
    }

    const request = baseRequest
    const savedRequest = await service.sendReviewNotifications(request)

    if (savedRequest.manageGroupIds.length === 0 && savedRequest.notifiedUserIds.length === 0) {
      await service.notifyInviter(request, service.formatInviteMessage('noNotifyTarget', request))
      logger.warn('[自动退群] 未配置可用的群邀请审核通知目标')
      return true
    }

    service.addPendingRequest(savedRequest)
    await service.notifyInviter(request, service.buildInviteeMessage(request, 'inviteSubmitted'))

    return true
  }
}

export class BotInviteConfirmHandler extends plugin {
  constructor() {
    super({
      name: '自动退群:群邀请确认',
      dsc: '确认或拒绝机器人群邀请',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: '^[tT](强制确认|强制同意|确认|同意|拒绝)加群(\\s+\\S+)?$',
          fnc: 'handleConfirm'
        }
      ]
    })
    prepareCommandRules(this)
  }

  async handleConfirm(e = this.e) {
    const service = getEnabledInviteService(e)
    if (!service) {
      return false
    }

    const match = getText(e).match(/^[tT](强制确认|强制同意|确认|同意|拒绝)加群(?:\s+(\S+))?$/)
    if (!match) {
      await e.reply('无法识别审核命令，请重新发送')
      return true
    }
    const force = match[1] === '强制确认' || match[1] === '强制同意'
    const approve = ['强制确认', '强制同意', '确认', '同意'].includes(match[1])

    if (force && !e.isMaster) {
      await e.reply('只有主人才能强制同意群邀请')
      return true
    }

    const replyMsgId = getReplyMsgId(e)
    const commandTarget = match[2] || ''
    let requestId = commandTarget && !/^\d+$/.test(commandTarget) ? commandTarget : ''
    let groupId = /^\d+$/.test(commandTarget) ? commandTarget : ''
    let pendingMatches = []
    let stayMatches = []

    if (commandTarget) {
      pendingMatches = service.findPendingRequests({ groupId, requestId })
      stayMatches = service.findStayReviews({ groupId, requestId })
    } else if (replyMsgId) {
      pendingMatches = service.findPendingRequests({ msgId: replyMsgId })
      stayMatches = service.findStayReviews({ msgId: replyMsgId })
      if (!pendingMatches.length && !stayMatches.length) {
        const quoteText = await service.getMessageText(replyMsgId)
        groupId = quoteText.match(/群号[:：]\s*(\d+)/)?.[1] || ''
        requestId = quoteText.match(/请求ID[:：]\s*([a-z0-9-]+)/i)?.[1] || ''
        if (requestId) {
          pendingMatches = service.findPendingRequests({ requestId })
          stayMatches = service.findStayReviews({ requestId })
        }
      }
    }
    const matches = [...pendingMatches, ...stayMatches]
    const pendingRequest = matches.length === 1 ? matches[0] : null

    if (!pendingRequest) {
      if (groupId && matches.length > 1) {
        await e.reply('同一群存在多个待处理审核，请引用对应通知或使用请求ID处理')
        return true
      }

      if (force && groupId && commandTarget) {
        if (!service.markApprovedGroup(groupId) || !service.clearStayCooldown(groupId)) {
          await e.reply('保存强制放行或清除冷却失败，请检查配置文件')
          return true
        }
        await e.reply(`已登记群 ${groupId} 的强制放行；下次收到该群邀请时将自动同意，并跳过本次人数退群检查`)
        logger.info(`[自动退群] 主人已登记群 ${groupId} 的强制放行`)
        return true
      }

      await e.reply(service.formatInviteMessage('pendingNotFound'))
      return true
    }

    if (!await service.canHandleRequest(e, pendingRequest)) {
      await e.reply(service.formatInviteMessage('permissionDenied', pendingRequest))
      return true
    }

    try {
      if (pendingRequest.expiresAt) {
        const decision = await decideStayReview(pendingRequest, approve, service.bot)
        await e.reply(decision.message)
        if (decision.ok) await service.notifyUsers(decision.message, [String(e.user_id || '')])
        return true
      }
      if (force) service.clearStayCooldown(pendingRequest.groupId)
      const reason = approve ? '' : service.formatInviteMessage('manualRejectReason', pendingRequest)
      await service.approvePendingRequest(pendingRequest, approve, reason)
      service.removePendingRequest(pendingRequest.requestId)
    } catch (err) {
      logger.error(`[自动退群] 处理群邀请请求失败: ${err.message}`)
      await e.reply(service.formatInviteMessage('processFailed', pendingRequest, {
        error: err.message
      }))
      return true
    }

    const resultMsg = force
      ? service.buildInviteeMessage(pendingRequest, 'forceApproved')
      : service.buildResultMessage(pendingRequest, approve)
    await e.reply(resultMsg)
    await service.notifyUsers(resultMsg, [String(e.user_id || '')])
    await service.notifyInviter(
      pendingRequest,
      service.buildInviteeMessage(pendingRequest, approve ? 'inviteApproved' : 'inviteRejected')
    )

    return true
  }
}

export class BotInviteManageCommands extends plugin {
  constructor() {
    super({
      name: '自动退群:群邀请管理命令',
      dsc: '管理机器人群邀请审核',
      event: 'message',
      priority: 599,
      rule: [
        {
          reg: '^[tT]群邀请审核(自动同意|关闭|人工审核|自动拒绝|入群后审核)$',
          fnc: 'setReviewMode'
        },
        {
          reg: '^[tT](添加|删除)邀请(黑|白)名单群\\s*(\\d+)$',
          fnc: 'manageInviteList'
        },
        {
          reg: '^[tT]查看邀请(黑|白)名单群$',
          fnc: 'viewInviteList'
        },
        {
          reg: '^[tT](添加|删除)邀请通知群\\s*(\\d+)?$',
          fnc: 'manageNotifyGroup'
        },
        {
          reg: '^[tT]查看邀请通知群$',
          fnc: 'viewNotifyGroups'
        },
        {
          reg: '^[tT]查看群邀请审核$',
          fnc: 'viewInviteConfig'
        }
      ]
    })
    prepareCommandRules(this)
  }

  async setReviewMode(e = this.e) {
    const service = getEnabledInviteService(e)
    if (!service) {
      return false
    }

    if (!e.isMaster) {
      await e.reply('只有主人才能修改群邀请审核模式')
      return true
    }

    const text = getText(e)
    const modeText = text.replace(/^[tT]群邀请审核/, '')
    const modeMap = {
      自动同意: REVIEW_MODE.AUTO_APPROVE,
      关闭: REVIEW_MODE.DISABLED,
      人工审核: REVIEW_MODE.MANUAL,
      自动拒绝: REVIEW_MODE.AUTO_REJECT,
      入群后审核: REVIEW_MODE.POST_JOIN
    }
    const mode = modeMap[modeText]
    service.setReviewMode(mode)
    await e.reply(`群邀请审核模式已设为${REVIEW_MODE_LABEL[mode]}`)
    return true
  }

  async manageInviteList(e = this.e) {
    const service = getEnabledInviteService(e)
    if (!service) {
      return false
    }

    if (!e.isMaster) {
      await e.reply('只有主人才能管理邀请黑白名单')
      return true
    }

    const match = getText(e).match(/^[tT](添加|删除)邀请(黑|白)名单群\s*(\d+)$/)
    if (!match) {
      return false
    }

    const [, actionText, type, groupId] = match
    const key = type === '黑' ? 'blackGroups' : 'whiteGroups'
    const action = actionText === '添加' ? 'add' : 'del'
    const result = service.updateGroupList(key, groupId, action)
    await e.reply(result.message)
    return true
  }

  async viewInviteList(e = this.e) {
    const service = getEnabledInviteService(e)
    if (!service) {
      return false
    }

    if (!e.isMaster) {
      await e.reply('只有主人才能查看邀请黑白名单')
      return true
    }

    const type = getText(e).includes('黑') ? '黑' : '白'
    const list = type === '黑' ? service.config.blackGroups : service.config.whiteGroups

    await e.reply(list.length
      ? `邀请${type}名单群：\n${list.join('\n')}`
      : `邀请${type}名单群为空`
    )
    return true
  }

  async manageNotifyGroup(e = this.e) {
    const service = getEnabledInviteService(e)
    if (!service) {
      return false
    }

    if (!e.isMaster) {
      await e.reply('只有主人才能管理邀请通知群')
      return true
    }

    const match = getText(e).match(/^[tT](添加|删除)邀请通知群\s*(\d+)?$/)
    if (!match) return false
    const groupId = match?.[2] || e.group_id
    if (!groupId) {
      await e.reply('请指定群号或在群内使用')
      return true
    }

    const result = service.updateGroupList('notifyGroups', groupId, match?.[1] === '添加' ? 'add' : 'del')
    await e.reply(result.message)
    return true
  }

  async viewNotifyGroups(e = this.e) {
    const service = getEnabledInviteService(e)
    if (!service) {
      return false
    }

    if (!e.isMaster) {
      await e.reply('只有主人才能查看邀请通知群')
      return true
    }

    await e.reply(service.config.notifyGroups.length
      ? `邀请通知群：\n${service.config.notifyGroups.join('\n')}`
      : '邀请通知群为空'
    )
    return true
  }

  async viewInviteConfig(e = this.e) {
    const service = getEnabledInviteService(e)
    if (!service) {
      return false
    }

    if (!e.isMaster) {
      await e.reply('只有主人才能查看群邀请审核配置')
      return true
    }

    const approvedGroups = service.getApprovedGroupIds()
    const lines = [
      '群邀请审核配置',
      `状态：${service.config.enabled ? '已启用' : '已关闭'}`,
      `模式：${REVIEW_MODE_LABEL[service.config.reviewMode]}`,
      `通知群：${service.config.notifyGroups.length ? service.config.notifyGroups.join('、') : '未配置'}`,
      `通知用户：${service.config.notifyUsers.length ? service.config.notifyUsers.map(item => item.userId).join('、') : '未配置'}`,
      `待处理：${service.cleanExpiredPendingRequests().length} 条`,
      `有效期：${service.config.requestExpireMinutes} 分钟`,
      `到期通知邀请者：${service.config.notifyInviterOnExpiry ? '开启' : '关闭'}`,
      `留群审核：${service.getStayReviews().length} 条（${service.config.stayReviewMinutes} 分钟）`,
      `审核退群冷却：${service.config.stayReviewCooldownMinutes} 分钟`,
      `人数预检查：${service.config.precheckMemberCount ? '开启' : '关闭'}`,
      `预检查计入受邀机器人：${service.config.excludeBotFromPrecheck ? '否' : '是'}`,
      `预检查模式：${PRECHECK_MODE_LABEL[service.config.precheckMode] || service.config.precheckMode}`,
      `预检查失败：${PRECHECK_FAILURE_ACTION_LABEL[service.config.precheckFailureAction] || service.config.precheckFailureAction}`,
      `已批准群：${approvedGroups.length ? approvedGroups.join('、') : '无'}`
    ]
    await e.reply(lines.join('\n'))
    return true
  }
}
