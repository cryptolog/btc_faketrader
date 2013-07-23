var async = require('async')
  , _     = require('underscore');

var ctx = {};
ctx.settings = require('./settings');
async.series([setupDB, setupServer, setupMtGoxSocket, setupLogic, listen], ready);

function setupDB(callback) {
  ctx.db = require('./db');
  ctx.db.init(ctx, callback);
}

function setupServer(callback) {
  var express = require('express')
    , path    = require('path')
    , orders  = require('./routes/orders')
    , user    = require('./routes/user');

  var app = express();

  // Express settings
  app.set('port', ctx.settings.http.port);
  app.use(express.favicon());
  app.use(express.compress());
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.static(path.join(__dirname, 'public')));
  app.disable('x-powered-by');

  // Express routes
  app.get('/orders', orders.getAllOrders);
  app.post('/orders', orders.addOrder);
  app.get('/user', user.getBalance);
  app.post('/user', user.setBalance);


  ctx.app = app;
  console.log('setupServer: OK');
  callback(null);
}

function setupMtGoxSocket(callback) {
  var io = require('socket.io-client');

  var MTGOX_BTCEUR_CHANNELS = {
    trade: 'dbf1dee9-4f2e-4a08-8cb7-748919a71b21',
    depth: '057bdc6b-9f9c-44e4-bc1a-363e4443ce87',
    ticker: '0bb6da8b-f6c6-4ecf-8f0d-a544ad948c15'
  }

  var mtgox_socket = io.connect('https://socketio.mtgox.com/mtgox?Currency=EUR');
  mtgox_socket.emit('message', { op: 'unsubscribe', channel: MTGOX_BTCEUR_CHANNELS.trade });
  mtgox_socket.emit('message', { op: 'unsubscribe', channel: MTGOX_BTCEUR_CHANNELS.depth });

  ctx.mtgox_socket = mtgox_socket;
  console.log('setupMtGoxSocket: OK');
  callback(null);
}

function setupLocalSocket(callback) {
  var io = require('socket.io');

  io.
  console.log('setupLocalSocket: OK');
  callback(null);
}

function setupLogic(callback) {
  ctx.logic = {};
  ctx.logic.buy = null;
  ctx.logic.sell = null;

  ctx.db.findAll('orders', function(err, allOrders) {
    if (err) {
      callback(err);
    } else {
      ctx.logic.active_orders = _.select(allOrders, function(elem) {
        return elem.fired_date === null;
      });
      ctx.db.findAll('user', function(err, result) {
        if (err)
            callback(err);
        if (result.length === 0) {
          ctx.db.insert('user', { eur: 0, btc: 0 }, function(err, result) {
            if (err === null) {
              ctx.logic.eur = parseFloat(0);
              ctx.logic.btc = parseFloat(0);
              console.log('setupLogic: OK');
            }
            callback(err);
          });
        } else {
          ctx.logic.eur = parseFloat(result[0].eur);
          ctx.logic.btc = parseFloat(result[0].btc);
          console.log('setupLogic: OK');
          callback(null);
        }
      });
    }
  });

  ctx.mtgox_socket.on('message', function(data) {
    if (data.channel_name == 'ticker.BTCEUR') {
      var last_buy = parseFloat(data.ticker.buy.value);
      var last_sell = parseFloat(data.ticker.sell.value);

      console.log( new Date() + ' BUY -> ' + last_buy + ' | SELL -> ' + last_sell);

      if (true /*last_buy != ctx.logic.buy || last_sell != ctx.logic.sell*/) {
        ctx.logic.buy = last_buy;
        ctx.logic.sell = last_sell;
        ctx.db.findAll('orders', function(err, allOrders) {
          if (err) {
            throw err;
          } else {
            ctx.logic.active_orders = _.select(allOrders, function(elem) {
              return elem.fired_date === null;
            });
            ctx.db.findAll('user', function(err, userData) {
              if (err)
                throw err;
              var dbEur = parseFloat(userData[0].eur);
              var dbBtc = parseFloat(userData[0].btc);
              ctx.logic.eur = (dbEur != ctx.logic.eur)? dbEur : ctx.logic.eur;
              ctx.logic.btc = (dbBtc != ctx.logic.btc)? dbBtc : ctx.logic.btc;
              processActiveOrders();
            });
          }
        });
      }
    }
  });

  function processActiveOrders() {
    console.log('ProcessActiveOrders()');
    console.log('BUY: ' + ctx.logic.buy);
    console.log('SELL: ' + ctx.logic.sell);
    console.log('EUR: ' + ctx.logic.eur);
    console.log('BTC: ' + ctx.logic.btc);
    var updated = false;
    for (var i = 0; i < ctx.logic.active_orders.length; ++i) {
      var o = ctx.logic.active_orders[i];
      o.amount = parseFloat(o.amount);
      o.price = parseFloat(o.price);
      console.log('Ordre ' + i + ': ' + JSON.stringify(o));
      if (o.type === 'BUY' && o.price >= ctx.logic.sell) {
        console.log(' Es compleix la condicio');
        if (ctx.logic.sell*o.amount <= ctx.logic.eur) {
          console.log('   Es pot executar');
          updated = true;
          // 1. Omplir el camp fired_date amb linstant actual en memoria
          o.fired_date = new Date();
          // 2. Si es una ordre BUY:  EUR -= ctx.logic.sell*order.amount; BTC += order.amount;
          ctx.logic.eur -= ctx.logic.sell*o.amount;
          ctx.logic.btc += o.amount;
          console.log('post actualitzacio: ' + ctx.logic.eur + ' ' + ctx.logic.btc);
          // 3. Actualitzar document a la BD
          ctx.db.update('orders', o, function(err, result) {
            if (err || result != 1)
              throw err;
            // 4. Notificar clients: Passarlis la ID de la ordre que ha saltat, amb socket.io probablement
            ctx.io.sockets.emit('fired_order', { order: o, balance: { eur: ctx.logic.eur, btc: ctx.logic.btc } });
          });
        }
      }
      if (o.type === 'SELL' && o.price <= ctx.logic.buy) {
        console.log(' Es compleix la condicio');
        if (o.amount <= ctx.logic.btc) {
          console.log('   Es pot executar');
          updated = true;
          // 1. Omplir el camp fired_date amb linstant actual en memoria
          o.fired_date = new Date();
          // 2. Si es una ordre SELL: EUR += ctx.logic.buy*order.amount; BTC -= order.amount;
          ctx.logic.eur += ctx.logic.buy*o.amount;
          ctx.logic.btc -= o.amount;
          // 3. Actualitzar document a la BD
          ctx.db.update('orders', o, function(err, result) {
            if (err || result != 1)
              throw err;
            // 4. Notificar clients: Passarlis la ID de la ordre que ha saltat, amb socket.io probablement
            ctx.io.sockets.emit('fired_order', { order: o, balance: { eur: ctx.logic.eur, btc: ctx.logic.btc } });
          });
        }
      }
    }
    if (updated) {
      ctx.db.findAll('user', function(err, user) {
        if (err)
          throw err;
        user[0].eur = ctx.logic.eur;
        user[0].btc = ctx.logic.btc;
        ctx.db.update('user', user[0], function(err, result) {
          if (err || result != 1)
            throw err;
        });
      });
    }
  }
}

function listen(callback) {
  var http = require('http')
    , io   = require('socket.io');

  var server = http.createServer(ctx.app);
  var io = io.listen(server);
  io.set('log level', 1);
  ctx.io = io;
  ctx.io.sockets.on('connection', function(socket) {
    console.log('Connected new client: ' + socket.id);
  });
  server.listen(ctx.app.get('port'), function() {
    console.log('listen: OK (port ' + ctx.app.get('port') + ')');
    callback(null);
  });
}

function ready(err) {
  if (err)
    throw err;
  console.log('BTC Faketrader ready to kick ass!');
}