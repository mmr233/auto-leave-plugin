import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-invite-expiry-')))
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }

const { Config, DEFAULT_INVITE_MESSAGES } = await import('../components/config.js')
const { InviteManagementService, reconcilePendingInviteRequests } = await import('../model/inviteManagement.js')
const { setConfigData } = await import('../model/guoba/setConfigData.js')
const { getConfigData } = await import('../model/guoba/getConfigData.js')

const messages = []
const bot = {
  self_id: '10001',
  pickFriend(userId) {
    return {
      async sendMsg(message) {
        messages.push({ userId, message })
      }
    }
  }
}
globalThis.Bot = bot

function resetConfig(notifyInviterOnExpiry = true) {
  const config = Config.loadConfig()
  config.inviteManagement.pendingRequests = []
  config.inviteManagement.requestExpireMinutes = 1
  config.inviteManagement.notifyInviterOnExpiry = notifyInviterOnExpiry
  Config.saveConfig(config)
  messages.length = 0
}

function request(requestId, requestTime) {
  return {
    requestId,
    botId: '10001',
    groupId: '123456',
    groupName: '测试群',
    userId: '20002',
    nickname: '邀请者',
    flag: requestId,
    subType: 'invite',
    requestTime
  }
}

test('Guoba saves and reads the expiry notification switch', async () => {
  resetConfig()
  const result = await setConfigData({
    'inviteManagement.notifyInviterOnExpiry': false
  }, {
    Result: { ok: () => ({ ok: true }), error: message => ({ ok: false, message }) }
  })
  assert.equal(result.ok, true)
  assert.equal((await getConfigData()).inviteManagement.notifyInviterOnExpiry, false)
  assert.equal(new InviteManagementService({ bot }).config.notifyInviterOnExpiry, false)
})

test('Guoba saves post-join settings without overwriting live review state', async () => {
  resetConfig()
  const snapshot = await getConfigData()
  snapshot.inviteManagement.reviewMode = 4
  snapshot.inviteManagement.stayReviewCooldownMinutes = 0
  const config = Config.loadConfig()
  const now = Date.now()
  config.inviteManagement.pendingJoins = [{ botId: '10001', groupId: '123456', userId: '20002', createdAt: now, expiresAt: now + 60000 }]
  config.inviteManagement.stayReviewCooldowns = [{ botId: '10001', groupId: '654321', expiresAt: now + 60000 }]
  Config.saveConfig(config)
  const result = await setConfigData(snapshot, {
    Result: { ok: () => ({ ok: true }), error: message => ({ ok: false, message }) }
  })
  assert.equal(result.ok, true)
  const readback = await getConfigData()
  assert.equal(readback.inviteManagement.reviewMode, 4)
  assert.equal(readback.inviteManagement.stayReviewCooldownMinutes, 0)
  assert.equal(readback.inviteManagement.pendingJoins.length, 1)
  assert.equal(readback.inviteManagement.stayReviewCooldowns.length, 1)
})

test('an unanswered invite sends its inviter one end notice at expiry', async () => {
  resetConfig()
  const service = new InviteManagementService({ bot })
  const delivered = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('expiry notice timed out')), 1000)
    bot.pickFriend = userId => ({
      async sendMsg(message) {
        messages.push({ userId, message })
        clearTimeout(timeout)
        resolve()
      }
    })
  })
  service.addPendingRequest(request('expires-soon', Date.now() - 59900))
  await delivered
  assert.equal(messages.length, 1)
  assert.equal(messages[0].userId, 20002)
  assert.match(messages[0].message, /审核已结束/)
  assert.match(messages[0].message, /群号：123456/)
  assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
  reconcilePendingInviteRequests()
  assert.equal(messages.length, 1)
})

test('resolved invites do not send expiry notices', async () => {
  resetConfig()
  const service = new InviteManagementService({ bot })
  service.addPendingRequest(request('resolved', Date.now() - 59800))
  service.removePendingRequest('resolved')
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(messages.length, 0)
})

test('restart recovery notifies for an expired persisted invite', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.pendingRequests = [request('before-restart', Date.now() - 61000)]
  Config.saveConfig(config)
  reconcilePendingInviteRequests()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(messages.length, 1)
  assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
  reconcilePendingInviteRequests()
  assert.equal(messages.length, 1)
})

test('restart recovery schedules a still-pending invitation', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.pendingRequests = [request('pending-at-restart', Date.now() - 59900)]
  Config.saveConfig(config)
  const delivered = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('recovered notice timed out')), 1000)
    bot.pickFriend = userId => ({
      async sendMsg(message) {
        messages.push({ userId, message })
        clearTimeout(timeout)
        resolve()
      }
    })
  })
  reconcilePendingInviteRequests()
  await delivered
  assert.equal(messages.length, 1)
  assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
})

test('reading expired requests sends the end notice once without a recovery sweep', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteMessages.inviteExpired = '审核超时：{groupId} / {groupName}'
  config.inviteManagement.pendingRequests = [request('lazy-expiry', Date.now() - 61000)]
  Config.saveConfig(config)
  const service = new InviteManagementService({ bot })
  assert.deepEqual(service.cleanExpiredPendingRequests(), [])
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(messages.map(item => item.message), ['审核超时：123456 / 测试群'])
  assert.deepEqual(service.cleanExpiredPendingRequests(), [])
  assert.equal(messages.length, 1)
})

test('disabled expiry notices still clear expired invitations', async () => {
  resetConfig(false)
  const config = Config.loadConfig()
  config.inviteManagement.pendingRequests = [request('no-notice', Date.now() - 61000)]
  Config.saveConfig(config)
  reconcilePendingInviteRequests()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(messages.length, 0)
  assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
})

test('legacy invite notice templates migrate and custom templates remain unchanged', async () => {
  for (const prefix of ['#', 't']) {
    const oldTemplate = `机器人加群邀请\n群号：{groupId}\n群名：{groupName}\n邀请人：{userId}\n邀请人昵称：{nickname}\n请求ID：{requestId}\n\n处理方式：引用本消息发送 ${prefix}确认加群 或 ${prefix}拒绝加群\n备用方式：${prefix}确认加群 {groupId}\n有效期：{expireMinutes} 分钟`
    const config = Config.loadConfig()
    config.inviteMessages.reviewNotification = oldTemplate
    assert.equal(Config.saveConfig(config), true)
    const loaded = Config.loadConfig()
    assert.equal(loaded.inviteMessages.reviewNotification, DEFAULT_INVITE_MESSAGES.reviewNotification)
    const saved = JSON.parse(fs.readFileSync(path.join(Config.configPath, 'config.json'), 'utf8'))
    assert.equal(saved.inviteMessages.reviewNotification, DEFAULT_INVITE_MESSAGES.reviewNotification)
    assert.equal((await getConfigData()).inviteMessages.reviewNotification, DEFAULT_INVITE_MESSAGES.reviewNotification)
  }

  const config = Config.loadConfig()
  config.inviteMessages.reviewNotification = '自定义通知：{groupName}'
  Config.saveConfig(config)
  assert.equal(Config.loadConfig().inviteMessages.reviewNotification, '自定义通知：{groupName}')
  assert.equal((await getConfigData()).inviteMessages.reviewNotification, '自定义通知：{groupName}')
})
