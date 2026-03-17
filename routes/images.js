import express from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';
import crypto from 'crypto';
import protect from '../middleware/auth.js';
import Image from '../models/Image.js';
import dotenv from 'dotenv';
import { Readable } from 'stream';
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

const uploadBuffer = (buffer, options) => (
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (err, result) => { if (err) reject(err); else resolve(result); }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  })
);

const sanitizeFilenameBase = (value) => {
  const base = String(value || 'image')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  return base || 'image';
};

const extFromContentType = (contentType) => {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('image/jpeg')) return 'jpg';
  if (ct.includes('image/png')) return 'png';
  if (ct.includes('image/webp')) return 'webp';
  if (ct.includes('image/gif')) return 'gif';
  if (ct.includes('image/avif')) return 'avif';
  return 'jpg';
};

router.post('/upload', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image provided' });
    const { title } = req.body;
    if (!title) return res.status(400).json({ message: 'Title is required' });

    const wm = `\u00A9 ${req.user.name}`;

    const original = await uploadBuffer(req.file.buffer, {
      folder: 'mern-image-app/originals',
    });

    const watermarked = await uploadBuffer(req.file.buffer, {
      folder: 'mern-image-app/watermarked',
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
    });

    const shareToken = crypto.randomBytes(16).toString('hex');

    const image = await Image.create({
      title,
      imageUrl: watermarked.secure_url,
      cloudinaryId: watermarked.public_id,
      originalUrl: original.secure_url,
      originalCloudinaryId: original.public_id,
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

router.get('/my', protect, async (req, res) => {
  try {
    const images = await Image.find({ uploadedBy: req.user._id }).sort({ createdAt: -1 });
    res.json(images);
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/share/:token', async (req, res) => {
  try {
    const image = await Image.findOne({ shareToken: req.params.token });
    if (!image) return res.status(404).json({ message: 'Image not found' });
    res.json(image);
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/download', protect, async (req, res) => {
  try {
    const variant = String(req.query.variant || 'watermarked').toLowerCase();
    if (!['watermarked', 'original'].includes(variant)) {
      return res.status(400).json({ message: 'Invalid variant. Use "watermarked" or "original".' });
    }

    const image = await Image.findById(req.params.id);
    if (!image) return res.status(404).json({ message: 'Image not found' });

    if (image.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to download this image' });
    }

    const sourceUrl = variant === 'original' ? image.originalUrl : image.imageUrl;
    if (!sourceUrl) {
      return res.status(409).json({ message: 'Original file is not available for this image.' });
    }

    const upstream = await fetch(sourceUrl);
    if (!upstream.ok) {
      return res.status(502).json({ message: 'Failed to fetch image from storage' });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const ext = extFromContentType(contentType);
    const safeBase = sanitizeFilenameBase(image.title);
    const filename = `${safeBase}-${variant}.${ext}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (!upstream.body) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      return res.end(buffer);
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ message: 'Download failed', error: err.message });
  }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) return res.status(404).json({ message: 'Image not found' });

    if (image.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this image' });
    }

    if (image.originalCloudinaryId) {
      await cloudinary.uploader.destroy(image.originalCloudinaryId);
    }
    await cloudinary.uploader.destroy(image.cloudinaryId);

    await image.deleteOne();

    res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: 'Delete failed', error: err.message });
  }
});

export default router;
