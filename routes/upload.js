const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check if file is an image
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Configure multer for generic files (5MB limit, allow common document types)
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Allow common document, image, video, and archive types
    const allowedTypes = [
      // Documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      // Archives
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/x-tar',
      'application/gzip',
      // Images
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/svg+xml',
      // Videos
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/x-ms-wmv',
      'video/mpeg',
      // Audio
      'audio/mpeg',
      'audio/wav',
      'audio/mp3',
      'audio/ogg',
      // Add more as needed
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.error('Unsupported file type attempted:', file.mimetype);
      cb(new Error('Unsupported file type: ' + file.mimetype), false);
    }
  },
});

// Upload image endpoint
router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    // Convert buffer to base64
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: 'chat-images',
      resource_type: 'image',
      transformation: [
        { width: 800, height: 600, crop: 'limit' }, // Resize large images
        { quality: 'auto' } // Optimize quality
      ]
    });

    res.json({
      success: true,
      imageUrl: result.secure_url,
      publicId: result.public_id,
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
});

// Upload generic file endpoint
router.post('/files/upload', (req, res, next) => {
  fileUpload.single('file')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      // Multer error (file too large, etc.)
      return res.status(400).json({ message: err.message });
    } else if (err) {
      // Custom error (unsupported type, etc.)
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file provided' });
    }
    // If image, use data URI; if not, use upload_stream
    if (req.file.mimetype.startsWith('image/')) {
      // Convert buffer to base64
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, {
        folder: 'chat-files',
        resource_type: 'image',
        use_filename: true,
        unique_filename: false,
        filename_override: req.file.originalname,
      });
      return res.json({
        success: true,
        fileUrl: result.secure_url,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileType: req.file.mimetype,
        publicId: result.public_id,
        message: 'File uploaded successfully',
      });
    } else {
      // For non-images, use upload_stream and buffer
      const stream = cloudinary.uploader.upload_stream({
        folder: 'chat-files',
        resource_type: 'raw',
        use_filename: true,
        unique_filename: false,
        filename_override: req.file.originalname,
      }, (error, result) => {
        if (error) {
          console.error('File upload error:', error);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload file',
            error: error.message,
          });
        }
        res.json({
          success: true,
          fileUrl: result.secure_url,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          fileType: req.file.mimetype,
          publicId: result.public_id,
          message: 'File uploaded successfully',
        });
      });
      stream.end(req.file.buffer);
    }
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: error.message,
    });
  }
});

module.exports = router; 