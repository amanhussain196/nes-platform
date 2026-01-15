const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket'], // Force WebSocket only
    perMessageDeflate: false, // Disable compression for lower latency on small packets
    httpCompression: false
});

// Serve frontend files
app.use(express.static('public'));

// Endpoint to list ROMs
app.get('/api/roms', (req, res) => {
    const romsDir = path.join(__dirname, 'public/roms');

    // Create dir if not exists
    if (!fs.existsSync(romsDir)) {
        fs.mkdirSync(romsDir, { recursive: true });
    }

    fs.readdir(romsDir, (err, files) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Unable to scan files' });
        }
        // Filter for .nes files
        const roms = files.filter(file => file.toLowerCase().endsWith('.nes')).map(file => {
            return {
                filename: file,
                name: file.replace('.nes', '').replace(/_/g, ' ')
            };
        });
        res.json(roms);
    });
});

// Helper to get local IP
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Generate QR Code for session
app.get('/api/qr/:code', async (req, res) => {
    const port = process.env.PORT || 3000;
    let baseUrl;

    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        baseUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    } else {
        const localIp = getLocalIp();
        baseUrl = `http://${localIp}:${port}`;
    }

    // Use local IP so the phone can actually connect on LAN
    const url = `${baseUrl}/controller.html?code=${req.params.code}`;

    try {
        const qr = await QRCode.toDataURL(url);
        res.json({ qr, url, manualUrl: url });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error generating QR' });
    }
});

io.on('connection', (socket) => {
    // console.log('A user connected');

    // Host (TV/Desktop) joins
    socket.on('join_host', () => {
        // Generate a simple 6-digit code
        const sessionCode = Math.floor(100000 + Math.random() * 900000).toString();

        socket.join(sessionCode);
        socket.data.isHost = true;
        socket.data.room = sessionCode;

        socket.emit('session_created', sessionCode);
        console.log(`Host created session: ${sessionCode}`);
    });

    // Controller (Phone) joins
    socket.on('join_controller', (code) => {
        const room = io.sockets.adapter.rooms.get(code);
        if (room) {
            // Find which slots are taken.
            // We iterate through sockets in the room and check their assigned data.player
            const clients = Array.from(room);
            let p1Taken = false;
            let p2Taken = false;

            clients.forEach(clientId => {
                const s = io.sockets.sockets.get(clientId);
                if (s && s.data.player === 1) p1Taken = true;
                if (s && s.data.player === 2) p2Taken = true;
            });

            let assignedPlayer = null;
            if (!p1Taken) assignedPlayer = 1;
            else if (!p2Taken) assignedPlayer = 2;

            if (assignedPlayer) {
                socket.join(code);
                socket.data.room = code;
                socket.data.player = assignedPlayer;
                socket.data.isController = true;

                socket.emit('controller_connected', { success: true, player: assignedPlayer });
                io.to(code).emit('player_joined', { id: socket.id, player: assignedPlayer }); // Notify host

                console.log(`Controller joined session: ${code} as Player ${assignedPlayer}`);
            } else {
                // Room full
                socket.emit('controller_connected', { success: false, error: "Room full (2 players max)" });
            }
        } else {
            socket.emit('controller_connected', { success: false, error: "Session not found" });
        }
    });

    // Handle Input Events
    socket.on('input', (data) => {
        if (socket.data.room && socket.data.player) {
            // Forward to everyone in room (specifically the host)
            // Use volatile so we don't buffer old inputs if network is slow
            // socket.to(room) sends to host (and other player) but not back to sender
            // Include timestamp (ts) for latency measurement
            socket.to(socket.data.room).volatile.emit('input', {
                b: data.b,
                t: data.t,
                p: socket.data.player,
                ts: data.ts
            });
        }
    });

    // Handle Reset Game (P1 only)
    socket.on('reset_game', () => {
        if (socket.data.room && socket.data.player === 1) {
            io.to(socket.data.room).emit('reset_game');
            console.log(`Player 1 reset the game in room ${socket.data.room}`);
        }
    });

    socket.on('disconnect', () => {
        if (socket.data.isHost) {
            // If host disconnects, end session for controllers
            if (socket.data.room) {
                io.to(socket.data.room).emit('host_disconnected');
            }
        } else if (socket.data.isController) {
            console.log(`Player ${socket.data.player} disconnected from ${socket.data.room}`);
            io.to(socket.data.room).emit('player_left', socket.data.player);
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
