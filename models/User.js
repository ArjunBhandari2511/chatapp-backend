const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  // Profile customization fields
  profilePicture: { type: String }, // Cloudinary URL
  about: { type: String, default: '' }, // User bio/description
  status: { type: String, default: 'Hey there! I am using ChatSpark.' }, // User status
  displayName: { type: String }, // Optional display name (can be different from username)
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema); 