"use strict";

var app = require('./app.js');

//set parameters as appropriate
var port = process.env.PORT || 3000;

const config = {
    root: __dirname,
    port: port,
    logLevel: 'INFO',
    logger: null,
		basicAuth: null,
		sslOptions: null
};

// Create an express app instance
var express_app = app.init(config);

// Start the server listening..
console.log('Start listening on port ' + port);

express_app.listen(port);
