const fs = require('fs')
const WebSocket = require('websocket')

const { server: WebSocketServer } = WebSocket

let connection = {
    sendUTF: () => {}
}

let debugUI = fs.readFileSync(__dirname + '/index.html', 'utf8')

const debug = (server, options = {}) => {
    const { port, allowedOrigins = ['*'] } = options

    if (port) {
        debugUI = debugUI.replace('ws://localhost:3000', `ws://localhost:${port}`)
    }

    const wsServer = new WebSocketServer({
        httpServer: server,
        autoAcceptConnections: false
    })

    const originIsAllowed = (origin) => (
        allowedOrigins[0] === '*' || allowedOrigins.includes(origin)
            ? true
            : false
    )

    wsServer.on('request', (request) => {
        if (!originIsAllowed(request.origin)) {
            // Make sure we only accept requests from an allowed origin
            request.reject()
            console.log(new Date() + ' Connection from origin ' + request.origin + ' rejected.')
            return
        }

        connection = request.accept('echo-protocol', request.origin)

        connection.on('close', function () {
            console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.')
        })
    })

    return connection
}

Object.defineProperty(debug, 'connection', {
    get: () => connection
})

Object.defineProperty(debug, 'ui', {
    get: () => debugUI
})

module.exports = debug
