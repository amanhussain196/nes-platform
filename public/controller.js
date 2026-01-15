const socket = io({
    transports: ['websocket'],
    upgrade: false
});
const urlParams = new URLSearchParams(window.location.search);
let sessionCode = urlParams.get('code');

// UI
const loginScreen = document.getElementById('login-screen');
const controllerScreen = document.getElementById('controller-screen');
const sessionInput = document.getElementById('session-input');
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('error-msg');

// Button Elements
const buttons = document.querySelectorAll('.dpad-btn, .action-btn, .meta-btn');

// --- Connection Logic ---

if (sessionCode) {
    sessionInput.value = sessionCode;
    joinSession(sessionCode);
}

joinBtn.addEventListener('click', () => {
    const code = sessionInput.value;
    if (code.length === 6) {
        joinSession(code);
    } else {
        showError("Enter a valid 6-digit code");
    }
});

function joinSession(code) {
    socket.emit('join_controller', code);
}

socket.on('controller_connected', (data) => {
    // data can be boolean (legacy) or object { success, player, error }
    const success = typeof data === 'object' ? data.success : data;

    if (success) {
        loginScreen.classList.add('hidden');
        loginScreen.classList.remove('active');
        controllerScreen.classList.remove('hidden');
        controllerScreen.style.zIndex = 20; // Ensure on top

        // Update functionality based on player number
        const player = data.player || 1;
        document.querySelector('.logo').innerHTML = `PLAYER <span>${player}</span>`;

        // Show reset button only for Player 1
        if (player === 1) {
            document.getElementById('reset-btn').style.display = 'inline-block';
        }

        // Fullscreen request (optional, requires user interaction usually)
        if (document.documentElement.requestFullscreen) {
            // document.documentElement.requestFullscreen().catch(e => {});
        }
    } else {
        const error = data.error || "Invalid Session Code or Host not found.";
        showError(error);
    }
});

socket.on('host_disconnected', () => {
    location.reload();
});

function showError(msg) {
    errorMsg.innerText = msg;
    errorMsg.classList.remove('hidden');
}


// --- Input Processing ---

// Prevent context menu
document.body.addEventListener('contextmenu', e => e.preventDefault());

// Setup buttons
buttons.forEach(btn => {
    // Skip D-Pad buttons for individual listeners, we handle them via parent
    if (btn.classList.contains('dpad-btn')) return;

    // Touch Events
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault(); // Prevent scroll/zoom
        handleInput(btn.dataset.key, 'down');
        btn.classList.add('active'); // Visual feedback if needed
        vibrate(10);
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        handleInput(btn.dataset.key, 'up');
        btn.classList.remove('active');
    }, { passive: false });

    // Mouse Events (for testing on desktop)
    btn.addEventListener('mousedown', (e) => {
        handleInput(btn.dataset.key, 'down');
        vibrate(20);
    });
    btn.addEventListener('mouseup', (e) => {
        handleInput(btn.dataset.key, 'up');
    });
});

// Diagonal D-Pad Handling
const dpad = document.querySelector('.dpad');
const dpadBtns = {
    'UP': document.querySelector('.dpad-btn.up'),
    'DOWN': document.querySelector('.dpad-btn.down'),
    'LEFT': document.querySelector('.dpad-btn.left'),
    'RIGHT': document.querySelector('.dpad-btn.right')
};

let activeKeys = new Set();

dpad.addEventListener('touchstart', handleDpad, { passive: false });
dpad.addEventListener('touchmove', handleDpad, { passive: false });
dpad.addEventListener('touchend', (e) => {
    e.preventDefault();
    clearDpad();
});

function handleDpad(e) {
    if (e.cancelable) e.preventDefault();
    // Use targetTouches to only get touches that started on the D-pad
    // This prevents reading the coordinates of a finger holding an Action button elsewhere
    const touch = e.targetTouches[0];
    if (!touch) return;

    const rect = dpad.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const x = touch.clientX - centerX;
    const y = touch.clientY - centerY;

    // Calculate Angle
    let angle = Math.atan2(y, x) * (180 / Math.PI);
    if (angle < 0) angle += 360;

    // Determine functionality based on angle (8-way)
    // Right: 0, Down: 90, Left: 180, Up: 270

    // We want sectors of 45 degrees.
    // Right: 337.5 - 22.5
    // DownRight: 22.5 - 67.5
    // Down: 67.5 - 112.5
    // DownLeft: 112.5 - 157.5
    // Left: 157.5 - 202.5
    // UpLeft: 202.5 - 247.5
    // Up: 247.5 - 292.5
    // UpRight: 292.5 - 337.5

    const newKeys = new Set();

    if (angle >= 337.5 || angle < 22.5) { newKeys.add('RIGHT'); }
    else if (angle >= 22.5 && angle < 67.5) { newKeys.add('RIGHT'); newKeys.add('DOWN'); }
    else if (angle >= 67.5 && angle < 112.5) { newKeys.add('DOWN'); }
    else if (angle >= 112.5 && angle < 157.5) { newKeys.add('DOWN'); newKeys.add('LEFT'); }
    else if (angle >= 157.5 && angle < 202.5) { newKeys.add('LEFT'); }
    else if (angle >= 202.5 && angle < 247.5) { newKeys.add('LEFT'); newKeys.add('UP'); }
    else if (angle >= 247.5 && angle < 292.5) { newKeys.add('UP'); }
    else if (angle >= 292.5 && angle < 337.5) { newKeys.add('UP'); newKeys.add('RIGHT'); }

    updateDpadState(newKeys);
}

function clearDpad() {
    updateDpadState(new Set());
}

function updateDpadState(newKeys) {
    // Release keys not in new set
    activeKeys.forEach(key => {
        if (!newKeys.has(key)) {
            handleInput(key, 'up');
            if (dpadBtns[key]) dpadBtns[key].classList.remove('active');
        }
    });

    // Press keys in new set not in old set
    newKeys.forEach(key => {
        if (!activeKeys.has(key)) {
            handleInput(key, 'down');
            if (dpadBtns[key]) dpadBtns[key].classList.add('active');
            vibrate(10);
        }
    });

    activeKeys = newKeys;
}

function handleInput(key, type) {
    // Emit to server
    // Optimized payload: { b: 'A', t: 1/0 }
    const status = type === 'down' ? 1 : 0;
    // volatile emit from client side too? socket.io-client might not expose volatile easily on emit without library update, 
    // but just sending minimal data helps.
    socket.emit('input', { b: key, t: status, ts: Date.now() });
}

function vibrate(ms) {
    if (navigator.vibrate) {
        navigator.vibrate(ms);
    }
}

document.getElementById('disconnect-btn').addEventListener('click', () => {
    location.href = '/';
});

document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('Reset current game?')) {
        socket.emit('reset_game');
    }
});
