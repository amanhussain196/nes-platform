const socket = io({
    transports: ['websocket'],
    upgrade: false
});
let sessionCode = null;
let currentRomData = null;
let nes = null;
let audioCtx = null;
let scriptProcessor = null;

// UI Elements
const landingScreen = document.getElementById('landing-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const gameScreen = document.getElementById('game-screen');
const sessionCodeDisplay = document.getElementById('session-code-display');
const qrContainer = document.getElementById('qr-code-container');
const manualUrlSpan = document.getElementById('manual-url');
const textCodeSpan = document.getElementById('text-code');
const gameList = document.getElementById('game-list');
const controllerDot = document.getElementById('controller-dot');
const controllerText = document.getElementById('controller-status-text');
const wrapper = document.querySelector('.game-wrapper');

// --- Initialization ---

// Join as host immediately
socket.emit('join_host');

socket.on('session_created', (code) => {
    sessionCode = code;
    console.log('Session Created:', code);

    // Update UI
    landingScreen.classList.add('hidden');
    landingScreen.classList.remove('active');
    dashboardScreen.classList.remove('hidden');

    sessionCodeDisplay.innerText = code;
    textCodeSpan.innerText = code;

    // Fetch QR
    fetch(`/api/qr/${code}`)
        .then(res => res.json())
        .then(data => {
            const img = new Image();
            img.src = data.qr;
            qrContainer.innerHTML = '';
            qrContainer.appendChild(img);
            manualUrlSpan.innerText = new URL(data.manualUrl).host + "/controller.html";
        });

    // Load Games
    loadGames();
});

socket.on('player_joined', (data) => {
    // data: { id: '...', player: 1 or 2 }
    console.log(`Player ${data.player} joined:`, data.id);
    if (data.player === 1) playerParams.p1 = true;
    if (data.player === 2) playerParams.p2 = true;
    renderStatus();

    // Notify user on dashboard too if still there
    const status = document.createElement('div');
    status.style.color = 'var(--secondary-color)';
    status.style.marginTop = '1rem';
    status.innerText = `Player ${data.player} Connected!`;
    document.querySelector('.connect-instruction').appendChild(status);
});

socket.on('player_left', (playerNum) => {
    console.log(`Player ${playerNum} left`);
    if (playerNum === 1) playerParams.p1 = false;
    if (playerNum === 2) playerParams.p2 = false;
    renderStatus();
});

let playerParams = { p1: false, p2: false };

function renderStatus() {
    const text = [];
    if (playerParams.p1) text.push("P1");
    if (playerParams.p2) text.push("P2");

    if (text.length > 0) {
        controllerDot.classList.add('connected');
        controllerText.innerText = text.join(" & ") + " Connected";
    } else {
        controllerDot.classList.remove('connected');
        controllerText.innerText = "Waiting for controller...";
    }
}

// Handle Socket Input
socket.on('input', (data) => {
    // data: { b: 'UP', t: 1/0, p: 1 or 2, ts: <timestamp> }
    if (!nes) return;

    // Measurement
    if (data.ts) {
        const now = Date.now();
        const latency = now - data.ts;
        updatePingDisplay(latency);
    }

    const button = KEYMAP[data.b];
    if (button === undefined) return;

    // Default to player 1 if not specified
    const player = data.p || 1;

    // Check if in Menu or Game
    if (gameScreen.classList.contains('hidden')) {
        // We are on dashboard
        if (player === 1 && data.t === 1) { // Only P1, Input Down
            if (data.b === 'RIGHT') updateGameSelection(selectedGameIndex + 1);
            if (data.b === 'LEFT') updateGameSelection(selectedGameIndex - 1);
            if (data.b === 'DOWN') updateGameSelection(selectedGameIndex + 4); // Grid logic approx
            if (data.b === 'UP') updateGameSelection(selectedGameIndex - 4);

            if (data.b === 'START' || data.b === 'A') {
                if (gameListRoms[selectedGameIndex]) {
                    startGame(gameListRoms[selectedGameIndex].filename);
                }
            }
        }
    } else {
        // We are in Game
        if (data.t === 1) { // 1 = down
            nes.buttonDown(player, button);
        } else {
            nes.buttonUp(player, button);
        }
    }
});

let pingTimeout;
function updatePingDisplay(ms) {
    let el = document.getElementById('ping-display');
    if (!el) {
        el = document.createElement('div');
        el.id = 'ping-display';
        el.style.position = 'absolute';
        el.style.top = '10px';
        el.style.right = '10px';
        el.style.color = 'lime';
        el.style.fontFamily = 'monospace';
        el.style.background = 'rgba(0,0,0,0.5)';
        el.style.padding = '5px';
        document.body.appendChild(el);
    }
    el.innerText = `Ping: ${ms}ms`;

    // Color coding
    if (ms < 50) el.style.color = 'lime';
    else if (ms < 100) el.style.color = 'yellow';
    else el.style.color = 'red';
}

socket.on('reset_game', () => {
    if (nes) {
        nes.reset();
        console.log("Game Reset!");
    }
});

socket.on('host_disconnected', () => {
    alert('Disconnected from server. Refresh to restart.');
});

// --- Game Logic ---
let gameListRoms = [];
let selectedGameIndex = 0;

function loadGames() {
    fetch('/api/roms')
        .then(res => res.json())
        .then(roms => {
            gameListRoms = roms;
            gameList.innerHTML = '';
            if (roms.length === 0) {
                document.getElementById('no-games-msg').classList.remove('hidden');
                return;
            }

            roms.forEach((rom, index) => {
                const card = document.createElement('div');
                card.className = 'game-card';
                card.id = `game-card-${index}`;
                card.innerHTML = `
                    <span class="icon">🎮</span>
                    <div class="name">${rom.name}</div>
                `;
                card.onclick = () => startGame(rom.filename);
                gameList.appendChild(card);
            });

            // Navigate to first
            updateGameSelection(0);
        });
}

function updateGameSelection(index) {
    if (index < 0) index = gameListRoms.length - 1;
    if (index >= gameListRoms.length) index = 0;

    selectedGameIndex = index;

    // Update Visuals
    document.querySelectorAll('.game-card').forEach((el, i) => {
        if (i === selectedGameIndex) {
            el.classList.add('selected');
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            el.classList.remove('selected');
        }
    });
}


// Helper to safely convert buffer to binary string
function binaryStringFromBuffer(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return binary;
}

function startGame(filename) {
    dashboardScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameScreen.classList.add('active'); // ensure active class for transitions

    // Fetch ROM
    console.log(`Fetching ROM: ${filename}`);
    fetch(`/roms/${filename}`)
        .then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.arrayBuffer();
        })
        .then(buffer => {
            console.log(`ROM loaded, size: ${buffer.byteLength} bytes`);
            currentRomData = new Uint8Array(buffer);
            initNES();
        })
        .catch(err => {
            console.error("Error loading ROM:", err);
            alert(`Failed to load game: ${filename}`);
            // Return to dashboard
            gameScreen.classList.add('hidden');
            gameScreen.classList.remove('active');
            dashboardScreen.classList.remove('hidden');
        });
}

// --- NES Emulator Setup (JSNES) ---

function initNES() {
    // Audio Context
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Create a ScriptProcessorNode for audio output
    // Buffer size 4096 is a balance between latency and stability
    scriptProcessor = audioCtx.createScriptProcessor(4096, 0, 1);

    scriptProcessor.onaudioprocess = function (e) {
        const output = e.outputBuffer.getChannelData(0);
        // If we have less data than the buffer size, we just pad with 0 (or simple ring buffer logic)
        // For this simple implementation, we'll just play what we have or silence.
        // A real implementation needs a ring buffer. I will implement a minimal one.
        for (let i = 0; i < output.length; i++) {
            if (audioBuffer.length > 0) {
                output[i] = audioBuffer.shift();
            } else {
                output[i] = 0;
            }
        }
    };

    // Connect to destination (speakers)
    scriptProcessor.connect(audioCtx.destination);

    // Simple Audio Buffer
    const audioBuffer = [];
    const MAX_BUFFER_SIZE = 8192; // Prevent memory leak if not playing

    // Initialize JSNES
    nes = new jsnes.NES({
        onFrame: function (buffer) {
            renderFrame(buffer);
        },
        onAudioSample: function (left, right) {
            if (audioBuffer.length < MAX_BUFFER_SIZE) {
                audioBuffer.push(left); // Mono for now
            }
        },
        sampleRate: 44100
    });

    // Resume AudioContext on first interaction
    const resumeAudio = () => {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    };
    document.addEventListener('click', resumeAudio);
    document.addEventListener('keydown', resumeAudio);
    document.addEventListener('touchstart', resumeAudio);

    // Determine canvas context
    const canvas = document.getElementById('nes-canvas');
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(256, 240);

    // Frame buffer (32-bit)
    const buf32 = new Uint32Array(imageData.data.buffer);

    function renderFrame(buffer) {
        let i = 0;
        for (let y = 0; y < 240; ++y) {
            for (let x = 0; x < 256; ++x) {
                i = y * 256 + x;
                // JSNES returns 0xBBGGRR, we need 0xAABBGGRR (or close to it depending on endianness)
                // 32-bit write is faster
                buf32[i] = 0xFF000000 | buffer[i];
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // Load ROM
    try {
        const binaryString = binaryStringFromBuffer(currentRomData);
        nes.loadROM(binaryString); // JSNES requires binary string
    } catch (e) {
        console.error("ROM Load Error", e);
        alert("Emulator Error: " + e.message + "\n\nThis emulator supports standard Mappers: 0, 1, 2, 3, 4.\nYour ROM uses an unsupported mapper. Please try a standard version (e.g. 'Super Mario Bros (USA).nes').");
    }

    // Start Loop
    function onAnimationFrame() {
        if (!gameScreen.classList.contains('hidden')) {
            window.requestAnimationFrame(onAnimationFrame);
            try {
                nes.frame();
            } catch (e) {
                console.error("Emulator Runtime Error:", e);
                gameScreen.classList.add('hidden');
                gameScreen.classList.remove('active');
                dashboardScreen.classList.remove('hidden');
                alert("Emulator crashed during gameplay. The ROM might be incompatible.");
            }
        }
    }
    window.requestAnimationFrame(onAnimationFrame);

    // Setup Audio (Basic)
    // Audio is complex in JSNES without a ring buffer, we will skip high-fi audio for now to ensure stability
    // unless requested.
}


// --- Input Handling ---

const KEYMAP = {
    'UP': jsnes.Controller.BUTTON_UP,
    'DOWN': jsnes.Controller.BUTTON_DOWN,
    'LEFT': jsnes.Controller.BUTTON_LEFT,
    'RIGHT': jsnes.Controller.BUTTON_RIGHT,
    'A': jsnes.Controller.BUTTON_A,
    'B': jsnes.Controller.BUTTON_B,
    'START': jsnes.Controller.BUTTON_START,
    'SELECT': jsnes.Controller.BUTTON_SELECT
};



// Handle Keyboard Input (Fallback & TV Remote)
document.addEventListener('keydown', (e) => {
    if (!nes) return;
    handleKeyboard(e.key, true);
});

document.addEventListener('keyup', (e) => {
    if (!nes) return;
    handleKeyboard(e.key, false);
});

function handleKeyboard(key, isDown) {
    let button = null;

    switch (key) {
        // TV Remote / Numpad
        case '4': button = jsnes.Controller.BUTTON_LEFT; break;
        case '6': button = jsnes.Controller.BUTTON_RIGHT; break;
        case '8': button = jsnes.Controller.BUTTON_START; break; // Check requirements. User said 8=start?
        case '5': button = jsnes.Controller.BUTTON_A; break; // User said 5=A(Jump) (Usually A is jump in Mario)

        // Desktop Fallback
        case 'ArrowUp': button = jsnes.Controller.BUTTON_UP; break;
        case 'ArrowDown': button = jsnes.Controller.BUTTON_DOWN; break;
        case 'ArrowLeft': button = jsnes.Controller.BUTTON_LEFT; break;
        case 'ArrowRight': button = jsnes.Controller.BUTTON_RIGHT; break;
        case 'z': case 'Z': button = jsnes.Controller.BUTTON_A; break;
        case 'x': case 'X': button = jsnes.Controller.BUTTON_B; break;
        case 'Enter': button = jsnes.Controller.BUTTON_START; break;
        case 'Shift': button = jsnes.Controller.BUTTON_SELECT; break;
    }

    if (button !== null) {
        if (isDown) nes.buttonDown(1, button);
        else nes.buttonUp(1, button);
    }
}

document.getElementById('exit-game-btn').addEventListener('click', () => {
    gameScreen.classList.add('hidden');
    gameScreen.classList.remove('active');
    dashboardScreen.classList.remove('hidden');
    nes = null; // Basic cleanup
});
