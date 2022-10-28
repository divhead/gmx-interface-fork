import fetch from "node-fetch";

const NETLIFY_API_URL = "https://api.netlify.com/api/v1";

const NETLIFY_API_KEY = process.env.NETLIFY_API_KEY;
const NETLIFY_DNS_ZONE_ID = process.env.NETLIFY_DNS_ZONE_ID;
const NETLIFY_DNS_LINK = process.env.NETLIFY_DNS_LINK;
const cid = process.env.IPFS_HASH;

if (!NETLIFY_API_KEY) throw new Error('NETLIFY_API_KEY is required');
if (!NETLIFY_DNS_ZONE_ID) throw new Error('NETLIFY_DNS_ZONE_ID is required');
if (!NETLIFY_DNS_LINK) throw new Error('NETLIFY_DNS_LINK is required');
if (!cid) throw new Error('IPFS_HASH is required');

main();

async function main() {
    await waitForCloudflareIpfs(cid);

    await updateNetlifyDnsLink(cid);
}

async function updateNetlifyDnsLink(cid) {
    if (!cid) {
        throw new Error("No CID provided");
    }

    const dnslink = `dnslink=/ipfs/${cid}`;

    console.log(`Updating dnslink to ${dnslink}`);

    console.log("Retrieving an old dnslink record");
    const records = await requestNetlify(`/dns_zones/${NETLIFY_DNS_ZONE_ID}/dns_records`);

    const oldDnsLinkRecord = (records || []).find(
        (record) => record.type === "TXT" && record.hostname === NETLIFY_DNS_LINK
    );

    if (oldDnsLinkRecord) {
        console.log(`Found previous dnslink ${oldDnsLinkRecord.value}`);
    }

    if (oldDnsLinkRecord?.value === dnslink) {
        console.log(`Target dnslink is already set`);
        return;
    }
    
    console.log("Create a new DNS record");
    const newRecord = await requestNetlify(`/dns_zones/${NETLIFY_DNS_ZONE_ID}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
        type: "TXT",
        hostname: NETLIFY_DNS_LINK,
        value: dnslink,
        ttl: 300,
    }),
    });

    console.log("dnslink result", newRecord);

    if (oldDnsLinkRecord) {
        console.log("Delete the old dnslink record");
        await requestNetlify(`/dns_zones/${NETLIFY_DNS_ZONE_ID}/dns_records/${oldDnsLinkRecord.id}`, {
            method: "DELETE",
        });

        console.log("Deleted");
    }
}

async function waitForCloudflareIpfs(cid) {
    if (!cid) {
      throw new Error("No CID provided");
    }
  
    const url = `https://cloudflare-ipfs.com/ipfs/${cid}`;
  
    console.log(`Waiting the CID to be resolved on Cloudflare: ${url}`);
  
    let retries = 10;
    let resolved = false;
  
    while (retries > 0) {
      console.log(`Attempt to resolve the CID, remaining retries: ${retries}`);
  
      await sleep(5000);
  
      try {
        const res = await fetch(url);
  
        if (res?.ok) {
          resolved = true;
          break;
        } else {
          retries--;
        }
      } catch {
        retries--;
      }
    }
  
    if (!resolved) {
      throw new Error("Failed to resolve CID on IPFS gateway");
    }
}

async function requestNetlify(path, opts) {
    const res = await fetch(`${NETLIFY_API_URL}${path}`, {
        headers: {
        Authorization: `Bearer ${NETLIFY_API_KEY}`,
        "Content-Type": "application/json",
        },
        ...opts,
    });

    if (res.ok) {
        return res.json().catch(() => null);
    } else {
        throw new Error(`Netlify error: ${await res.text()}`);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}