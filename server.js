// Copyright 2012 Iris Couch, all rights reserved.
//
// Server routines

var net = require('net')
var util = require('util')
var dgram = require('dgram')
var events = require('events')

var Message = require('./message')

module.exports = createServer

function createServer(handler) {
  return new Server(handler)
}


util.inherits(Server, events.EventEmitter)
function Server (handler) {
  var self = this
  events.EventEmitter.call(self)

  self.log = console

  if(handler)
    self.on('request', handler)

  self.udp = dgram.createSocket('udp4')
  self.tcp = net.createServer()

  self.udp.on('close', function() { self.close() })
  self.tcp.on('close', function() { self.close() })

  self.udp.on('error', function(er) { self.emit('error', er) })
  self.tcp.on('error', function(er) { self.emit('error', er) })

  self.tcp.on('connection', function(connection) { self.on_tcp_connection(connection) })
  self.udp.on('message', function(msg, rinfo) { self.on_udp(msg, rinfo) })

  var listening = {'tcp':false, 'udp':false}
  self.udp.once('listening', function() {
    listening.udp = true
    if(listening.tcp)
      self.emit('listening')
  })
  self.tcp.once('listening', function() {
    listening.tcp = true
    if(listening.udp)
      self.emit('listening')
  })
}

Server.prototype.listen = function(port, ip) {
  var self = this
  self.port = port
  self.ip   = ip || '0.0.0.0'

  self.udp.bind(port, ip)
  self.tcp.listen(port, ip)
}

Server.prototype.close = function() {
  var self = this

  if(self.udp._receiving)
    self.udp.close()

  if(self.tcp._handle)
    self.tcp.close(function() {
      self.emit('close')
    })
}

Server.prototype.on_tcp_connection = function(connection) {
  var self = this

  var length = null
    , bufs = []

  connection.on('data', function(data) {
    bufs.push(data)
    var bytes_received = bufs.reduce(function(state, buf) { return state + buf.length }, 0)

    if(length === null && bytes_received >= 2) {
      var so_far = Buffer.concat(bufs) // Flatten them all together, it's probably not much data.
      length = so_far.readUInt16BE(0)
      bufs = [ so_far.slice(2) ]
    }

    if(length !== null && bytes_received == 2 + length) {
      // All of the data (plus the 2-byte length prefix) is received.
      var data = Buffer.concat(bufs)
        , req = new Message(data)
        , res = new Response(data, {'socket':connection, 'type':'tcp'})

      self.emit('request', req, res)
    }
  })
}

Server.prototype.on_udp = function(data, rinfo) {
  var self = this

  rinfo.socket = this.udp
  rinfo.type = 'udp'

  var req = new Message(data)
    , res = new Response(data, rinfo)

  self.emit('request', req, res)
}


util.inherits(Response, Message)
function Response (data, peer) {
  var self = this
  Message.call(self, data)

  self.question   = self.question   || []
  self.answer     = self.answer     || []
  self.authority  = self.authority  || []
  self.additional = self.additional || []

  // Instead of `self.peer = peer` use this to keep it out of the enumeration.
  Object.defineProperty(self, 'peer', {'value':peer, 'enumerable':false, 'writable':true, 'configurable':true })
}

Response.prototype.end = function() {
  var self = this
  var data = require('fs').readFileSync(__dirname+'/test_data/oreilly.com-response')

  if(self.peer.type == 'udp' && data.length > 512)
    return self.emit('error', 'UDP responses greater than 512 bytes not yet implemented')

  else if(self.peer.type == 'udp')
    self.peer.socket.send(data, 0, data.length, self.peer.port, self.peer.address, function(er) {
      if(er)
        self.emit('error', er)
    })

  else if(self.peer.type == 'tcp') {
    // Add the data length prefix.
    var length = data.length
    data = Buffer.concat([ new Buffer([length >> 8, length & 255]), data ])

    self.peer.socket.end(data, function(er) {
      if(er)
        self.emit('error', er)
    })
  }

  else
    self.emit('error', new Error('Unknown peer type: ' + self.peer.type))
}