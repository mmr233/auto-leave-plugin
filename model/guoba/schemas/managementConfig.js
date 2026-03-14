/**
 * 白名单群管理配置 Schema
 */
export const managementConfigSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '白名单群管理'
  },
  {
    component: 'Divider',
    label: '群聊黑名单',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'blacklistGroups',
    label: '黑名单群聊',
    bottomHelpMessage: '机器人进入这些群聊后将自动退出',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择要加入黑名单的群聊',
      allowInput: true
    }
  },
  {
    component: 'Divider',
    label: '用户黑名单',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'blacklistUsers',
    label: '黑名单用户',
    bottomHelpMessage: '这些用户进入白名单群聊后将被自动踢出',
    component: 'GSelectFriend',
    componentProps: {
      placeholder: '点击选择要加入黑名单的用户'
    }
  },
  {
    component: 'Divider',
    label: '管理功能设置',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'whitelistManagement.enabled',
    label: '启用白名单管理',
    bottomHelpMessage: '启用后白名单群内的违禁词将触发管理操作',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'whitelistManagement.bannedWordMuteTrigger',
    label: '禁言触发次数',
    bottomHelpMessage: '多少次违禁词触发一次禁言',
    component: 'InputNumber',
    defaultValue: 1,
    componentProps: {
      min: 1,
      max: 10,
      step: 1
    }
  },
  {
    field: 'whitelistManagement.muteLimitBeforeKick',
    label: '踢出前禁言次数',
    bottomHelpMessage: '用户被禁言多少次后踢出',
    component: 'InputNumber',
    defaultValue: 2,
    componentProps: {
      min: 1,
      max: 10,
      step: 1
    }
  },
  {
    field: 'whitelistManagement.baseMuteDuration',
    label: '基础禁言时长（分钟）',
    component: 'InputNumber',
    defaultValue: 5,
    componentProps: {
      min: 1,
      max: 60,
      step: 1
    }
  },
  {
    field: 'whitelistManagement.muteIncrement',
    label: '禁言时长递增（分钟）',
    bottomHelpMessage: '每次禁言时长递增',
    component: 'InputNumber',
    defaultValue: 5,
    componentProps: {
      min: 0,
      max: 30,
      step: 1
    }
  },
  {
    field: 'whitelistManagement.enableUserBlacklist',
    label: '启用用户黑名单',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'whitelistManagement.autoKickBlacklistedUsers',
    label: '自动踢出黑名单用户',
    component: 'Switch',
    defaultValue: true
  },
  {
    component: 'Divider',
    label: '管理消息配置',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'managementMessages.muteWarning',
    label: '禁言警告消息',
    bottomHelpMessage: '可用变量: {duration}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入禁言警告消息'
    }
  },
  {
    field: 'managementMessages.kickWarning',
    label: '踢出警告消息',
    component: 'Input',
    componentProps: {
      placeholder: '请输入踢出警告消息'
    }
  },
  {
    field: 'managementMessages.blacklistUserKick',
    label: '黑名单用户踢出提示',
    component: 'Input',
    componentProps: {
      placeholder: '请输入黑名单用户踢出提示'
    }
  },
  {
    field: 'managementMessages.adminReply',
    label: '管理员违禁词回复',
    bottomHelpMessage: '管理员发送违禁词时的特殊回复',
    component: 'Input',
    componentProps: {
      placeholder: '请输入管理员违禁词回复'
    }
  }
]