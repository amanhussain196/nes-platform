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
    btn.addEventListener('mouseleave', (e) => {
        // If mouse leaves button while pressed
        // handleInput(btn.dataset.key, 'up'); // Optional: can cause stuck keys if not careful, but prevents stuck input visually
    });
});

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
