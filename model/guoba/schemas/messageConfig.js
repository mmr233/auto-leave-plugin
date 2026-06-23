/**
 * 消息配置 Schema
 */
export const messageConfigSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '消息配置'
  },
  {
    component: 'Divider',
    label: '退群提示消息',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'leaveMessage',
    label: '成员不足退群提示',
    bottomHelpMessage: '可用变量: {memberCount}, {minMemberCount}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入退群提示消息'
    }
  },
  {
    field: 'blacklistMessage',
    label: '黑名单退群提示',
    component: 'Input',
    componentProps: {
      placeholder: '请输入黑名单退群提示'
    }
  },
  {
    field: 'whitelistJoinMessage',
    label: '白名单进群提示',
    bottomHelpMessage: '可用变量: {groupId}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入白名单进群提示'
    }
  },
  {
    field: 'bannedWordLeaveMessage',
    label: '违禁词退群提示',
    component: 'Input',
    componentProps: {
      placeholder: '请输入违禁词退群提示'
    }
  },
  {
    field: 'muteLeaveMessage',
    label: '禁言退群提示',
    bottomHelpMessage: '可用变量: {muteCount}, {muteCountLimit}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入禁言退群提示'
    }
  },
  {
    field: 'errorLeaveMessage',
    label: '错误退群提示',
    component: 'Input',
    componentProps: {
      placeholder: '请输入错误退群提示'
    }
  },
  {
    component: 'Divider',
    label: '群邀请审核消息',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'inviteMessages.reviewNotification',
    label: '审核通知模板',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}, {requestId}, {expireMinutes}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入审核通知模板',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.inviteSubmitted',
    label: '提交审核通知',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {expireMinutes}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入提交审核通知',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.inviteApproved',
    label: '邀请通过通知',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入邀请通过通知',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.inviteRejected',
    label: '邀请拒绝通知',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入邀请拒绝通知',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.resultApproved',
    label: '同意结果回复',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入同意结果回复',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.resultRejected',
    label: '拒绝结果回复',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入拒绝结果回复',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.autoApproved',
    label: '自动同意通知',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入自动同意通知',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.autoRejected',
    label: '自动拒绝通知',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入自动拒绝通知',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.blackGroupRejected',
    label: '黑名单群拒绝通知',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入黑名单群拒绝通知',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.reviewDisabled',
    label: '审核关闭通知',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入审核关闭通知',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.noNotifyTarget',
    label: '无通知目标提示',
    component: 'Input',
    componentProps: {
      placeholder: '请输入无通知目标提示',
      type: 'textarea'
    }
  },
  {
    field: 'inviteMessages.pendingNotFound',
    label: '请求不存在提示',
    component: 'Input',
    componentProps: {
      placeholder: '请输入请求不存在提示'
    }
  },
  {
    field: 'inviteMessages.permissionDenied',
    label: '权限不足提示',
    component: 'Input',
    componentProps: {
      placeholder: '请输入权限不足提示'
    }
  },
  {
    field: 'inviteMessages.processFailed',
    label: '处理失败提示',
    bottomHelpMessage: '变量: {error}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入处理失败提示'
    }
  },
  {
    field: 'inviteMessages.blackGroupRejectReason',
    label: '黑名单群拒绝原因',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入黑名单群拒绝原因'
    }
  },
  {
    field: 'inviteMessages.autoRejectReason',
    label: '自动拒绝原因',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入自动拒绝原因'
    }
  },
  {
    field: 'inviteMessages.manualRejectReason',
    label: '人工拒绝原因',
    bottomHelpMessage: '变量: {groupId}, {groupName}, {userId}, {nickname}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入人工拒绝原因'
    }
  }
]
