/**
 * 基础配置 Schema
 */
export const baseConfigSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '基础配置'
  },
  {
    component: 'Divider',
    label: '群成员检查设置',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'minMemberCount',
    label: '最低群成员数量',
    bottomHelpMessage: '低于此数量将自动退群',
    component: 'InputNumber',
    defaultValue: 50,
    componentProps: {
      min: 1,
      max: 500,
      step: 1,
      placeholder: '请输入最低群成员数量'
    }
  },
  {
    field: 'maxRetryCount',
    label: '最大重试次数',
    bottomHelpMessage: '获取群信息失败时的最大重试次数',
    component: 'InputNumber',
    defaultValue: 3,
    componentProps: {
      min: 1,
      max: 10,
      step: 1
    }
  },
  {
    field: 'retryDelay',
    label: '重试间隔（毫秒）',
    bottomHelpMessage: '重试间隔时间',
    component: 'InputNumber',
    defaultValue: 10000,
    componentProps: {
      min: 1000,
      max: 60000,
      step: 1000
    }
  },
  {
    component: 'Divider',
    label: '违禁词检测设置',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'bannedWordTriggerLimit',
    label: '违禁词触发次数限制',
    bottomHelpMessage: '超过此次数将自动退群',
    component: 'InputNumber',
    defaultValue: 3,
    componentProps: {
      min: 1,
      max: 10,
      step: 1
    }
  },
  {
    field: 'autoBlacklistOnBannedWord',
    label: '违禁词退群自动拉黑',
    bottomHelpMessage: '因违禁词退群时是否自动加入黑名单',
    component: 'Switch',
    defaultValue: true
  },
  {
    component: 'Divider',
    label: '禁言检测设置',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'muteCountLimit',
    label: '禁言次数限制',
    bottomHelpMessage: '被禁言超过此次数将自动退群',
    component: 'InputNumber',
    defaultValue: 2,
    componentProps: {
      min: 1,
      max: 10,
      step: 1
    }
  },
  {
    field: 'muteCountResetTime',
    label: '禁言次数重置时间（毫秒）',
    bottomHelpMessage: '24小时后重置计数',
    component: 'InputNumber',
    defaultValue: 86400000,
    componentProps: {
      min: 3600000,
      max: 604800000,
      step: 3600000
    }
  },
  {
    field: 'autoBlacklistOnMute',
    label: '禁言退群自动拉黑',
    bottomHelpMessage: '因禁言退群时是否自动加入黑名单',
    component: 'Switch',
    defaultValue: true
  }
]