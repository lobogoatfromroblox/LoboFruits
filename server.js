const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Servir o jogo na rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Servir o jogo na rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Dados do servidor
const rooms = new Map();
const players = new Map();

// Função para gerar código de sala
function generateRoomCode() {
    return 'ROOM_' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Conexões Socket.IO
io.on('connection', (socket) => {
    console.log(`🎮 Jogador conectado: ${socket.id}`);
    
    // Registrar jogador
    socket.on('registerPlayer', (data) => {
        players.set(socket.id, {
            id: socket.id,
            username: data.username,
            level: data.level || 1,
            berries: data.berries || 50000,
            currentRoom: null,
            gameData: data.gameData || {}
        });
        
        console.log(`👤 Jogador registrado: ${data.username}`);
        socket.emit('playerRegistered', { success: true });
    });

    // Criar sala
    socket.on('createRoom', (data) => {
        const player = players.get(socket.id);
        if (!player) {
            socket.emit('error', { message: 'Jogador não registrado' });
            return;
        }

        const roomCode = generateRoomCode();
        const room = {
            code: roomCode,
            admin: socket.id,
            players: [socket.id],
            maxPlayers: data.maxPlayers || 4,
            gameState: 'waiting', // waiting, playing, finished
            createdAt: new Date(),
            settings: {
                pvpEnabled: data.pvpEnabled || false,
                sharedEnemies: data.sharedEnemies || true,
                syncBattles: data.syncBattles || true
            }
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        player.currentRoom = roomCode;

        console.log(`🏠 Sala criada: ${roomCode} por ${player.username}`);
        
        socket.emit('roomCreated', { 
            roomCode: roomCode,
            room: room,
            isAdmin: true
        });
    });

    // Entrar na sala
    socket.on('joinRoom', (data) => {
        const player = players.get(socket.id);
        const room = rooms.get(data.roomCode);

        if (!player) {
            socket.emit('error', { message: 'Jogador não registrado' });
            return;
        }

        if (!room) {
            socket.emit('error', { message: 'Sala não encontrada' });
            return;
        }

        if (room.players.length >= room.maxPlayers) {
            socket.emit('error', { message: 'Sala lotada' });
            return;
        }

        if (room.gameState === 'playing') {
            socket.emit('error', { message: 'Jogo já iniciado' });
            return;
        }

        // Adicionar jogador à sala
        room.players.push(socket.id);
        socket.join(data.roomCode);
        player.currentRoom = data.roomCode;

        console.log(`🚪 ${player.username} entrou na sala ${data.roomCode}`);

        // Notificar todos na sala
        socket.emit('joinedRoom', { 
            roomCode: data.roomCode,
            room: room,
            isAdmin: socket.id === room.admin
        });

        socket.to(data.roomCode).emit('playerJoined', {
            player: {
                id: socket.id,
                username: player.username,
                level: player.level
            },
            room: room
        });

        // Enviar lista de jogadores para o novo jogador
        const roomPlayers = room.players.map(playerId => {
            const p = players.get(playerId);
            return p ? {
                id: playerId,
                username: p.username,
                level: p.level,
                isAdmin: playerId === room.admin
            } : null;
        }).filter(p => p !== null);

        socket.emit('roomPlayers', { players: roomPlayers });
    });

    // Iniciar jogo (apenas admin)
    socket.on('startGame', (data) => {
        const player = players.get(socket.id);
        const room = rooms.get(data.roomCode);

        if (!room || room.admin !== socket.id) {
            socket.emit('error', { message: 'Apenas o admin pode iniciar o jogo' });
            return;
        }

        room.gameState = 'playing';
        
        console.log(`🎮 Jogo iniciado na sala ${data.roomCode}`);
        
        io.to(data.roomCode).emit('gameStarted', {
            room: room,
            message: 'Jogo iniciado! Boa sorte piratas!'
        });
    });

    // Sincronizar dados do jogo
    socket.on('syncGameData', (data) => {
        const player = players.get(socket.id);
        if (!player || !player.currentRoom) return;

        // Atualizar dados do jogador
        player.gameData = { ...player.gameData, ...data.gameData };

        // Enviar para outros jogadores na sala
        socket.to(player.currentRoom).emit('playerDataUpdate', {
            playerId: socket.id,
            username: player.username,
            gameData: data.gameData
        });
    });

    // Batalha compartilhada
    socket.on('battleStart', (data) => {
        const player = players.get(socket.id);
        if (!player || !player.currentRoom) return;

        socket.to(player.currentRoom).emit('playerBattleStart', {
            playerId: socket.id,
            username: player.username,
            enemy: data.enemy
        });
    });

    socket.on('battleAction', (data) => {
        const player = players.get(socket.id);
        if (!player || !player.currentRoom) return;

        socket.to(player.currentRoom).emit('playerBattleAction', {
            playerId: socket.id,
            username: player.username,
            action: data.action,
            damage: data.damage,
            result: data.result
        });
    });

    socket.on('battleEnd', (data) => {
        const player = players.get(socket.id);
        if (!player || !player.currentRoom) return;

        socket.to(player.currentRoom).emit('playerBattleEnd', {
            playerId: socket.id,
            username: player.username,
            victory: data.victory,
            rewards: data.rewards
        });
    });

    // Chat da sala
    socket.on('chatMessage', (data) => {
        const player = players.get(socket.id);
        if (!player || !player.currentRoom) return;

        const message = {
            playerId: socket.id,
            username: player.username,
            message: data.message,
            timestamp: new Date()
        };

        io.to(player.currentRoom).emit('chatMessage', message);
        console.log(`💬 [${player.currentRoom}] ${player.username}: ${data.message}`);
    });

    // Sair da sala
    socket.on('leaveRoom', () => {
        leaveCurrentRoom(socket);
    });

    // Desconexão
    socket.on('disconnect', () => {
        console.log(`👋 Jogador desconectado: ${socket.id}`);
        leaveCurrentRoom(socket);
        players.delete(socket.id);
    });

    // Função para sair da sala atual
    function leaveCurrentRoom(socket) {
        const player = players.get(socket.id);
        if (!player || !player.currentRoom) return;

        const room = rooms.get(player.currentRoom);
        if (!room) return;

        // Remover jogador da sala
        room.players = room.players.filter(id => id !== socket.id);
        socket.leave(player.currentRoom);

        // Se era o admin e ainda há jogadores, transferir admin
        if (room.admin === socket.id && room.players.length > 0) {
            room.admin = room.players[0];
            socket.to(player.currentRoom).emit('newAdmin', {
                newAdminId: room.admin,
                message: 'Novo administrador da sala!'
            });
        }

        // Se sala vazia, deletar
        if (room.players.length === 0) {
            rooms.delete(player.currentRoom);
            console.log(`🗑️ Sala ${player.currentRoom} deletada (vazia)`);
        } else {
            // Notificar outros jogadores
            socket.to(player.currentRoom).emit('playerLeft', {
                playerId: socket.id,
                username: player.username,
                room: room
            });
        }

        player.currentRoom = null;
    }
});

// Rota para listar salas ativas
app.get('/api/rooms', (req, res) => {
    const roomList = Array.from(rooms.values()).map(room => ({
        code: room.code,
        players: room.players.length,
        maxPlayers: room.maxPlayers,
        gameState: room.gameState,
        createdAt: room.createdAt
    }));
    
    res.json(roomList);
});

// Rota para estatísticas do servidor
app.get('/api/stats', (req, res) => {
    res.json({
        totalPlayers: players.size,
        activeRooms: rooms.size,
        uptime: process.uptime()
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 Servidor Blox Fruits rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
});