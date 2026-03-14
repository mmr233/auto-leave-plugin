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
    field: 'bannedWords',
    label: '违禁词列表',
    bottomHelpMessage: '每行一个违禁词，保存后将自动更新。支持中英文、符号等任意字符。',
    component: 'InputTextArea',
    componentProps: {
      placeholder: '请输入违禁词，每行一个\n例如：\n违禁词1\n违禁词2\n违禁词3',
      autoSize: {
        minRows: 6,
        maxRows: 20
      }
    }
  },
  {
    component: 'Divider',
    label: '当前违禁词统计',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'bannedWordsCount',
    label: '违禁词总数',
    bottomHelpMessage: '当前配置的违禁词数量（只读）',
    component: 'InputNumber',
    componentProps: {
      disabled: true
    }
  }
]