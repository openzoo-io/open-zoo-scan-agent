require('dotenv').config();
const mongoose = require("mongoose");
require("./models/blocks");
const Blocks = mongoose.model("Blocks");
const Web3 = require('web3');
const axios = require('axios');
const sleep = require('ko-sleep');
const web3 = new Web3(new Web3.providers.HttpProvider(process.env.RPC_URL));
const chainId = process.env.CHAIN_ID;
const startBlock = {
  999: 16444451,
  888: 16444451,
};
const apiEndPoint = process.env.API_ENDPOINT;

const resyncBlock = 10;

const trackedSC = [];

async function scan(dbBlock) {
  let start = dbBlock ? dbBlock.blockNumber - resyncBlock : startBlock[Number(chainId)];
  console.log('scan start from', start);
  console.log('current block', await web3.eth.getBlockNumber());
  let current = start;
  let hash = null;
  while(true) {
    try {
      let block = await web3.eth.getBlock(current);
      console.log('got block', block ? block.number : 'empty');
      if (!block) {
        await sleep(5000);
        continue;
      }

      if (hash && block && block.parentHash !== hash) {
        current = current - resyncBlock;
        hash = null;
        continue;
      }

      if (block.transactions.length > 0) {
        for (let i=0; i<block.transactions.length; i++) {
          let tx = await web3.eth.getTransaction(block.transactions[i]);
          if (tx.input.length > 0) { // sc call
            let receipt = await web3.eth.getTransactionReceipt(tx.hash);
            if (receipt.logs.length > 0) { // tx has logs
              console.log('tx logs', receipt.logs.length);
              let arr = receipt.logs.map((v) => {
                return processEvent(v);
              });
              await Promise.all(arr);
            }
          }
        }
      }

      let ret = await Blocks.updateOne({}, {blockNumber: block.number, blockHash: block.hash}, {upsert: true});
      hash = block.hash;
      // console.log('db update', ret.modifiedCount, block.number);
      current++;
    } catch (error) {
      console.log(error);
      await sleep(5000);
    }
  }
}

const track721Address = async () => {
  const func = async () => {
    try {
      let response = await axios.get(`${apiEndPoint}getTrackable721Contracts`)
      if (response) {
        let data = response.data;
        if (data.status == 'success') {
          data = data.data;
          data.map((address) => {
            if (!trackedSC.includes(address)) {
              trackedSC.push(address);
            }
          });
        }
      }
      console.log('Total collections', trackedSC.length);
    } catch (error) {
      console.log(error);
    }
    setTimeout(func, 1000 * 10);
  }
  await func()

}

async function processEvent(event) {
  console.log('processEvent', event.topics[0]);
  if (eventMap[event.topics[0]]) {
    console.log('found event', eventMap[event.topics[0]].name);
    await eventMap[event.topics[0]].fn(event);
    await sleep(500);
  }
}

async function callApi(endpoint, data) {
  console.log('callApi', endpoint, data);
  let ret = await axios({
    method: 'post',
    url: apiEndPoint + endpoint,
    data,
  });
  // console.log('callApi ret', ret);
}

const eventMap = {
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': {
    name: 'Transfer',
    fn: async (_event) => {
      if (trackedSC.includes(_event.address.toLowerCase())) {
        let data = { address: _event.address, to: '0x' + _event.topics[2].slice(-40), tokenID: parseInt(_event.topics[3])};
        await callApi('handle721Transfer', data);
        
      }
    }
  }
}

process.on('unhandledRejection', (err) => {
  console.error(err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  console.log('!openzoo scan agent start', new Date());
  await track721Address();
  let dbBlock = await Blocks.findOne({});
  console.log('dbBlock', dbBlock);
  await scan(dbBlock);
  exit(1); // always restart by pm2
}

const connect = () => {
  const uri = process.env.MONGO_DB ? process.env.MONGO_DB : 'mongodb://127.0.0.1:27017/openzoo';
  mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = mongoose.connection;
  db.on("error", console.error.bind(console, "connection error:"));
  db.once("open", function () {
    console.log("zoogenes agent server has been connected to the db server");
    main();
  });
};

connect();