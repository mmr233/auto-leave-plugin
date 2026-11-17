/**
 * 机器人群邀请审核配置 Schema
 */
export const inviteManagementConfigSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '群邀请审核'
  },
  {
    component: 'Divider',
    label: '审核设置',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'inviteManagement.enabled',
    label: '启用群邀请审核',
    bottomHelpMessage: '机器人被邀请进群时按此处规则处理',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'inviteManagement.reviewMode',
    label: '审核模式',
    bottomHelpMessage: '人工审核会发送通知，等待 t确认加群 或 t拒绝加群',
    component: 'RadioGroup',
    defaultValue: 2,
    componentProps: {
      options: [
        { label: '自动同意', value: 0 },
        { label: '关闭不处理', value: 1 },
        { label: '人工审核', value: 2 },
        { label: '自动拒绝', value: 3 }
      ]
    }
  },
  {
    field: 'inviteManagement.allowInviterConfirm',
    label: '允许邀请者确认',
    bottomHelpMessage: '关闭后邀请者本人不能处理自己的邀请请求',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'inviteManagement.requestExpireMinutes',
    label: '请求有效期（分钟）',
    component: 'InputNumber',
    defaultValue: 5,
    componentProps: {
      min: 1,
      max: 60,
      step: 1
    }
  },
  {
    field: 'inviteManagement.notifyInviterOnExpiry',
    label: '审核到期通知邀请者',
    bottomHelpMessage: '机器人加群邀请在有效期内未被处理时，私聊邀请者告知本次审核已结束；不会主动拒绝 QQ 邀请',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'inviteManagement.maxPendingRequests',
    label: '最大待处理数',
    component: 'InputNumber',
    defaultValue: 20,
    componentProps: {
      min: 1,
      max: 100,
      step: 1
    }
  },
  {
    field: 'inviteManagement.stayReviewMinutes',
    label: '已入群低人数审核时效（分钟）',
    bottomHelpMessage: '机器人直接入群后人数不足时等待确认；到期未确认则退群，重启后按截止时间补处理',
    component: 'InputNumber',
    defaultValue: 10,
    componentProps: { min: 1, max: 1440, step: 1 }
  },
  {
    component: 'Divider',
    label: '邀请前人数预检查',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'inviteManagement.precheckMemberCount',
    label: '启用群人数预检查',
    bottomHelpMessage: '同意邀请前读取群成员数量，与基础配置中的最低群成员数比较；黑白名单邀请不受此项影响',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'inviteManagement.excludeBotFromPrecheck',
    label: '预检查排除受邀机器人',
    bottomHelpMessage: '开启时按机器人入群前的群人数比较；关闭时按现有人数加上本次受邀机器人比较，不会排除群内其他机器人',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'inviteManagement.precheckMode',
    label: '预检查模式',
    bottomHelpMessage: '拒绝模式会把低于最低人数的邀请判定为预检查失败，提示模式只记录提示并继续普通流程',
    component: 'RadioGroup',
    defaultValue: 'reject',
    componentProps: {
      options: [
        { label: '低于要求时判定失败', value: 'reject' },
        { label: '低于要求时仅提示', value: 'warn' }
      ]
    }
  },
  {
    field: 'inviteManagement.precheckFailureAction',
    label: '预检查失败动作',
    bottomHelpMessage: '人数不足或无法读取人数时的处理动作；转人工审核会在机器人入群前等待处理，同意后跳过本次进群人数检查',
    component: 'RadioGroup',
    defaultValue: 'manual',
    componentProps: {
      options: [
        { label: '转人工审核', value: 'manual' },
        { label: '直接拒绝', value: 'reject' },
        { label: '继续普通规则', value: 'continue' }
      ]
    }
  },
  {
    field: 'inviteManagement.notifyMasterOnPrecheckReject',
    label: '预检查失败通知主人',
    bottomHelpMessage: '预检查失败时私聊通知主人，并附带 t强制同意加群 入口',
    component: 'Switch',
    defaultValue: true
  },
  {
    component: 'Divider',
    label: '通知配置',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'inviteManagement.notifyGroups',
    label: '通知群',
    bottomHelpMessage: '人工审核通知会发送到这些群',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择通知群，可手动输入',
      allowInput: true
    }
  },
  {
    field: 'inviteManagement.notifyUsers',
    label: '通知用户',
    bottomHelpMessage: '人工审核通知会同时私聊这些好友，刷新后按好友昵称回显',
    component: 'GSelectFriend',
    componentProps: {
      placeholder: '点击选择通知用户',
      showSelected: true,
      maxTagCount: 8
    }
  },
  {
    component: 'Divider',
    label: '邀请黑白名单',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'inviteManagement.blackGroups',
    label: '邀请黑名单群',
    bottomHelpMessage: '这些群的邀请会自动拒绝；若机器人已进入也会自动退出',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择黑名单群，可手动输入',
      allowInput: true
    }
  },
  {
    field: 'inviteManagement.whiteGroups',
    label: '邀请白名单群',
    bottomHelpMessage: '这些群的邀请会自动同意；生效时也会视为白名单群跳过人数检查',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择白名单群，可手动输入',
      allowInput: true
    }
  },
  {
    field: 'inviteManagement.approvedGroups',
    label: '已批准群（一次性）',
    bottomHelpMessage: '兼容旧版放行列表；新的人工批准状态按 Bot 隔离，并在进群消费或过期后清理',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择已批准群，可手动输入',
      allowInput: true
    }
  }
]
