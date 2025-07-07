const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const Message = require('./models/Message');
const Channel = require('./models/Channel');
const User = require('./models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI).then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Auth routes placeholder
app.use('/api', require('./routes/auth'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/users', require('./routes/users'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/profile', require('./routes/profile'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token provided'));
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = decoded;
    next();
  });
});

const onlineUsers = new Set();
const userSockets = {};

io.on('connection', (socket) => {
  userSockets[socket.user.userId] = socket.id;
  console.log('User connected:', socket.user.userId, 'Socket ID:', socket.id);
  onlineUsers.add(socket.user.userId);
  io.emit('userStatus', { userId: socket.user.userId, status: 'online' });
  // Send the list of currently online users to the newly connected user
  socket.emit('currentOnline', { userIds: Array.from(onlineUsers) });
  // Join a room (channel or DM)
  socket.on('joinRoom', ({ roomId }) => {
    socket.join(roomId);
  });

  // Handle sending a message
  socket.on('chatMessage', async (data) => {
    try {
      let messageDoc;
      if (data.type === 'channel') {
        messageDoc = new Message({
          sender: socket.user.userId,
          content: data.content,
          type: 'channel',
          channel: data.roomId,
          messageType: data.messageType || 'text',
          imageUrl: data.imageUrl,
        });
      } else if (data.type === 'direct') {
        messageDoc = new Message({
          sender: socket.user.userId,
          content: data.content,
          type: 'direct',
          recipient: data.recipient,
          messageType: data.messageType || 'text',
          imageUrl: data.imageUrl,
        });
      }
      await messageDoc.save();
      await messageDoc.populate('sender', 'username email displayName profilePicture status about');
      io.to(data.roomId).emit('messageReceived', messageDoc);
      if (data.type === 'direct' && data.recipient) {
        const recipientSocketId = userSockets[data.recipient];
        if (recipientSocketId) {
          // Check if recipient's socket is already in the room
          const socketsInRoom = await io.in(data.roomId).allSockets();
          if (!socketsInRoom.has(recipientSocketId)) {
            io.to(recipientSocketId).emit('messageReceived', messageDoc);
          }
        }
      }
    } catch (err) {
      console.error('Error handling chatMessage:', err);
    }
  });

  // Typing indicator
  socket.on('typing', ({ roomId, sender }) => {
    // Broadcast to everyone else in the room
    socket.to(roomId).emit('typing', { sender, roomId });
  });

  // Stop typing indicator
  socket.on('stopTyping', ({ roomId, sender }) => {
    // Broadcast to everyone else in the room
    socket.to(roomId).emit('stopTyping', { sender, roomId });
  });

  // Handle message editing
  socket.on('editMessage', async (data) => {
    try {
      const { messageId, content, roomId } = data;
      
      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      // Validate that only the sender can edit their message
      if (message.sender.toString() !== socket.user.userId) {
        socket.emit('error', { message: 'You can only edit your own messages' });
        return;
      }

      // Update the message
      message.content = content;
      message.isEdited = true;
      message.editedAt = new Date();
      await message.save();

      // Populate sender data
      await message.populate('sender', 'username email displayName profilePicture status about');

      // Broadcast the edited message to the room
      io.to(roomId).emit('messageEdited', message);
    } catch (err) {
      console.error('Error handling editMessage:', err);
      socket.emit('error', { message: 'Failed to edit message' });
    }
  });

  // Handle message deletion
  socket.on('deleteMessage', async (data) => {
    try {
      const { messageId, roomId } = data;
      
      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      // Validate that only the sender can delete their message
      if (message.sender.toString() !== socket.user.userId) {
        socket.emit('error', { message: 'You can only delete your own messages' });
        return;
      }

      // Soft delete the message
      message.isDeleted = true;
      await message.save();

      // Populate sender data
      await message.populate('sender', 'username email displayName profilePicture status about');

      // Broadcast the deleted message to the room
      io.to(roomId).emit('messageDeleted', message);
    } catch (err) {
      console.error('Error handling deleteMessage:', err);
      socket.emit('error', { message: 'Failed to delete message' });
    }
  });

  // --- WebRTC Signaling Events ---
  // callUser: Initiate a call
  socket.on('callUser', (data) => {
    const { to, from, type, roomId } = data;
    const recipientSocketId = userSockets[to];
    console.log(`[SIGNAL] callUser from ${socket.user.userId} to ${to} (socket: ${recipientSocketId})`);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('callUser', {
        from: socket.user.userId, // always send just the userId string
        type,
        roomId,
      });
    } else {
      socket.emit('error', { message: 'User is offline or not connected.' });
    }
  });

  // callAccepted: Callee accepted the call
  socket.on('callAccepted', (data) => {
    const { to, roomId, type } = data;
    const recipientSocketId = userSockets[to];
    console.log(`[SIGNAL] callAccepted from ${socket.user.userId} to ${to} (socket: ${recipientSocketId})`);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('callAccepted', {
        from: socket.user.userId,
        roomId,
        type,
      });
    }
  });

  // callRejected: Callee rejected the call
  socket.on('callRejected', (data) => {
    const { to, roomId, type } = data;
    const recipientSocketId = userSockets[to];
    console.log(`[SIGNAL] callRejected from ${socket.user.userId} to ${to} (socket: ${recipientSocketId})`);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('callRejected', {
        from: socket.user.userId,
        roomId,
        type,
      });
    }
  });

  // webrtcOffer: Send SDP offer
  socket.on('webrtcOffer', (data) => {
    const { to, offer, roomId } = data;
    const recipientSocketId = userSockets[to];
    console.log(`[SIGNAL] webrtcOffer from ${socket.user.userId} to ${to} (socket: ${recipientSocketId})`);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('webrtcOffer', {
        from: socket.user.userId,
        offer,
        roomId,
        type: data.type,
      });
    }
  });

  // webrtcAnswer: Send SDP answer
  socket.on('webrtcAnswer', (data) => {
    const { to, answer, roomId } = data;
    const recipientSocketId = userSockets[to];
    console.log(`[SIGNAL] webrtcAnswer from ${socket.user.userId} to ${to} (socket: ${recipientSocketId})`);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('webrtcAnswer', {
        from: socket.user.userId,
        answer,
        roomId,
      });
    }
  });

  // iceCandidate: Send ICE candidate
  socket.on('iceCandidate', (data) => {
    const { to, candidate, roomId } = data;
    const recipientSocketId = userSockets[to];
    console.log(`[SIGNAL] iceCandidate from ${socket.user.userId} to ${to} (socket: ${recipientSocketId})`);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('iceCandidate', {
        from: socket.user.userId,
        candidate,
        roomId,
      });
    }
  });

  // endCall: End the call
  socket.on('endCall', (data) => {
    const { to, roomId } = data;
    const recipientSocketId = userSockets[to];
    console.log(`[SIGNAL] endCall from ${socket.user.userId} to ${to} (socket: ${recipientSocketId})`);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('endCall', {
        from: socket.user.userId,
        roomId,
      });
    }
  });

  socket.on('disconnect', () => {
    delete userSockets[socket.user.userId];
    console.log('User disconnected:', socket.user.userId, 'Socket ID:', socket.id);
    console.log('Current userSockets:', userSockets);
    onlineUsers.delete(socket.user.userId);
    io.emit('userStatus', { userId: socket.user.userId, status: 'offline' });
    console.log(`Socket disconnected: ${socket.id}, user: ${socket.user.userId}`);
  });
});

// After channel creation or deletion, emit channelsUpdated
app.post('/api/channels', async (req, res, next) => {
  try {
    const channel = new Channel(req.body);
    await channel.save();
    io.emit('channelsUpdated');
    res.status(201).json(channel);
  } catch (err) {
    next(err);
  }
});
app.delete('/api/channels/:id', async (req, res, next) => {
  try {
    await Channel.findByIdAndDelete(req.params.id);
    io.emit('channelsUpdated');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
// After user creation, emit usersUpdated
app.post('/api/register', async (req, res, next) => {
  try {
    const user = new User(req.body);
    await user.save();
    io.emit('usersUpdated');
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 