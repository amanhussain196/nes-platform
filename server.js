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
    }
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
    const localIp = getLocalIp();
    const port = process.env.PORT || 3000;
    // Use local IP so the phone can actually connect on LAN
    const url = `http://${localIp}:${port}/controller.html?code=${req.params.code}`;

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
        // We might want to check if the room actually has a host, but for now existence is enough
        if (room) {
            socket.join(code);
            socket.data.room = code;

            socket.emit('controller_connected', true);
            io.to(code).emit('player_joined', socket.id); // Notify host

            console.log(`Controller joined session: ${code}`);
        } else {
            socket.emit('controller_connected', false);
        }
    });

    // Handle Input Events
    socket.on('input', (data) => {
        // data examples: { button: 'A', type: 'down' } or { button: 'LEFT', type: 'up' }
        if (socket.data.room) {
            // Forward to everyone in room (specifically the host)
            socket.to(socket.data.room).emit('input', data);
        }
    });

    socket.on('disconnect', () => {
        if (socket.data.isHost) {
            // If host disconnects, end session for controllers
            if (socket.data.room) {
                io.to(socket.data.room).emit('host_disconnected');
            }
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
