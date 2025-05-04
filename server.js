const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Phục vụ file tĩnh từ thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// Kết nối MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://<user>:<pass>@cluster0.mongodb.net/pi_wallet?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Schema và Model
const userSchema = new mongoose.Schema({
  tag_id: { type: String, unique: true },
  name: String,
  wallet_address: String,
  avatar: String,
  pidoge_balance: { type: Number, default: 0 },
  tlk_balance: { type: Number, default: 0 },
  last_check_in: Date,
  check_in_history: [Date],
  referrals: [{ type: String }],
});

const User = mongoose.model('User', userSchema);

// API lấy thông tin người dùng
app.get('/api/user/:tagId', async (req, res) => {
  try {
    const user = await User.findOne({ tag_id: req.params.tagId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API điểm danh
app.post('/api/checkin/:tagId', async (req, res) => {
  try {
    const user = await User.findOne({ tag_id: req.params.tagId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date();
    const lastCheckIn = user.last_check_in ? new Date(user.last_check_in) : null;
    const oneDay = 24 * 60 * 60 * 1000;

    if (lastCheckIn && now - lastCheckIn < oneDay) {
      return res.status(400).json({ error: 'Already checked in today' });
    }

    user.pidoge_balance += 10;
    user.tlk_balance += 5;
    user.last_check_in = now;
    user.check_in_history.push(now);

    await user.save();

    // Thưởng cho người mời
    if (user.referrals.length > 0) {
      const referrer = await User.findOne({ tag_id: user.referrals[0] });
      if (referrer) {
        referrer.pidoge_balance += 1.5;
        referrer.tlk_balance += 0.75;
        await referrer.save();
      }
    }

    res.json({
      pidoge_balance: user.pidoge_balance,
      tlk_balance: user.tlk_balance,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chạy server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
