/**
 * 通知配置 Schema
 */
export const notificationConfigSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '通知设置'
  },
  {
    field: 'notification.enabled',
    label: '启用主人通知',
    bottomHelpMessage: '退群时向主人发送通知',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'notification.message',
    label: '通知消息模板',
    bottomHelpMessage: '可用变量: {groupId}, {groupName}, {reason}, {time}',
    component: 'Input',
    componentProps: {
      placeholder: '请输入通知消息模板',
      type: 'textarea'
    }
  }
]