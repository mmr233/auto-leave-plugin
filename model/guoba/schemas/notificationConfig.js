/**
 * 通知配置 Schema
 */
const NOTIFICATION_VARIABLE_HELP = '变量说明：{groupId}=群号，{groupName}=群名，{reason}=退群原因，{time}=通知发送时间'

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
    bottomHelpMessage: NOTIFICATION_VARIABLE_HELP,
    component: 'Input',
    componentProps: {
      placeholder: '请输入通知消息模板',
      type: 'textarea'
    }
  }
]
