var express = require('express')
  , http = require('http')
  , https = require('https')
  , path = require('path')
  , _ = require('underscore')
  , io = require('socket.io-client')
  , async = require('async')
  , db = require('./routes/db')
  , orders = require('./routes/orders');

var app = express();

// all environments
app.set('port', process.env.PORT || 80);
app.use(express.favicon());
app.use(express.compress());
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(express.static(path.join(__dirname, 'public')));

// Register Express routes
app.post('/orders', orders.addOrder);
app.get('/orders', orders.getAllOrders);

// Establish DB connection
db.init();

// Get a socket listening to the MtGox API
var socket = io.connect('https://socketio.mtgox.com/mtgox?Currency=EUR');

var MTGOX_BTCEUR_CHANNELS = {
  trade: 'dbf1dee9-4f2e-4a08-8cb7-748919a71b21',
  depth: '057bdc6b-9f9c-44e4-bc1a-363e4443ce87',
  ticker: '0bb6da8b-f6c6-4ecf-8f0d-a544ad948c15'
}

// unsubscribe from depth and trade messages
socket.emit('message', {
  op: 'unsubscribe',
  channel: MTGOX_BTCEUR_CHANNELS.trade
});
socket.emit('message', {
  op: 'unsubscribe',
  channel: MTGOX_BTCEUR_CHANNELS.depth
});

function processActiveOrders() {

}

function runApplication() {
  // TODO Read from MongoDB
  var eur = 1000;
  var btc = 2.00000;
  var buy = 55;
  var sell = 60;
  var open_orders = [];
  /*db.findAllOrders(function(err, allOrders) {
    if (err)
      throw err;

    open_orders = _.select(allOrders, function(elem){
      return elem.fired_date == null;
    });

    console.log('Loaded all open orders in memory:');
    console.log(open_orders);
  });*/

  socket.on('message', function(data) {
      if (data.channel_name == 'ticker.BTCEUR') {
        // Parse latest prices out of the incoming data object
        var last_buy = data.ticker.buy.value;
        var last_sell = data.ticker.sell.value;

        console.log( new Date().getTime() + ' BUY -> ' + last_buy + ' | SELL -> ' + last_sell);

        // Update local buy and sell prices and check for fired active market orders
        if (last_buy != buy || last_sell != sell) {
          console.log('Updated local prices');
          buy = last_buy;
          sell = last_sell;
          processActiveOrders();
        }
      }
    });
}

// Serve control webpage
var server = http.createServer(app).listen(app.get('port'), function() {
  console.log('Express server listening on port ' + app.get('port'));
});

runApplication();