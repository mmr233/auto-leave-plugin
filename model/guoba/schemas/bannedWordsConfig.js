/**
 * 违禁词管理配置 Schema
 */
export const bannedWordsConfigSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '违禁词管理'
  },
  {
    component: 'Divider',
    label: '违禁词列表',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'bannedWordsText',
    label: '违禁词',
    bottomHelpMessage: '每行一个违禁词，保存后自动去重',
    component: 'InputTextArea',
    componentProps: {
      placeholder: '请输入违禁词，每行一个\n例如：\n违禁词1\n违禁词2',
      rows: 8
    }
  }
]