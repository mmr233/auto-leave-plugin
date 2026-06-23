export const groupAdminConfigSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '群管配置'
  },
  {
    component: 'Divider',
    label: '用户名单',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'groupAdmin.whiteQQ',
    label: '群管白名单用户',
    bottomHelpMessage: '白名单用户不受群管违禁词和手动禁言影响（主人除外）',
    component: 'GSelectFriend',
    componentProps: {
      placeholder: '点击选择白名单用户',
      multiple: true
    }
  },
  {
    field: 'groupAdmin.blackQQ',
    label: '群管黑名单用户',
    bottomHelpMessage: '黑名单用户进群后会自动踢出，申请入群时会自动拒绝',
    component: 'GSelectFriend',
    componentProps: {
      placeholder: '点击选择黑名单用户',
      multiple: true
    }
  },
  {
    field: 'groupAdmin.noBan',
    label: '白名单自动解禁',
    component: 'Switch',
    defaultValue: false
  },
  {
    component: 'Divider',
    label: '投票设置',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'groupAdmin.voteBan',
    label: '启用投票禁言',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'groupAdmin.voteKick',
    label: '启用投票踢人',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'groupAdmin.outTime',
    label: '投票超时时间（秒）',
    component: 'InputNumber',
    defaultValue: 180,
    componentProps: {
      min: 60,
      max: 3600,
      step: 10
    }
  },
  {
    field: 'groupAdmin.minNum',
    label: '最低支持票数',
    component: 'InputNumber',
    defaultValue: 4,
    componentProps: {
      min: 1,
      max: 50,
      step: 1
    }
  },
  {
    field: 'groupAdmin.banTime',
    label: '投票禁言时长（秒）',
    component: 'InputNumber',
    defaultValue: 3600,
    componentProps: {
      min: 60,
      max: 2592000,
      step: 60
    }
  },
  {
    field: 'groupAdmin.veto',
    label: '管理员一票权',
    bottomHelpMessage: '启用后管理员支持可直接通过，反对可直接取消',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'groupAdmin.voteAdmin',
    label: '允许投票管理员',
    bottomHelpMessage: '需要 Bot 为群主时才可实际处理管理员',
    component: 'Switch',
    defaultValue: false
  },
  {
    component: 'Divider',
    label: '入群验证',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'groupAdmin.groupVerify.openGroup',
    label: '开启验证群聊',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择需要开启入群验证的群聊',
      allowInput: true
    }
  },
  {
    field: 'groupAdmin.groupVerify.successMsgs',
    label: '验证成功消息',
    bottomHelpMessage: 'key 为群号，0 为默认回复',
    component: 'GSubForm',
    componentProps: {
      multiple: true,
      schemas: [
        {
          field: 'groupId',
          label: '群号',
          component: 'Input',
          required: true
        },
        {
          field: 'msg',
          label: '消息',
          component: 'Input',
          required: true
        }
      ]
    }
  },
  {
    field: 'groupAdmin.groupVerify.mode',
    label: '验证模式',
    component: 'RadioGroup',
    componentProps: {
      options: [
        { label: '精确匹配', value: '精确' },
        { label: '模糊匹配', value: '模糊' }
      ]
    },
    defaultValue: '精确'
  },
  {
    field: 'groupAdmin.groupVerify.times',
    label: '最多尝试次数',
    component: 'InputNumber',
    defaultValue: 7,
    componentProps: {
      min: 1,
      max: 20,
      step: 1
    }
  },
  {
    field: 'groupAdmin.groupVerify.remindAtLastMinute',
    label: '最后一分钟提醒',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'groupAdmin.groupVerify.time',
    label: '验证超时时间（秒）',
    component: 'InputNumber',
    defaultValue: 300,
    componentProps: {
      min: 30,
      max: 1800,
      step: 30
    }
  },
  {
    field: 'groupAdmin.groupVerify.range.min',
    label: '算式最小值',
    component: 'InputNumber',
    defaultValue: 10,
    componentProps: {
      min: 1,
      max: 1000,
      step: 1
    }
  },
  {
    field: 'groupAdmin.groupVerify.range.max',
    label: '算式最大值',
    component: 'InputNumber',
    defaultValue: 100,
    componentProps: {
      min: 2,
      max: 5000,
      step: 1
    }
  },
  {
    field: 'groupAdmin.groupVerify.delayTime',
    label: '延迟发送验证（秒）',
    component: 'InputNumber',
    defaultValue: 2,
    componentProps: {
      min: 0,
      max: 60,
      step: 1
    }
  },
  {
    component: 'Divider',
    label: '加群申请通知',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'groupAdmin.groupAddNotice.openGroup',
    label: '通知发送群聊',
    bottomHelpMessage: '收到加群申请时，将申请信息转发到这些群',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择需要接收申请通知的群聊',
      allowInput: true
    }
  },
  {
    field: 'groupAdmin.groupAddNotice.msg',
    label: '通知前缀消息',
    component: 'Input',
    componentProps: {
      placeholder: '请输入加群通知前缀消息'
    }
  }
]
