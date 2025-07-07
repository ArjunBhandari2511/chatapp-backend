const express = require('express');
const jwt = require('jsonwebtoken');
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

// GET /api/channels - get all channels
router.get('/', authMiddleware, async (req, res) => {
  try {
    const channels = await Channel.find().populate('members', 'username email');
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/channels - create a new channel
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Channel name is required' });
    // Check if channel already exists
    const existing = await Channel.findOne({ name });
    if (existing) return res.status(400).json({ message: 'Channel already exists' });
    const channel = new Channel({
      name,
      creator: req.user.userId,
      members: [req.user.userId],
    });
    await channel.save();
    res.status(201).json({ channel });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/channels/:id - delete a channel (only by creator)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ message: 'Channel not found' });
    if (String(channel.creator) !== req.user.userId) {
      return res.status(403).json({ message: 'Only the creator can delete this channel' });
    }
    await channel.deleteOne();
    res.json({ message: 'Channel deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 