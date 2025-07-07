const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  type: { type: String, enum: ['channel', 'direct'], required: true },
  messageType: { type: String, enum: ['text', 'image'], default: 'text' },
  imageUrl: { type: String }, // For image messages
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }, // for channel messages
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // for direct messages
  isDeleted: { type: Boolean, default: false }, // Soft delete flag
  isEdited: { type: Boolean, default: false }, // Track if message was edited
  editedAt: { type: Date }, // When the message was last edited
}, { timestamps: true });

module.exports = mongoose.model('Message', MessageSchema); 