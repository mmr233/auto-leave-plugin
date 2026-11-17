import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-invite-expiry-')))
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }

const { Config } = await import('../components/config.js')
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
