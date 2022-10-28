import pinataSDK from "@pinata/sdk";

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_API_SECRET = process.env.PINATA_API_SECRET;
const PINATA_PIN_ALIAS = process.env.PINATA_PIN_ALIAS;
const BUILD_PATH = process.env.BUILD_PATH;

if (!PINATA_API_KEY) throw new Error('PINATA_API_KEY is required');
if (!PINATA_API_SECRET) throw new Error('PINATA_API_SECRET is required');
if (!BUILD_PATH) throw new Error('BUILD_PATH is required');
if (!PINATA_PIN_ALIAS) throw new Error('PINATA_PIN_ALIAS is required');

main();

async function main() {
    const cid = await uploadToPinata(BUILD_PATH);

    process.env.GITHUB_OUTPUT = `hash=${cid}`
}

async function uploadToPinata(path) {
    const pinata = pinataSDK(PINATA_API_KEY, PINATA_API_SECRET);
  
    console.log("Upload to Pinata");
  
    await pinata.testAuthentication();
  
    console.log("Auth successful");
  
    const previousPins = await pinata.pinList({
      metadata: { name: PINATA_PIN_ALIAS },
      status: "pinned",
    });
  
    if (previousPins.rows.length) {
      console.log(`Found previous pins: ${previousPins.rows.map((r) => r.ipfs_pin_hash).join(", ")}`);
    }
  
    console.log("Uploading assets");
  
    const pinResult = await pinata.pinFromFS(path, {
      pinataMetadata: {
        name: PINATA_PIN_ALIAS,
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