const crypto = require('crypto');

class Game {
  constructor(id, playerCount) {
    this.id = id;
    this.boardState = [];
    this.turnLog = [];
    this.players = [];
    this.currentPlayer = 0;
    this.playerCount = playerCount;
  }

  connectPlayer(player) {
    if (this.players.length < this.playerCount) {
      this.players.push(player);
      player.setConnData({ gameID: this.id });
      return [true, this.players.length - 1];
    }
    else {
      return [false, null];
    }
  }

  tryBeginGame() {
    if (this.players.length === this.playerCount) {
      this.sendToAll({ update: [['beginGame', [this.playerCount]]] });
      this.sendToAll({ update: [['beginTurn', [this.currentPlayer]]] });
    }
  }

  sendTo(playerID, data) {
    if (this.players[playerID]) this.players[playerID].send(data);
  }

  sendToAll(data) {
    for (let i = 0; i < this.playerCount; i++) {
      this.sendTo(i, data);
    } 
  }

  pushBoardState(player, state, log) {
    if (this.players.indexOf(player) === this.currentPlayer) {
      this.currentPlayer = (this.currentPlayer + 1) % this.playerCount;
      this.boardState = state;
      this.turnLog = log;
      this.sendToAll({ update: [['boardState', [this.boardState, this.turnLog]]] });
      this.sendToAll({ update: [['beginTurn', [this.currentPlayer]]] });
      this.checkWinConditions();
    }
  }

  checkWinConditions() {
    console.log('FIXME!')
  }

  win(playerID) {
    for (let i = 0; i < this.playerCount; i++) {
      if (i === playerID) this.sendTo(i, { update: [['gameWon', []]] });
      else this.sendTo(i, { update: [['gameLost', []]] });
    }
  }

  // forfeit(player) {
  //   this.sendToAll({ update: [['gameForfeit', []]] });
  //   this.win(this.players.indexOf(player));
  // }

  close() {
    for (const player of this.players) {
      player.connData.gameID = null;
    }
  }
}

class Player {
  constructor(connData) {
    this.connData = connData
    this.pingInterval = setInterval(this.ping.bind(this), 10_000)
  }

  ping() {
    const { ws } = this.connData
    if (ws) {
      ws.ping()
    }
  }

  close() {
    clearInterval(this.pingInterval);
    this.pingInterval = null;
  }

  setConnData(data) {
    this.connData = {
      ...this.connData,
      ...data,
    }
  }

  send(data) {
    this.connData.ws.send(JSON.stringify(data));
  }
}

class Manager {
  constructor() {
    this.connections = [];
    this.players = [];
    this.games = {};
  }

  getPlayer(ws) {
    const playerIndex = this.connections.indexOf(ws);
    return this.players[playerIndex];
  }

  setPlayerData(ws, data) {
    const playerIndex = this.connections.indexOf(ws);
    this.players[playerIndex].setConnData(data);
  }

  sendTo(ws, data) {
    ws.send(JSON.stringify(data));
  }

  connect(ws) {
    this.connections.push(ws);
    this.players.push(new Player({
      ws: ws,
      gameID: null,
    }));
  }

  disconnect(ws) {
    const playerIndex = this.connections.indexOf(ws);
    const player = this.players[playerIndex];

    if (player.connData.gameID) {
      this.handleActions(ws, [['disconnect']]);
    }

    player.close();
    delete this.connections[playerIndex];
    delete this.players[playerIndex];
  }

  connectToGame(player, gameID) {
    if (!(gameID in this.games)) return [false];
    return this.games[gameID].connectPlayer(player);
  }

  handleActions(ws, actions) {
    const player = this.getPlayer(ws);
    const { gameID } = player.connData;
    for (const [action, args] of actions) {
      // console.log(action, args, gameID)
      console.log(action, this.connections.indexOf(ws))
      switch (action) {
        case 'newGame':
          const newGameID = crypto.randomUUID();
          this.games[newGameID] = new Game(newGameID, args[0]);
          player.send({ update: [['newGame', [newGameID]]] });
          break;
        case 'connect':
          if (args[0] === gameID) break;
          const [success, playerID] = this.connectToGame(player, args[0]);
          if (success) {
            this.sendTo(ws, { update: [['connected', [args[0], playerID]]] });
            this.games[args[0]].tryBeginGame();
          }
          else player.send({ error: [['connectRefused', [args[0]]]] });
          break;
        case 'disconnect':
          if (gameID !== null && gameID in this.games) {
            // this.games[gameID].forfeit(player);
            this.games[gameID].close();
            delete this.games[gameID];
            player.send({ update: [['disconnected', []]] });
          }
          break;
        case 'pushBoardState':
          if (gameID in this.games) {
            this.games[gameID].pushBoardState(player, args[0], args[1])
          }
          break;
      }
    }
  }
}

module.exports = new Manager()