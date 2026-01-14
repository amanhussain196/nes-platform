const socket = io();
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

socket.on('player_joined', (id) => {
    console.log('Player joined:', id);
    controllerDot.classList.add('connected');
    controllerText.innerText = "Player 1 Connected";

    // Notify user on dashboard too if still there
    const status = document.createElement('div');
    status.style.color = 'var(--secondary-color)';
    status.style.marginTop = '1rem';
    status.innerText = "Controller Connected!";
    document.querySelector('.connect-instruction').appendChild(status);
});

socket.on('host_disconnected', () => {
    alert('Disconnected from server. Refresh to restart.');
});

// --- Game Logic ---

function loadGames() {
    fetch('/api/roms')
        .then(res => res.json())
        .then(roms => {
            gameList.innerHTML = '';
            if (roms.length === 0) {
                document.getElementById('no-games-msg').classList.remove('hidden');
                return;
            }

            roms.forEach(rom => {
                const card = document.createElement('div');
                card.className = 'game-card';
                card.innerHTML = `
                    <span class="icon">🎮</span>
                    <div class="name">${rom.name}</div>
                `;
                card.onclick = () => startGame(rom.filename);
                gameList.appendChild(card);
            });
        });
}

function startGame(filename) {
    dashboardScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameScreen.classList.add('active'); // ensure active class for transitions

    // Fetch ROM
    fetch(`/roms/${filename}`)
        .then(res => res.arrayBuffer())
        .then(buffer => {
            currentRomData = new Uint8Array(buffer);
            initNES();
        })
        .catch(err => console.error("Error loading ROM:", err));
}

// --- NES Emulator Setup (JSNES) ---

function initNES() {
    // Audio Context
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Initialize JSNES
    nes = new jsnes.NES({
        onFrame: function (buffer) {
            // buffer is an array of pixels (32-bit integers)
            // We need to put this onto the canvas
            renderFrame(buffer);
        },
        onAudioSample: function (left, right) {
            // Simple audio connection (buffer queueing usually needed for high quality)
            // This is a placeholder for basic audio. JSNES usually needs a script processor.
            // For MVP we might skip complex audio sync, but let's try basic.
        },
        sampleRate: 44100
    });

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
        nes.loadROM(String.fromCharCode.apply(null, currentRomData)); // JSNES requires binary string
    } catch (e) {
        console.error("ROM Load Error", e); // Fallback: binary string conversion might fail on large files or specific encodings without newer TextDecoder
    }

    // Start Loop
    function onAnimationFrame() {
        if (!gameScreen.classList.contains('hidden')) {
            window.requestAnimationFrame(onAnimationFrame);
            nes.frame();
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

// Handle Socket Input
socket.on('input', (data) => {
    // data: { button: 'UP', type: 'down'/'up' }
    if (!nes) return;

    const button = KEYMAP[data.button];
    if (button === undefined) return;

    if (data.type === 'down') {
        nes.buttonDown(1, button); // Player 1
    } else {
        nes.buttonUp(1, button);
    }
});

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
