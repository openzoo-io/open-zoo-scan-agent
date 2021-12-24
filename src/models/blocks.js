const mongoose = require("mongoose");

const Blocks =  mongoose.Schema({
  blockNumber: { type: Number, required: true, index: { unique: true } },
  blockHash: { type: String, required: true, index: { unique: true } },
});

mongoose.model("Blocks", Blocks);
