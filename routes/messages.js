const express = require('express');
const jwt = require('jsonwebtoken');
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const User = require('../models/User');

const router = express.Router();

// Middleware to verify JWT
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ message: 'No token provided' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Invalid token format' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: 'Invalid token' });
    req.user = decoded;
    next();
  });
}

// Send message to a channel
router.post('/channel/:channelId', authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ message: 'Message content required' });
    const channel = await Channel.findById(req.params.channelId);
    if (!channel) return res.status(404).json({ message: 'Channel not found' });
    const message = new Message({
      sender: req.user.userId,
      content,
      type: 'channel',
      channel: channel._id,
    });
    await message.save();
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all messages for a channel
router.get('/channel/:channelId', authMiddleware, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.channelId);
    if (!channel) return res.status(404).json({ message: 'Channel not found' });
    const messages = await Message.find({ channel: channel._id, type: 'channel', isDeleted: { $ne: true } })
      .populate('sender', 'username email displayName profilePicture status about')
      .sort({ createdAt: 1 });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Send direct message
router.post('/direct/:userId', authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ message: 'Message content required' });
    const recipient = await User.findById(req.params.userId);
    if (!recipient) return res.status(404).json({ message: 'Recipient not found' });
    const message = new Message({
      sender: req.user.userId,
      content,
      type: 'direct',
      recipient: recipient._id,
    });
    await message.save();
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all direct messages between current user and userId
router.get('/direct/:userId', authMiddleware, async (req, res) => {
  try {
    const otherUserId = req.params.userId;
    const userId = req.user.userId;
    const messages = await Message.find({
      type: 'direct',
      isDeleted: { $ne: true },
      $or: [
        { sender: userId, recipient: otherUserId },
        { sender: otherUserId, recipient: userId },
      ],
    })
      .populate('sender', 'username email displayName profilePicture status about')
      .sort({ createdAt: 1 });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Edit a message (PUT /api/messages/:messageId)
router.put('/:messageId', authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ message: 'Message content required' });

    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Validate that only the sender can edit their message
    if (message.sender.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'You can only edit your own messages' });
    }

    // Update the message
    message.content = content;
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    // Populate sender data before sending response
    await message.populate('sender', 'username email displayName profilePicture status about');

    res.json({ message });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a message (soft delete) (DELETE /api/messages/:messageId)
router.delete('/:messageId', authMiddleware, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Validate that only the sender can delete their message
    if (message.sender.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }

    // Soft delete the message
    message.isDeleted = true;
    await message.save();

    // Populate sender data before sending response
    await message.populate('sender', 'username email displayName profilePicture status about');

    res.json({ message });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add or remove a reaction to a message
router.post('/:messageId/reactions', authMiddleware, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ message: 'Emoji is required' });
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    const userId = req.user.userId;
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
    res.json({ message });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 