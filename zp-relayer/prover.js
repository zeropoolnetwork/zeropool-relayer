"use strict";
exports.__esModule = true;
var libzeropool_rs_node_1 = require("libzeropool-rs-node");
var txParams = libzeropool_rs_node_1.Params.fromFile('./transfer_params.bin');
process.on('message', function (_a) {
    var pub = _a.pub, sec = _a.sec;
    var proof = libzeropool_rs_node_1.Proof.tx(txParams, pub, sec);
    if (process.send)
        process.send(proof);
    process.exit();
});
