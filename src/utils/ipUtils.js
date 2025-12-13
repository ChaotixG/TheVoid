// utils/ipUtils.js

const https = require('https');
const DigestFetch = require('digest-fetch').default;
const { log, error } = require('../services/logger');


const clientDigest = new DigestFetch(process.env.MONGODB_PUBLIC_KEY, process.env.MONGODB_PRIVATE_KEY);

function getPublicIP() {
  return new Promise((res, rej) =>
    https
      .get('https://api.ipify.org?format=json', r => {
        let d = '';
        r.on('data', c => (d += c));
        r.on('end', () => res(JSON.parse(d).ip));
      })
      .on('error', rej)
  );
}

async function getCurrentAccessList() {
  const url = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${process.env.MONGODB_PROJECT_ID}/accessList`;
  const res = await clientDigest.fetch(url);
  const data = await res.json();

  if (!data.results || !Array.isArray(data.results)) {
    error("❌ Invalid API response:", data);
    throw new Error("Atlas API response is missing `results`");
  }

  return data.results.map(entry => entry.ipAddress);
}

/**
 * Remove any IPs in the access list that match the given comment.
 */
async function removeIPsByComment(commentToMatch) {
  const listUrl = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${process.env.MONGODB_PROJECT_ID}/accessList`;
  const res = await clientDigest.fetch(listUrl);
  const data = await res.json();

  if (!Array.isArray(data.results)) {
    throw new Error("Failed to fetch access list");
  }

  const targets = data.results.filter(entry =>
    entry.comment?.trim().toLowerCase() === commentToMatch.trim().toLowerCase() &&
    !!entry.ipAddress &&
    !!entry.cidrBlock
  );

  if (targets.length === 0) {
    log(`No IPs found with comment "${commentToMatch}"`);
    return;
  }

  for (const entry of targets) {
    const deleteUrl = `${listUrl}/${encodeURIComponent(entry.cidrBlock)}`;
    const delRes = await clientDigest.fetch(deleteUrl, { method: 'DELETE' });

    if (delRes.ok) {
      log(`✅ IP ${entry.ipAddress} (${entry.cidrBlock}) removed from whitelist`);
    } else {
      const errText = await delRes.text();
      error(`❌ Failed to remove IP ${entry.ipAddress}:`, errText);
    }
  }
}

async function addIPIfNeeded(ip) {
  const currentList = await getCurrentAccessList();
  if (currentList.includes(ip)) {
    log(`IP ${ip} already whitelisted`);
    return;
  }

  await removeIPsByComment(process.env.IP_DISCRIMINATOR).catch(err => {
    error(`Failed to remove old IPs: ${err.message}`);
  });

  const url = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${process.env.MONGODB_PROJECT_ID}/accessList`;
  const payload = JSON.stringify([{ ipAddress: ip, comment: process.env.IP_DISCRIMINATOR }]);

  const res = await clientDigest.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload
  });

  const resText = await res.text();
  if (res.status === 201 || res.status === 409) {
    log(`IP ${ip} added to whitelist`);
  } else {
    error(`Failed to whitelist IP ${ip}: ${res.status}`, resText);
    throw new Error(resText);
  }
}

module.exports = {
  getPublicIP,
  addIPIfNeeded,
  getCurrentAccessList,
  removeIPsByComment,
};
