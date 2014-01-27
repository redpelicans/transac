// TODO: supprimer la queue


var util = require('util')
  , os = require('os')
  , request = require('request')
  , _ = require('underscore')
  , request = require('request')
  , async = require('async');


function execTask(task, cb){
  var transac = this;
  function callbackExecTask(err, data){
    if(err){
      pushEvent.bind(transac, 'abort')(err, null, function(){ cb(err) });
    }else{
      pushEvent.bind(transac, 'commit')(null, null, function(){ cb(null, data); });
    }
  }
  try{
    task(transac, callbackExecTask);
  }catch(err){
    pushEvent.bind(transac, 'error')(err, err.stack, function(){
      pushEvent.bind(transac, 'abort')(null, null, function(){
        cb(err);
      })
    })
  };
}

function exec(task, callback) {
  var transac = this
    , form = _.extend({name: transac.name}, transac.options);

  if(!callback) callback = function(err){ if(err) throw err }

  var requestOptions = {
    uri: this.serverUrl + '/transacs'
  , method: 'POST'
  , form: form
  , json: true
  };

  request(requestOptions, function(err, response, body) {
    if(err) return callback(err);
    switch(response.statusCode){
      case 418:
        switch (body.code) {
          case 'locked':
            return callback(new Error('Transaction ' + transac.name  + ' already exists and is locked'));
          default:
            return callback(new Error(body.toString()));
        }
      case 200:
        transac.id = body.id;
        return execTask.bind(transac)(task, callback);
      case 500: 
      default:
        var msg = 'Internal error, server responds code ' + response.statusCode;
        return callback(new Error(msg));
    }
  });
}

function publishEvent(event, callback) {
  var transac = this;
  var requestOptions = {
    uri: this.serverUrl + '/transacs/' + transac.id + '/events'
  , method: 'PUT'
  , json: true
  , form: {
      type: event.type
    , label: event.label || ''
    , message: event.message || ''
    }
  };

  request(requestOptions, function(err, response, body) {
    if(err) return callback(err);
    switch(response.statusCode){
      case 418:
        switch (body.code) {
          case 'notransac':
            return callback(new Error('Transaction ' + transac.id  + " doesn't exist"));
          case 'closed':
            return callback(new Error('Transaction ' + transac.name  + " is already closed"));
          default:
            return callback(body);
        }
      case 200:
        return callback(null, event);
      case 500: 
      default:
        var msg = 'Internal error, server responds code ' + response.statusCode;
        return callback(new Error(msg));
    }
  });
};

function pushEvent(type, label, message, cb){
  this.queue.push({type: type, label: label, message: message}, cb);
}

function Transac(name, serverUrl, options){
  this.name = name;
  this.serverUrl = serverUrl;
  this.options = _.extend(_.pick(options || {}, 'valueDate', 'nested', 'locked'), {processId: process.pid, user: process.env.USER, server: os.hostname()});
  this.exec = exec;
  this.info = pushEvent.bind(this, 'info');
  this.warning = pushEvent.bind(this, 'warning');
  this.error = pushEvent.bind(this, 'error');
  this.queue = async.queue(publishEvent.bind(this), 1);
};

module.exports = Transac;
module.exports.exec = function(name, serverUrl, task, options, cb){
  if(_.isFunction(options)){
    cb = options;
    options = {};
  }
  var t = new Transac(name, serverUrl, options);
  t.exec(task, cb);
  return t;
};