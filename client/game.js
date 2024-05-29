let selectedTile = null;

let tiles = [];
let currentPlayer = 0;
let playerCount = 2;

let turnLog = [];

const urlGameId = location.hash.substring(1);
let isLocalGame = true;

const socket = new WebSocket(`wss://hmi.dynu.net/quoridor`);
let playingAs = null;
const localBots = {};

class Tile {
  constructor(tileDiv, x, y) {
    this.tileDiv = tileDiv;
    this.x = x;
    this.y = y;
    this.pawn = null;
    this.walls = [false, false];
    this.wallDivs = [null, null];

    this.tileDiv.onclick = this.onClick.bind(this);
  }

  is(tile) {
    return tile.x === this.x && tile.y === this.y;
  }

  onClick(e) {
    if (e.shiftKey) {
      this.placeWall(Number(e.ctrlKey));
    } else {
      if (selectedTile === null) {
        if (this.pawn && !this.pawn.lifted && canPlayerPlay(this.pawn.player)) {
          selectedTile = this;
          this.pawn.lift();
        }
      } else {
        const { x, y } = this;
        if (this.is(selectedTile)) {
          selectedTile = null;
          this.pawn?.unlift();
        } else if (selectedTile.canMoveTo(x, y)) {
          if (selectedTile.pawn && canPlayerPlay(selectedTile.pawn.player)) {
            selectedTile.movePawn(x, y);
          }
        }
      }
    }
  }

  canMoveTo(x, y) {
    const verticalMove = Math.abs(y-this.y);
    if (verticalMove > 1) return false;
    const positiveMove = (verticalMove ? y-this.y : x-this.x) > 0;
    const blockingTiles = positiveMove ? [
      this,
      getTile(this.x - verticalMove, this.y - Number(!verticalMove)),
    ] : [
      getTile(this.x - Number(!verticalMove), this.y - verticalMove),
      getTile(this.x - 1, this.y - 1),
    ];
    return (
      getTile(x, y) !== null &&
      Math.abs(x-this.x) + Math.abs(y-this.y) === 1 &&
      blockingTiles.every((tile) => !tile || !tile.walls[Number(!verticalMove)])
    );
  }

  setPawn(pawn) {
    if (this.pawn === null && pawn) {
      this.pawn = pawn;
      this.tileDiv.appendChild(pawn.element);
    } else {
      throw 'This really shouldn\'t happen';
    }
  }

  clearPawn() {
    const pawn = this.pawn;
    this.pawn = null;
    if (pawn) this.tileDiv.removeChild(pawn.element);
    return pawn;
  }

  hasPawn() {
    return this.pawn !== null;
  }

  movePawn(x, y) {
    const pawn = this.clearPawn();
    if (pawn && canPlayerPlay(pawn.player) && this.canMoveTo(x, y)) {
      const target = getTile(x, y);
      if (target.hasPawn()) {
        if (target.canMoveTo(x + (x - this.x), y + (y - this.y))) {
          const newTarget = getTile(x + (x - this.x), y + (y - this.y));
          newTarget.setPawn(pawn);
          pawn.unlift();
          passTurn();
          return true;
        }
      } else {
        target.setPawn(pawn);
        pawn.unlift();
        passTurn();
        return true;
      }
    }
    this.setPawn(pawn);
    return false;
  }

  /**
   * 
   * @param {*} vertical number, either 0 or 1
   */
  addWall(vertical) {
    const head = getTile(this.x - Number(!vertical), this.y - vertical);
    const tail = getTile(this.x + Number(!vertical), this.y + vertical);
    if (
      !this.walls[vertical] &&
      !this.walls[Number(!vertical)] &&
      head && !head.walls[vertical] &&
      tail && !tail.walls[vertical]
    ) {
      this.walls[vertical] = true;
      const el = createElement('div', { classes: ['wall', vertical ? 'vertical' : 'horizontal'] });
      this.wallDivs[vertical] = el;
      this.tileDiv.appendChild(el);
      return true;
    }

    return false;
  }

  removeWall(vertical) {
    if (this.walls[vertical]) {
      this.tileDiv.removeChild(this.wallDivs[vertical]);
      this.wallDivs[vertical] = null;
      this.walls[vertical] = false;
    }
  }

  placeWall(vertical) {
    if (couldPlayerPlayLocally(currentPlayer)) {
      if (this.addWall(vertical)) passTurn();
    }
  }
}

class Pawn {
  constructor(player) {
    this.element = document.createElement('img');
    this.element.classList.add('pawn');
    this.element.src = `assets/pieces/redpawn.png`;
    this.lifted = false;
    this.player = player;
    this.element.style.filter = {
      0: 'brightness(1.35) saturate(0.85)',
      1: 'hue-rotate(40deg) brightness(2.5) saturate(0.6)',
      2: 'hue-rotate(40deg) brightness(5) saturate(0)',
      3: 'hue-rotate(40deg) brightness(1.35) saturate(0)',
    }[player] ?? '';
  }

  lift() {
    this.element.classList.add('lifted');
    this.lifted = true;
  }

  unlift() {
    this.element.classList.remove('lifted');
    this.lifted = false;
  }
}

function pushBoardState() {
  const state = tiles.map(row => (
    row.map(tile => [tile.pawn?.player ?? null, ...tile.walls])
  ));
  sendActions([['pushBoardState', [state, turnLog]]]);
}

function passTurn() {
  if (selectedTile) selectedTile.pawn?.unlift();
  selectedTile = null;
  if (!isLocalGame && currentPlayer === playingAs) pushBoardState();
  const nextPlayer = (currentPlayer + 1) % playerCount;
  if (couldPlayerPlayLocally(nextPlayer)) beginTurn(nextPlayer);
}

function beginTurn(nextPlayer) {
  if (currentPlayer === nextPlayer) return;
  currentPlayer = nextPlayer;
  document.getElementById('turn').innerText = `Player ${currentPlayer + 1} is taking their turn...`;
  if (canPlayerPlay(currentPlayer)) {
    if (localBots[currentPlayer]) {
      try {
        localBots[currentPlayer]();
      } catch (err) {
        console.error(err);
      }
    }
  }
}

function canPlayerPlay(player) {
  return player === currentPlayer && couldPlayerPlayLocally(currentPlayer);
}

function couldPlayerPlayLocally(player) {
  return isLocalGame || player === playingAs;
}

function applyBoardState(state, log) {
  console.log('APPLY STATE', state)
  turnLog = log;
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const [newState, ...walls] = state[i][j];
      const tile = tiles[i][j];
      tile.clearPawn();
      if (newState !== null) tile.setPawn(new Pawn(newState));
      for (let i = 0; i < 2; i++) {
        tile.removeWall(i);
        if (walls[i]) tile.addWall(i);
      }
    }
  }
}

async function onSocketMsg(data) {
  if (data.update) {
    for (const [update, args] of data.update) {
      console.log(update, args)
      switch (update) {
        case 'newGame':
          await joinNewGame(args[0]);
          break;
        case 'connected':
          playingAs = args[1];
          isLocalGame = false;
          document.getElementById('turn').innerText = `Waiting for players to connect...`;
          document.getElementById('user').innerText = `Connected as Player ${playingAs + 1}`;
          resetBoard(false);
          break;
        case 'beginGame':
          playerCount = args[0];
          currentPlayer = -1;
          resetBoard();
          break;
        case 'beginTurn':
          nextPlayer = args[0];
          beginTurn(nextPlayer);
          break;
        case 'boardState':
          applyBoardState(args[0], args[1]);
          break;
      }
    }
  }
  if (data.error) {
    for (const [error, args] of data.error) {
      console.log(error, args)
      switch (error) {
        case 'disconnectRequired':
          if (confirm('Must disconnect from game to complete action. OK to disconnect?')) {
            disconnectFromGame();
            sendActions([args]);
          }
          break;
        case 'connectRefused':
          await textDialog([
            ['p', 'An error occurred whilst connecting to this game - it may already be full, or no longer exists. Try creating a new one.']
          ]);
          location.href = `https://${location.host}${location.pathname}`;
          break;
      }
    }
  }
}

function sendActions(actions) {
  if (socket.readyState === socket.CLOSED || socket.readyState === socket.CLOSING) {
    textDialog([
      ['p', 'Failed to connect to the multiplayer server - reloading the page may fix this problem, but if it persists, please contact a site admin at contact@hmistudios.com.']
    ], 'Reload').then(() => location.reload());
  }
  else {
    socket.send(JSON.stringify({
      action: actions,
    }));
  }
}

function createElement(type, { classes, attributes, children }) {
  const el = document.createElement(type);
  if (classes) {
    for (const c of classes) {
      el.classList.add(c);
    }
  }
  if (attributes) {
    for (const attr in attributes) {
      el[attr] = attributes[attr];
    }
  }
  if (children) {
    for (const child of children) {
      el.appendChild(child);
    }
  }
  return el;
}

function textDialog(lines, okBtnText) {
  return new Promise((resolve, reject) => {
    const dialogShadow = document.getElementById('dialogShadow');
    const dialog = document.getElementById('dialog');

    dialog.innerHTML = '';
    dialog.appendChild(createElement('div', { children: [
      ...lines.map(([type, text]) => createElement(
        type,
        {
          attributes: { innerText: text },
        }
      )),
      createElement('div', { children: [
        createElement('button', { classes: ['btn'], attributes: {
          innerText: okBtnText ?? 'Ok',
          onclick: () => {
            dialogShadow.classList.add('hidden');
            resolve();
          },
        } }),
      ] }),
    ] }));
    
    dialogShadow.classList.remove('hidden');
  });
}

async function joinNewGame(gameID) {
  // const URL = `https://playkyo.com#${gameID}`;
  const redirectURL = `https://${location.host}${location.pathname}#${gameID}`;
  const URL = redirectURL;

  await new Promise((resolve, reject) => {
    const dialogShadow = document.getElementById('dialogShadow');
    const dialog = document.getElementById('dialog');

    dialog.innerHTML = '';
    dialog.appendChild(createElement('div', { children: [
      createElement('p', { attributes: {
        innerText: 'Send the link below to your opponent to let them join your game:',
      } }),
      createElement('blockquote', { attributes: {
        innerText: URL,
      } }),
      createElement('div', { children: [
        createElement('button', { classes: ['btn'], attributes: {
          innerText: 'Ok',
          onclick: () => {
            dialogShadow.classList.add('hidden');
            resolve();
          },
        } }),
      ] }),
    ] }));
    
    dialogShadow.classList.remove('hidden');
  });

  location.href = redirectURL;
  sendActions([['connect', [gameID]]]);
}

function newOnlineGame(playerCount) {
  sendActions([['newGame', [playerCount]]]);
  document.getElementById('connect').disabled = true;
  document.getElementById('connect4').disabled = true;
  document.getElementById('disconnect').disabled = false;
}

function toAlphabet(i) {
  // really cheap and hacky...
  return 'ABCDEFGHIJ'[i];
}

function createLabel(i, pos) {
  const labelDiv = document.createElement('div');
  labelDiv.classList.add('boardTile');
  labelDiv.classList.add('boardLabel');
  labelDiv.classList.add(pos);
  const label = document.createElement('span');
  label.innerText = (pos === 'top' || pos === 'bottom') ? toAlphabet(i) : i;
  labelDiv.appendChild(label);
  return labelDiv;
}

function resetBoard(placePawns=true) {
  const board = document.getElementById('board');
  board.innerHTML = '';

  tiles = [];
  turnLog = [];

  for (let i = 0; i < 9; i++) {
    const row = document.createElement('div');
    row.classList.add('boardRow');
    tiles.push([]);
    for (let j = 0; j < 9; j++) {
      const tileDiv = document.createElement('div');
      tileDiv.classList.add('boardTile');
      tileDiv.classList.add('tile');
      tiles[i].push(new Tile(tileDiv, j, i));
      if (i === 0) {
        tileDiv.append(createLabel(j, 'top'));
      }
      else if (i === 8) {
        tileDiv.append(createLabel(j, 'bottom'));
      }
      row.append(tileDiv);
    }
    row.append(createLabel(i + 1, 'right'));
    row.append(createLabel(i + 1, 'left'));
    board.append(row);
  }

  if (!placePawns) return;

  getTile(4, 0).setPawn(new Pawn(0));
  getTile(4, 8).setPawn(new Pawn(1));
}

function getTile(x, y) {
  const row = tiles[y];
  if (row) return row[x] ?? null;
  else return null;
}

socket.onopen = () => {
  if (urlGameId) {
    sendActions([['connect', [urlGameId]]]);
    document.getElementById('connect').disabled = true;
    document.getElementById('connect4').disabled = true;
    document.getElementById('disconnect').disabled = false;
  }
}

socket.onmessage = (event) => {
  let data;
  try {
    data = JSON.parse(event.data);
  } catch (err) {
    console.error('Bad JSON recieved from server');
    return;
  }
  onSocketMsg(data);
}