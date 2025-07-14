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
app.use(cors("*"));
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
  // Register userId from JWT
  const userId = socket.user && socket.user.userId;
  if (userId) {
    userSockets[userId] = socket.id;
  }
  console.log('User connected:', userId, 'Socket ID:', socket.id);
  onlineUsers.add(userId);
  io.emit('userStatus', { userId: userId, status: 'online' });
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
      // Delivery logic for direct messages
      if (data.type === 'direct' && data.recipient) {
        const recipientSocketId = userSockets[data.recipient];
        if (recipientSocketId) {
          // Recipient is online, mark as delivered
          messageDoc.deliveredTo = [data.recipient];
        }
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

  // Handle sending a file message
  socket.on('fileMessage', async (data) => {
    try {
      let messageDoc;
      if (data.type === 'channel') {
        messageDoc = new Message({
          sender: socket.user.userId,
          type: 'channel',
          channel: data.chatId,
          messageType: 'file', // Always set
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType,
        });
      } else if (data.type === 'direct') {
        messageDoc = new Message({
          sender: socket.user.userId,
          type: 'direct',
          recipient: data.to,
          messageType: 'file', // Always set
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType,
        });
      }
      await messageDoc.save();
      await messageDoc.populate('sender', 'username email displayName profilePicture status about');
      io.to(data.chatId).emit('fileMessage', messageDoc);
      if (data.type === 'direct' && data.to) {
        const recipientSocketId = userSockets[data.to];
        if (recipientSocketId) {
          const socketsInRoom = await io.in(data.chatId).allSockets();
          if (!socketsInRoom.has(recipientSocketId)) {
            io.to(recipientSocketId).emit('fileMessage', messageDoc);
          }
        }
      }
    } catch (err) {
      console.error('Error handling fileMessage:', err);
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

  // Message read event for blue tick
  socket.on('messageRead', async ({ messageId, userId, roomId }) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) return;
      if (!message.readBy.includes(userId)) {
        message.readBy.push(userId);
        await message.save();
        await message.populate('sender', 'username email displayName profilePicture status about');
        io.to(roomId).emit('messageReadUpdate', { messageId, userId });
      }
    } catch (err) {
      console.error('Error handling messageRead:', err);
    }
  });

  // Handle message reactions
  socket.on('reactToMessage', async (data) => {
    try {
      const { messageId, emoji, roomId } = data;
      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }
      const userId = socket.user.userId;
      // Find previous reaction by this user
      const prevReaction = message.reactions.find(r => r.user.toString() === userId);
      // Remove any previous reaction by this user
      message.reactions = message.reactions.filter(r => r.user.toString() !== userId);
      // If the previous reaction is the same as the new emoji, do not add it back (toggle off)
      if (!prevReaction || prevReaction.emoji !== emoji) {
        message.reactions.push({ emoji, user: userId });
      }
      await message.save();
      await message.populate('sender', 'username email displayName profilePicture status about');
      await message.populate('reactions.user', 'username displayName profilePicture');
      io.to(roomId).emit('messageReaction', message);
    } catch (err) {
      console.error('Error handling reactToMessage:', err);
      socket.emit('error', { message: 'Failed to react to message' });
    }
  });

// --- Video/Audio Call Signaling ---

// User A requests a call with User B
socket.on('call:request', ({ to, from, roomId, callType }) => {
  const recipientSocketId = userSockets[to];
  if (recipientSocketId) {
    io.to(recipientSocketId).emit('call:incoming', { from, roomId, callType });
  }
});

// User B accepts the call
socket.on('call:accept', ({ to, from, roomId }) => {
  const callerSocketId = userSockets[to];
  if (callerSocketId) {
    io.to(callerSocketId).emit('call:accepted', { from, roomId });
  }
});

// User B rejects the call
socket.on('call:reject', ({ to, from, roomId }) => {
  const callerSocketId = userSockets[to];
  if (callerSocketId) {
    io.to(callerSocketId).emit('call:rejected', { from, roomId });
  }
});

// WebRTC signaling relay
socket.on('signal', ({ room, signal }) => {
  // Relay to all other sockets in the room
  socket.to(room).emit('signal', { signal });
});


  socket.on('disconnect', () => {
    if (userId && userSockets[userId] === socket.id) {
      delete userSockets[userId];
    }
    // Notify all rooms this socket was in
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        socket.to(room).emit('peer-left');
      }
    }
    console.log('User disconnected:', userId, 'Socket ID:', socket.id);
    console.log('Current userSockets:', userSockets);
    onlineUsers.delete(userId);
    io.emit('userStatus', { userId: userId, status: 'offline' });
    console.log(`Socket disconnected: ${socket.id}, user: ${userId}`);
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