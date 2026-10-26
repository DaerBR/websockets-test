const connectButton = document.querySelector<HTMLButtonElement>('#connect')!;
const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send')!;
const sendBinaryButton = document.querySelector<HTMLButtonElement>('#send-binary')!;

const messageInput = document.querySelector<HTMLInputElement>('#message')!;
const binaryTypeSelect = document.querySelector<HTMLSelectElement>('#binary-type')!;

const bufferedContainer = document.querySelector<HTMLSpanElement>('#buffered')!;
const logContainer = document.querySelector<HTMLDivElement>('#log')!;

let ws: WebSocket | null = null;

function getLogTime() {
  const date = new Date();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  return `[${hours}:${minutes}:${seconds}.${milliseconds}]`;
}

const log = (text: string) => {
  const date = getLogTime();
  const paragraph = document.createElement('p');
  paragraph.textContent = `${date} - ${text}`;
  logContainer.appendChild(paragraph);
};

const stateName = (state: number): string => {
  switch (state) {
    case WebSocket.CONNECTING: {
      return 'CONNECTING';
    }
    case WebSocket.OPEN: {
      return 'OPEN';
    }
    case WebSocket.CLOSING: {
      return 'CLOSING';
    }
    case WebSocket.CLOSED: {
      return 'CLOSED';
    }
    default: {
      return 'UNKNOWN';
    }
  }
};

const setSendEnabled = (enabled: boolean): void => {
  sendButton.disabled = !enabled;
  sendBinaryButton.disabled = !enabled;
};

connectButton.addEventListener('click', () => {
  if (ws) {
    log(`socket already exists (${stateName(ws.readyState)})`);

    return;
  }

  const socket = new WebSocket('ws://localhost:8080');

  socket.binaryType = binaryTypeSelect.value as BinaryType;

  ws = socket;

  socket.addEventListener('open', () => {
    log(stateName(socket.readyState));
    setSendEnabled(true);
  });

  socket.addEventListener('message', async (event: MessageEvent<string | Blob | ArrayBuffer>) => {
    const data = event.data;

    if (typeof data === 'string') {
      log(`Received string: ${data}`);
    } else if (data instanceof Blob) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      log(`Received Blob: ${bytes}`);
    } else {
      log(`Received ArrayBuffer: ${new Uint8Array(data)}`);
    }
  });

  socket.addEventListener('error', () => {
    log('Error event');
  });

  socket.addEventListener('close', (event) => {
    log(`Closed: code ${event.code} - reason="${event.reason}". Was clean: ${event.wasClean ? 'yes' : 'no'}`);
    setSendEnabled(false);

    if (ws === socket) {
      ws = null;
    }
  });

  log(stateName(socket.readyState));
});

disconnectButton.addEventListener('click', () => {
  if (!ws) {
    return;
  }

  ws.close(1000, 'User clicked disconnect');
  setSendEnabled(false);
  log(stateName(ws.readyState));
});

sendButton.addEventListener('click', () => {
  if (ws?.readyState !== WebSocket.OPEN) {
    log(`Not sent: socket is ${ws ? stateName(ws.readyState) : 'missing'}`);

    return;
  }

  ws.send(messageInput.value);
  log(`Sent text ${messageInput.value}`);
});

sendBinaryButton.addEventListener('click', () => {
  if (ws?.readyState !== WebSocket.OPEN) {
    log(`Not sent: socket is ${ws ? stateName(ws.readyState) : 'missing'}`);

    return;
  }

  const binary = new Uint8Array([1, 2, 3, 255]);
  ws.send(binary);
  log(`Sent binary: ${binary}`);
});

binaryTypeSelect.addEventListener('change', () => {
  if (!ws) {
    return;
  }

  ws.binaryType = binaryTypeSelect.value as BinaryType;
  log(`Set binary type to ${ws.binaryType}`);
});

setInterval(() => {
  bufferedContainer.textContent = ` bufferedAmount: ${ws?.bufferedAmount ?? 0}`;
}, 100);
