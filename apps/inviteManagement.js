import plugin from '../../../lib/plugins/plugin.js'
import {
  InviteManagementService,
  REVIEW_MODE,
  REVIEW_MODE_LABEL
} from '../model/inviteManagement.js'

function getText(e) {
  return String(e.raw_message || e.msg || '').trim()
}

function getReplyMsgId(e) {
  const reply = Array.isArray(e.message)
    ? e.message.find(item => item?.type === 'reply')
    : null

  return reply?.id || reply?.data?.id || e.source?.message_id || e.source?.id || e.reply_id || ''
}

function getCommandGroupId(text) {
  return text.replace(/^#(确认|同意|拒绝)加群/, '').trim()
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

    if (service.isBlackGroup(groupId)) {
      try {
        const groupInfo = await service.getGroupInfo(groupId)
        await service.approveCurrentEvent(e, false, '群聊在黑名单中')
        const msg = `加群邀请已拒绝\n群号：${groupId}\n群名：${groupInfo.groupName}\n原因：该群在黑名单中`
        await service.notifyInviter({
          userId: String(e.user_id || ''),
          groupId,
          groupName: groupInfo.groupName
        }, msg)
        await service.notifyUsers(msg, [String(e.user_id || '')])
      } catch (err) {
        logger.error(`[自动退群] 拒绝黑名单群邀请失败: ${err.message}`)
      }
      return true
    }

    if (service.isWhiteGroup(groupId)) {
      try {
        await service.approveCurrentEvent(e, true)
        const groupInfo = await service.getGroupInfo(groupId)
        const msg = `加群邀请已自动同意\n群号：${groupId}\n群名：${groupInfo.groupName}`
        await service.notifyInviter({
          userId: String(e.user_id || ''),
          groupId,
          groupName: groupInfo.groupName
        }, msg)
        await service.notifyUsers(msg, [String(e.user_id || '')])
      } catch (err) {
        logger.error(`[自动退群] 同意白名单群邀请失败: ${err.message}`)
      }
      return true
    }

    const mode = service.config.reviewMode
    if (mode === REVIEW_MODE.AUTO_APPROVE) {
      try {
        await service.approveCurrentEvent(e, true)
        const groupInfo = await service.getGroupInfo(groupId)
        const msg = `加群邀请已自动同意\n群号：${groupId}\n群名：${groupInfo.groupName}`
        await service.notifyInviter({
          userId: String(e.user_id || ''),
          groupId,
          groupName: groupInfo.groupName
        }, msg)
        await service.notifyUsers(msg, [String(e.user_id || '')])
      } catch (err) {
        logger.error(`[自动退群] 自动同意群邀请失败: ${err.message}`)
      }
      return true
    }

    if (mode === REVIEW_MODE.DISABLED) {
      const msg = `加群审核已关闭\n群号：${groupId}\n机器人不会处理本次邀请`
      await service.notifyInviter({
        userId: String(e.user_id || ''),
        groupId,
        groupName: '未知群名'
      }, msg)
      await service.notifyUsers(msg, [String(e.user_id || '')])
      return true
    }

    if (mode === REVIEW_MODE.AUTO_REJECT) {
      try {
        await service.approveCurrentEvent(e, false, '已开启自动拒绝')
        const groupInfo = await service.getGroupInfo(groupId)
        const msg = `加群邀请已自动拒绝\n群号：${groupId}\n群名：${groupInfo.groupName}`
        await service.notifyInviter({
          userId: String(e.user_id || ''),
          groupId,
          groupName: groupInfo.groupName
        }, msg)
        await service.notifyUsers(msg, [String(e.user_id || '')])
      } catch (err) {
        logger.error(`[自动退群] 自动拒绝群邀请失败: ${err.message}`)
      }
      return true
    }

    const [groupInfo, userInfo] = await Promise.all([
      service.getGroupInfo(groupId),
      service.getUserInfo(e.user_id)
    ])
    const request = service.createRequestInfo(e, groupInfo, userInfo)
    const savedRequest = await service.sendReviewNotifications(request)

    if (savedRequest.manageGroupIds.length === 0 && service.config.notifyUsers.length === 0) {
      await service.notifyInviter(request, '加群邀请已收到，但没有配置可用的审核通知群或通知用户')
      logger.warn('[自动退群] 未配置可用的群邀请审核通知目标')
      return true
    }

    service.addPendingRequest(savedRequest)
    await service.notifyInviter(request, [
      '加群邀请已提交审核',
      `群号：${request.groupId}`,
      `群名：${request.groupName}`,
      `有效期：${service.config.requestExpireMinutes} 分钟`
    ].join('\n'))

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
          reg: '^#(确认|同意|拒绝)加群(\\s+\\S+)?$',
          fnc: 'handleConfirm'
        }
      ]
    })
  }

  async handleConfirm(e = this.e) {
    const text = getText(e)
    const approve = /^(#确认加群|#同意加群)/.test(text)
    const service = new InviteManagementService(e)
    const replyMsgId = getReplyMsgId(e)
    const commandTarget = getCommandGroupId(text)
    let requestId = ''
    let groupId = /^\d+$/.test(commandTarget) ? commandTarget : ''

    if (commandTarget && !groupId) {
      requestId = commandTarget
    }

    if (!groupId && replyMsgId) {
      const quoteText = await service.getMessageText(replyMsgId)
      groupId = quoteText.match(/群号[:：]\s*(\d+)/)?.[1] || ''
      requestId = quoteText.match(/请求ID[:：]\s*([a-z0-9-]+)/i)?.[1] || requestId
    }

    const pendingRequest = service.findPendingRequest({
      msgId: replyMsgId,
      groupId,
      requestId
    })

    if (!pendingRequest) {
      await e.reply('未找到对应的加群请求，可能已过期或已处理')
      return true
    }

    if (!await service.canHandleRequest(e, pendingRequest)) {
      await e.reply('权限不足，只有主人、通知用户、审核群管理员或邀请者可处理')
      return true
    }

    try {
      await service.approvePendingRequest(pendingRequest, approve, approve ? '' : '审核拒绝')
      service.removePendingRequest(pendingRequest.requestId)
    } catch (err) {
      service.removePendingRequest(pendingRequest.requestId)
      logger.error(`[自动退群] 处理群邀请请求失败: ${err.message}`)
      await e.reply(`处理失败：${err.message}`)
      return true
    }

    const resultMsg = service.buildResultMessage(pendingRequest, approve)
    await e.reply(resultMsg)
    await service.notifyUsers(resultMsg, [String(e.user_id || '')])
    await service.notifyInviter(
      pendingRequest,
      service.buildInviteeMessage(pendingRequest, approve ? '加群邀请已通过' : '加群邀请已拒绝')
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
          reg: '^#群邀请审核(自动同意|关闭|人工审核|自动拒绝)$',
          fnc: 'setReviewMode'
        },
        {
          reg: '^#(添加|删除)邀请(黑|白)名单群\\s*(\\d+)$',
          fnc: 'manageInviteList'
        },
        {
          reg: '^#查看邀请(黑|白)名单群$',
          fnc: 'viewInviteList'
        },
        {
          reg: '^#(添加|删除)邀请通知群\\s*(\\d+)?$',
          fnc: 'manageNotifyGroup'
        },
        {
          reg: '^#查看邀请通知群$',
          fnc: 'viewNotifyGroups'
        },
        {
          reg: '^#查看群邀请审核$',
          fnc: 'viewInviteConfig'
        }
      ]
    })
  }

  async setReviewMode(e = this.e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能修改群邀请审核模式')
      return true
    }

    const text = getText(e)
    const modeText = text.replace('#群邀请审核', '')
    const modeMap = {
      自动同意: REVIEW_MODE.AUTO_APPROVE,
      关闭: REVIEW_MODE.DISABLED,
      人工审核: REVIEW_MODE.MANUAL,
      自动拒绝: REVIEW_MODE.AUTO_REJECT
    }
    const mode = modeMap[modeText]
    const service = new InviteManagementService(e)
    service.setReviewMode(mode)
    await e.reply(`群邀请审核模式已设为${REVIEW_MODE_LABEL[mode]}`)
    return true
  }

  async manageInviteList(e = this.e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能管理邀请黑白名单')
      return true
    }

    const match = getText(e).match(/^#(添加|删除)邀请(黑|白)名单群\s*(\d+)$/)
    if (!match) {
      return false
    }

    const [, actionText, type, groupId] = match
    const key = type === '黑' ? 'blackGroups' : 'whiteGroups'
    const action = actionText === '添加' ? 'add' : 'del'
    const service = new InviteManagementService(e)
    const result = service.updateGroupList(key, groupId, action)
    await e.reply(result.message)
    return true
  }

  async viewInviteList(e = this.e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能查看邀请黑白名单')
      return true
    }

    const type = getText(e).includes('黑') ? '黑' : '白'
    const service = new InviteManagementService(e)
    const list = type === '黑' ? service.config.blackGroups : service.config.whiteGroups

    await e.reply(list.length
      ? `邀请${type}名单群：\n${list.join('\n')}`
      : `邀请${type}名单群为空`
    )
    return true
  }

  async manageNotifyGroup(e = this.e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能管理邀请通知群')
      return true
    }

    const match = getText(e).match(/^#(添加|删除)邀请通知群\s*(\d+)?$/)
    const groupId = match?.[2] || e.group_id
    if (!groupId) {
      await e.reply('请指定群号或在群内使用')
      return true
    }

    const service = new InviteManagementService(e)
    const result = service.updateGroupList('notifyGroups', groupId, match?.[1] === '添加' ? 'add' : 'del')
    await e.reply(result.message)
    return true
  }

  async viewNotifyGroups(e = this.e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能查看邀请通知群')
      return true
    }

    const service = new InviteManagementService(e)
    await e.reply(service.config.notifyGroups.length
      ? `邀请通知群：\n${service.config.notifyGroups.join('\n')}`
      : '邀请通知群为空'
    )
    return true
  }

  async viewInviteConfig(e = this.e) {
    if (!e.isMaster) {
      await e.reply('只有主人才能查看群邀请审核配置')
      return true
    }

    const service = new InviteManagementService(e)
    const lines = [
      '群邀请审核配置',
      `状态：${service.config.enabled ? '已启用' : '已关闭'}`,
      `模式：${REVIEW_MODE_LABEL[service.config.reviewMode]}`,
      `通知群：${service.config.notifyGroups.length ? service.config.notifyGroups.join('、') : '未配置'}`,
      `通知用户：${service.config.notifyUsers.length ? service.config.notifyUsers.map(item => item.userId).join('、') : '未配置'}`,
      `待处理：${service.cleanExpiredPendingRequests().length} 条`,
      `有效期：${service.config.requestExpireMinutes} 分钟`
    ]
    await e.reply(lines.join('\n'))
    return true
  }
}
