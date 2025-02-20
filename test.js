// import and set global polyfills
global.fetch = require("node-fetch")
global.window = {}
global.window.crypto = require('crypto').webcrypto
global.window.btoa = require('btoa')

const assert = require('assert').strict
const setTimeout = require('timers/promises').setTimeout

const { run, test } = require('./runTests.js')
const AcmeClient = require('./index.js')
const domainName = 'jontest.xyz'
const zoneId = 'cff587a5d09d98acbe42b74b3827aa6e'

let apiToken
try {
  const cloudfare = require('./cloudfare.json')
  apiToken = cloudfare.token
} catch {
  // If CI, token will be environment variable set by the github action
  apiToken = process.env.CLOUDFARE_API_TOKEN
}


run(() => {
  test('should create an AcmeClient object', async () => {
    const ac = await AcmeClient('letsencrypt-staging')

    assert.equal(typeof ac, 'object')
    assert.equal(typeof ac.exportJwk(), 'object')
  })

  let ac
  let recordName
  let recordText
  let order

  test('should request a DNS challenge', async () => {
    ac = await AcmeClient('letsencrypt-staging');
    ({ recordName, recordText, order } = await ac.requestDnsChallenge(domainName));

    assert.equal(recordName, '_acme-challenge')
    assert.equal(typeof recordText, 'string')
    assert.equal(typeof order, 'object')
    assert.equal(order.status, 'pending')
    assert.deepEqual(order.identifiers, [ { type: 'dns', value: domainName } ])
  })

  test('should complete the DNS challenge', async () => {
    await setTXTRecord(recordName, recordText)

    const { pemCertChain, pkcs8Key } = await ac.submitDnsChallengeAndFinalize(order)

    assert.equal(typeof pemCertChain, 'object')
    assert(pemCertChain.length > 1)
    pemCertChain.forEach(cert => {
      assert.equal(typeof cert, 'string')
      assert(cert.includes('-----BEGIN CERTIFICATE-----'))
    })
    assert.equal(typeof pkcs8Key, 'string')
    assert(pkcs8Key.includes('-----BEGIN PRIVATE KEY-----'))
  })
})


// Set a TXT record for jontest.xyz using Cloudfare's API
function setTXTRecord(recordName, recordText) {
  const dnsRecordsUrl = "https://api.cloudflare.com/client/v4/zones/".concat(zoneId, "/dns_records")
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer ".concat(apiToken)
  }
  return fetch(dnsRecordsUrl.concat("?type=TXT&name=", recordName, ".", domainName, "&page=1&per_page=100&order=type&direction=desc&match=all"), {
    headers
  })
  .then(res => res.json())
  .then(body => {
    if (!body.success) {
      throw new Error(JSON.stringify(body.errors))
    }
    return Promise.all(body.result.map(record => {
      console.log('deleting record '.concat(record.id))
      return fetch(dnsRecordsUrl.concat("/", record.id), {
        headers,
        method: "DELETE"
      })
    }))
  })
  .then(() => {
    return fetch(dnsRecordsUrl, {
      body: JSON.stringify({
        "type": "TXT",
        "name": recordName.concat(domainName),
        "content": recordText,
        "ttl":60,
        "priority":10,
        "proxied":false
      }),
      headers,
      method: "POST"
    })
  })
  .then(res => res.json())
  .then(body => {
    if (!body.success) {
      throw new Error(JSON.stringify(body.errors))
    }
    console.log('created new record '.concat(body.result.id))
  })
  .then(() => {
    console.log("waiting 1 hour for changes to take effect...")
    return setTimeout(60*60*1000) // returns a Promise
  })
}
