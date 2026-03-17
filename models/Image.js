import mongoose from 'mongoose';

const imageSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  imageUrl: {
    type: String,
    required: true,
  },
  cloudinaryId: {
    type: String,
    required: true,
  },
  originalUrl: {
    type: String,
  },
  originalCloudinaryId: {
    type: String,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  uploaderName: {
    type: String,
    required: true,
  },
  shareToken: {
    type: String,
    unique: true,
    required: true,
  },
}, { timestamps: true });

export default mongoose.model('Image', imageSchema);
