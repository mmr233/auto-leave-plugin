import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-card-')))
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }
globalThis.Bot = { cfg: { master: [] } }

const { rememberInviteCard, findInviteCard } = await import('../model/inviteCard.js')
const { InviteManagementService } = await import('../model/inviteManagement.js')

function cardEvent(overrides = {}) {
  const card = {
    app: 'com.tencent.tuwen.lua',
    bizsrc: 'qun.invite',
    meta: { news: {
      desc: '邀请你加入群聊“测试群①”，进入可查看详情。',
      jumpUrl: 'mqqapi://group/invite_join?groupcode=123456&groupname=%E6%B5%8B%E8%AF%95%E7%BE%A4%E2%91%A0&senderuin=40004&receiveruin=10001',
      title: '邀请你加入群聊'
    } }
  }
  return {
    self_id: '10001',
    user_id: '30003',
    message_type: 'private',
    message: [{ type: 'json', data: JSON.stringify(card) }],
    ...overrides
  }
}

test('extracts a group name from the private card and isolates it by sender and bot', () => {
  assert.equal(rememberInviteCard(cardEvent()), true)
  assert.equal(findInviteCard({ self_id: '10001', user_id: '30003' }, '123456')?.groupName, '测试群①')
  assert.equal(findInviteCard({ self_id: '10001', user_id: '30004' }, '123456'), null)
  assert.equal(findInviteCard({ self_id: '10002', user_id: '30003' }, '123456'), null)
  assert.equal(findInviteCard({ self_id: '10001', user_id: '30003' }, '654321'), null)
})

test('accepts OneBot nested segments and a CQ-escaped raw card', () => {
  const event = cardEvent()
  const payload = event.message[0].data
  assert.equal(rememberInviteCard({ ...event, message: [{ type: 'json', data: { data: payload } }] }), true)
  const escaped = payload.replaceAll('&', '&amp;').replaceAll(',', '&#44;').replaceAll('[', '&#91;').replaceAll(']', '&#93;')
  assert.equal(rememberInviteCard({ ...event, message: [], raw_message: `[CQ:json,data=${escaped}]` }), true)
})

test('ignores cards for another bot, other message types and arbitrary URLs', () => {
  const event = cardEvent()
  const payload = JSON.parse(event.message[0].data)
  payload.meta.news.jumpUrl = payload.meta.news.jumpUrl.replace('receiveruin=10001', 'receiveruin=10002')
  assert.equal(rememberInviteCard({ ...event, message: [{ type: 'json', data: JSON.stringify(payload) }] }), false)
  assert.equal(rememberInviteCard(cardEvent({ message_type: 'group' })), false)
  payload.meta.news.jumpUrl = 'https://example.com/?groupcode=654321&groupname=伪造群'
  assert.equal(rememberInviteCard({ ...event, message: [{ type: 'json', data: JSON.stringify(payload) }] }), false)
})

test('uses card name but never assumes a member count from the card', async () => {
  const event = cardEvent()
  const card = JSON.parse(event.message[0].data)
  card.meta.news.member_count = 10000
  rememberInviteCard({ ...event, message: [{ type: 'json', data: JSON.stringify(card) }] })
  const bot = { self_id: '10001', async sendApi() { throw new Error('unavailable') } }
  const service = new InviteManagementService({ bot })
  const info = await service.getGroupInfo('123456', { self_id: '10001', user_id: '30003', flag: 'invite' })
  assert.equal(info.groupName, '测试群①')
  assert.equal(info.memberCount, null)
})

test('uses a matching card that arrives shortly after the invitation request', async () => {
  const event = cardEvent({ user_id: '30005' })
  const bot = { self_id: '10001', async sendApi() { throw new Error('unavailable') } }
  const service = new InviteManagementService({ bot })
  setTimeout(() => rememberInviteCard(event), 50)
  const info = await service.getGroupInfo('123456', { self_id: '10001', user_id: '30005', flag: 'invite' })
  assert.equal(info.groupName, '测试群①')
})

test('uses a group detail response with a verifiable member count', async () => {
  const actions = []
  const bot = {
    self_id: '10001',
    async sendApi(action) {
      actions.push(action)
      if (action === 'get_group_info') return { status: 'ok', data: { group_id: 123456, member_count: 0 } }
      if (action === 'get_group_detail_info') return { status: 'ok', data: { groupCode: '123456', groupName: '详细资料群', memberNum: 56 } }
      throw new Error('unsupported')
    }
  }
  const info = await new InviteManagementService({ bot }).getGroupInfo('123456')
  assert.equal(info.groupName, '详细资料群')
  assert.equal(info.memberCount, 56)
  assert.ok(actions.includes('get_group_detail_info'))
})

test('falls back to the extended group information response', async () => {
  const bot = {
    self_id: '10001',
    async sendApi(action) {
      if (action === 'get_group_info_ex') return { data: { group_info: { group_id: 123456, group_name: '扩展资料群', member_count: 70 } } }
      throw new Error('unsupported')
    }
  }
  const info = await new InviteManagementService({ bot }).getGroupInfo('123456')
  assert.equal(info.groupName, '扩展资料群')
  assert.equal(info.memberCount, 70)
})

test('does not use a count returned for a different group', async () => {
  const bot = {
    self_id: '10001',
    async sendApi(action) {
      if (action === 'get_group_detail_info') return { status: 'ok', data: { groupCode: '654321', groupName: '其他群', memberNum: 100 } }
      return { status: 'failed', retcode: 100, message: 'unavailable' }
    }
  }
  const info = await new InviteManagementService({ bot }).getGroupInfo('123456')
  assert.equal(info.groupName, '未知群名')
  assert.equal(info.memberCount, null)
})
