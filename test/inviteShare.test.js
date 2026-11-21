import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-share-')))
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }
globalThis.Bot = { cfg: { master: [] } }

const { rememberInviteCard } = await import('../model/inviteCard.js')
const { parseInviteSharePage } = await import('../model/inviteShare.js')
const { InviteManagementService } = await import('../model/inviteManagement.js')

function page(groupId = '123456', count = 56) {
  const data = [null, { groupcode: 2, memberCnt: 3, name: 4 }, groupId, count, '分享页测试群']
  return `<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(data)}</script>`
}

function remember(userId = '30003') {
  rememberInviteCard({
    self_id: '10001', user_id: userId, message_type: 'private',
    msg: '群分享 https://qm.qq.com/q/test123'
  })
}

function service() {
  return new InviteManagementService({ bot: { self_id: '10001', async sendApi() { throw new Error('unsupported') } } })
}

test('parses only verified group data and never treats an unknown count as zero', () => {
  assert.deepEqual(parseInviteSharePage(page(), '123456'), {
    groupId: '123456', groupName: '分享页测试群', memberCount: 56
  })
  assert.equal(parseInviteSharePage(page(), '654321'), null)
  assert.equal(parseInviteSharePage(page('123456', 0), '123456').memberCount, null)
  assert.equal(parseInviteSharePage('<script>alert(1)</script>', '123456'), null)
})

test('uses an official share page only after protocol queries fail', async () => {
  remember()
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async url => {
    calls.push(url)
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://qun.qq.com/universal-share/share?data=abc' } })
      : new Response(page(), { status: 200 })
  }
  try {
    const info = await service().getGroupInfo('123456', { self_id: '10001', user_id: '30003', flag: 'flag' })
    assert.deepEqual(info, { groupId: '123456', groupName: '分享页测试群', memberCount: 56 })
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = original
  }
})

test('uses the card sender share link when the original invitation was forwarded', async () => {
  remember('30006')
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(page(), { status: 200 })
  try {
    const info = await service().getGroupInfo('123456', {
      self_id: '10001', user_id: '40004', cardSenderId: '30006', flag: 'forwarded-flag'
    })
    assert.equal(info.memberCount, 56)
    assert.equal(info.groupName, '分享页测试群')
  } finally {
    globalThis.fetch = original
  }
})

test('ignores another group and refuses redirects outside the official allowlist', async () => {
  remember('30004')
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async url => {
    calls.push(url)
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/private' } })
  }
  try {
    const info = await service().getGroupInfo('123456', { self_id: '10001', user_id: '30004' })
    assert.equal(info.memberCount, null)
    assert.equal(calls.length, 1)
    globalThis.fetch = async () => new Response(page('654321', 999), { status: 200 })
    assert.equal((await service().getGroupInfo('123456', { self_id: '10001', user_id: '30004' })).memberCount, null)
  } finally {
    globalThis.fetch = original
  }
})

test('does not request a share page when the protocol supplies a count', async () => {
  remember('30005')
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  try {
    const bot = { self_id: '10001', async sendApi() { return { data: { group_id: 123456, member_count: 80 } } } }
    const info = await new InviteManagementService({ bot }).getGroupInfo('123456', { self_id: '10001', user_id: '30005' })
    assert.equal(info.memberCount, 80)
  } finally {
    globalThis.fetch = original
  }
})
