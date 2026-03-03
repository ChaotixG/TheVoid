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

  if (!res.ok) {
    const errText = await res.text();
    error(`❌ API request failed with status ${res.status}:`, errText);
    throw new Error(`Atlas API returned ${res.status}: ${errText}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    const bodyText = await res.text();
    error("❌ Failed to parse API response as JSON:", bodyText);
    throw new Error(`Failed to parse Atlas API response: ${parseErr.message}`);
  }

  if (!data || !data.results || !Array.isArray(data.results)) {
    error("❌ Invalid API response structure:", data);
    throw new Error("Atlas API response is missing `results` field");
  }

  return data.results.map(entry => entry.ipAddress);
}

/**
 * Remove any IPs in the access list that match the given comment.
 */
async function removeIPsByComment(commentToMatch) {
  const listUrl = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${process.env.MONGODB_PROJECT_ID}/accessList`;
  const res = await clientDigest.fetch(listUrl);

  if (!res.ok) {
    const errText = await res.text();
    error(`❌ API request failed with status ${res.status}:`, errText);
    throw new Error(`Atlas API returned ${res.status}: ${errText}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    const bodyText = await res.text();
    error("❌ Failed to parse API response as JSON:", bodyText);
    throw new Error(`Failed to parse Atlas API response: ${parseErr.message}`);
  }

  if (!data || !Array.isArray(data.results)) {
    throw new Error("Failed to fetch access list: response missing results");
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

  if (!res.ok && res.status !== 409) {
    const resText = await res.text();
    error(`❌ Failed to whitelist IP ${ip}: ${res.status} - ${resText}`);
    throw new Error(`Failed to add IP to whitelist: ${res.status} ${resText}`);
  }

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
