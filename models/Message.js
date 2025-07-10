const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String }, // Not required for file/image messages
  type: { type: String, enum: ['channel', 'direct'], required: true },
  messageType: { type: String, enum: ['text', 'image', 'file'], default: 'text' },
  imageUrl: { type: String }, // For image messages
  channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }, // for channel messages
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // for direct messages
  isDeleted: { type: Boolean, default: false }, // Soft delete flag
  isEdited: { type: Boolean, default: false }, // Track if message was edited
  editedAt: { type: Date }, // When the message was last edited
  fileUrl: { type: String }, // For file messages
  fileName: { type: String },
  fileSize: { type: Number },
  fileType: { type: String },
  // Blue tick feature fields
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }], // Users who received the message
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }], // Users who read the message
  // Reactions: array of { emoji, user }
  reactions: [{
    emoji: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  }],
}, { timestamps: true });

module.exports = mongoose.model('Message', MessageSchema); 