import dotenv from "dotenv";
import pinataSDK from "@pinata/sdk";
import fetch from "node-fetch";
import envalid, { str } from "envalid";

const NETLIFY_API_URL = "https://api.netlify.com/api/v1";

dotenv.config({ path: ".env.deploy" });

const env = envalid.cleanEnv(process.env, {
  FLEEK_API_KEY: str(),
  FLEEK_SITE_ID: str(),

  NETLIFY_API_KEY: str(),
  NETLIFY_DNS_ZONE_ID: str(),
  NETLIFY_DNS_LINK: str(),

  IPFS_HASH: str(),
});

main();

async function main() {
  const cid = env.IPFS_HASH;

  // console.log('crust pin');
  // await crust.pin(cid);

  // await pinToInfura(cid);

  await waitForCloudflareIpfs(cid);

  await updateDnslinkNetlify(cid);

  process.exit(0);
}

async function uploadToPinata(path) {
  const pinata = pinataSDK(env.PINATA_API_KEY, env.PINATA_API_SECRET);

  console.log("Upload to Pinata");

  await pinata.testAuthentication();

  console.log("Auth successful");

  const previousPins = await pinata.pinList({
    metadata: { name: env.PINATA_PIN_ALIAS },
    status: "pinned",
  });

  if (previousPins.rows.length) {
    console.log(`Found previous pins: ${previousPins.rows.map((r) => r.ipfs_pin_hash).join(", ")}`);
  }

  console.log("Uploading assets");

  const pinResult = await pinata.pinFromFS(path, {
    pinataMetadata: {
      name: env.PINATA_PIN_ALIAS,
    },
    pinataOptions: {
      customPinPolicy: {
        regions: [
          {
            id: "FRA1",
            desiredReplicationCount: 2,
          },
          {
            id: "NYC1",
            desiredReplicationCount: 2,
          },
        ],
      },
      cidVersion: 1,
    },
  });

  console.log(`Uploaded: ${pinResult.IpfsHash}`);

  const pinsToClean = previousPins.rows.filter((row) => row.ipfs_pin_hash !== pinResult.IpfsHash);

  if (pinsToClean.length) {
    console.log(`Cleaning up the previous pins`);

    for (let pin of previousPins.rows) {
      try {
        await pinata.unpin(pin.ipfs_pin_hash);
        console.log(`${pin.ipfs_pin_hash} - deleted`);
      } catch (e) {
        console.log(`Failed to unpin ${pin.ipfs_pin_hash}`);
        console.error(e);
      }
    }
  }

  return pinResult.IpfsHash;
}

async function pinToInfura(cid) {
  let retries = 5;

  console.log('INfura');

  while (retries > 0) {
    const res = await fetch(`https://ipfs.infura.io:5001/api/v0/pin/add?arg=${cid}`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`2GhJF9DH0L0GcIvfMkPgmFJaj3H:7b08b09bb6ae8832b576bb3aef0c4ab1`, 'binary').toString('base64')}`
      }
    });
  
    if (res.ok) {
      console.log(await res.json())
      return;
    } else {
      console.log(await res.text())
      console.log('Infura pinning error');
      await sleep(10000)
      retries--;
    }
  }

 
}


async function updateDnslinkNetlify(cid) {
  if (!cid) {
    throw new Error("No CID provided");
  }

  const dnslink = `dnslink=/ipfs/${cid}`;

  console.log(`Updating dnslink to ${dnslink}`);

  console.log("Retrieving an old dnslink record");
  const records = await requestNetlify(`/dns_zones/${env.NETLIFY_DNS_ZONE_ID}/dns_records`);

  const oldDnsLinkRecord = (records || []).find(
    (record) => record.type === "TXT" && record.hostname === env.NETLIFY_DNS_LINK
  );

  if (oldDnsLinkRecord) {
    console.log(`Found previous dnslink ${oldDnsLinkRecord.value}`);
  }

  if (oldDnsLinkRecord?.value === dnslink) {
    console.log(`Target dnslink is already set`);
    return;
  }
  
  console.log("Create a new DNS record");
  const newRecord = await requestNetlify(`/dns_zones/${env.NETLIFY_DNS_ZONE_ID}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "TXT",
      hostname: env.NETLIFY_DNS_LINK,
      value: dnslink,
      ttl: 300,
    }),
  });

  console.log("dnslink result", newRecord);

  if (oldDnsLinkRecord) {
    console.log("Delete the old dnslink record");
    await requestNetlify(`/dns_zones/${env.NETLIFY_DNS_ZONE_ID}/dns_records/${oldDnsLinkRecord.id}`, {
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
      Authorization: `Bearer ${env.NETLIFY_API_KEY}`,
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
