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
    bottomHelpMessage: '人工审核会发送通知，等待 #确认加群 或 #拒绝加群',
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
    bottomHelpMessage: '人工审核通知会同时私聊这些用户',
    component: 'GSubForm',
    componentProps: {
      multiple: true,
      showRemove: true,
      showAdd: true,
      schemas: [
        {
          field: 'userId',
          label: 'QQ号',
          required: true,
          component: 'Input',
          componentProps: {
            placeholder: '请输入QQ号'
          }
        },
        {
          field: 'remark',
          label: '备注',
          component: 'Input',
          componentProps: {
            placeholder: '可选'
          }
        }
      ]
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
    bottomHelpMessage: '这些群的邀请会自动同意；进群后跳过人数检查',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择白名单群，可手动输入',
      allowInput: true
    }
  }
]
