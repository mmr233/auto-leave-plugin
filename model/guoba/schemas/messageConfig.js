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
  }
]