import express from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';
import crypto from 'crypto';
import protect from '../middleware/auth.js';
import Image from '../models/Image.js';
import dotenv from 'dotenv';
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const makeOverlay = (text, gravity, x, y) => ({
  overlay: { font_family: 'Arial', font_size: 30, font_weight: 'bold', text },
  gravity, x, y,
  color: 'white',
  opacity: 40,
  angle: -35,
});

// POST /api/images/upload
router.post('/upload', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image provided' });
    const { title } = req.body;
    if (!title) return res.status(400).json({ message: 'Title is required' });

    const wm = `\u00A9 ${req.user.name}`;

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'mern-image-app',
          transformation: [
            makeOverlay(wm, 'north_west', 60, 60),
            makeOverlay(wm, 'north',       0, 60),
            makeOverlay(wm, 'north_east', 60, 60),
            makeOverlay(wm, 'west',       60,  0),
            makeOverlay(wm, 'center',      0,  0),
            makeOverlay(wm, 'east',       60,  0),
            makeOverlay(wm, 'south_west', 60, 60),
            makeOverlay(wm, 'south',       0, 60),
            makeOverlay(wm, 'south_east', 60, 60),
          ],
        },
        (err, result) => { if (err) reject(err); else resolve(result); }
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    const shareToken = crypto.randomBytes(16).toString('hex');

    const image = await Image.create({
      title,
      imageUrl: result.secure_url,
      cloudinaryId: result.public_id,
      uploadedBy: req.user._id,
      uploaderName: req.user.name,
      shareToken,
    });

    res.status(201).json(image);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

// GET /api/images/my — only current user's images
router.get('/my', protect, async (req, res) => {
  try {
    const images = await Image.find({ uploadedBy: req.user._id }).sort({ createdAt: -1 });
    res.json(images);
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/images/share/:token — public, no auth
router.get('/share/:token', async (req, res) => {
  try {
    const image = await Image.findOne({ shareToken: req.params.token });
    if (!image) return res.status(404).json({ message: 'Image not found' });
    res.json(image);
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/images/:id — only owner can delete
router.delete('/:id', protect, async (req, res) => {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) return res.status(404).json({ message: 'Image not found' });

    // Ensure only the owner can delete
    if (image.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this image' });
    }

    // Delete from Cloudinary
    await cloudinary.uploader.destroy(image.cloudinaryId);

    // Delete from DB
    await image.deleteOne();

    res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: 'Delete failed', error: err.message });
  }
});

export default router;