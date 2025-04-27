const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// Đảm bảo thư mục uploads tồn tại
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const app = express();
app.use(express.json());
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Kết nối MongoDB
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost/nfc_cards")
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });

// Schema và Model
const cardSchema = new mongoose.Schema({
  tag_id: { type: String, unique: true, required: true },
  user_id: { type: String, required: true },
  name: { type: String, required: true },
  wallet_address: { type: String, required: true },
  avatar_url: String,
  explorer_link: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});
const Card = mongoose.model("Card", cardSchema);

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password_hash: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
});
const User = mongoose.model("User", userSchema);

// Cấu hình Multer để tải lên hình ảnh
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // Giới hạn 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Chỉ chấp nhận file hình ảnh!"));
    }
  },
});

// Middleware xác thực JWT
const authenticate = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Vui lòng đăng nhập" });
  jwt.verify(
    token,
    process.env.JWT_SECRET || "your_secret_key",
    (err, decoded) => {
      if (err) return res.status(401).json({ error: "Token không hợp lệ" });
      req.user_id = decoded.user_id;
      next();
    }
  );
};

// API đăng ký người dùng
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  console.log("Register request:", { email });
  if (!email || !password)
    return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const user = new User({ email, password_hash });
    await user.save();
    res.status(201).json({ message: "Đăng ký thành công" });
  } catch (error) {
    console.error("Register error:", error.message);
    res.status(400).json({ error: "Email đã tồn tại" });
  }
});

// API đăng nhập
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  console.log("Login request:", { email });
  if (!email || !password)
    return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
    }
    const token = jwt.sign(
      { user_id: user._id },
      process.env.JWT_SECRET || "your_secret_key",
      { expiresIn: "1h" }
    );
    res.json({ token });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// API liên kết thẻ NFC
app.post(
  "/cards/register",
  authenticate,
  upload.single("avatar"),
  async (req, res) => {
    const { tag_id, name, wallet_address } = req.body;
    const avatar_url = req.file ? `/uploads/${req.file.filename}` : "";
    console.log("Card register request:", {
      tag_id,
      name,
      wallet_address,
      avatar_url,
    });
    if (!tag_id || !name || !wallet_address) {
      return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin" });
    }
    try {
      const explorer_link = `https://blockexplorer.minepi.com/mainnet/accounts/${wallet_address}`;
      const card = new Card({
        tag_id,
        user_id: req.user_id,
        name,
        wallet_address,
        avatar_url,
        explorer_link,
      });
      await card.save();
      res.status(201).json({ message: "Thẻ đã được đăng ký", card });
    } catch (error) {
      console.error("Card register error:", error.message);
      res
        .status(400)
        .json({ error: "Tag ID đã tồn tại hoặc dữ liệu không hợp lệ" });
    }
  }
);

// API cập nhật dữ liệu thẻ
app.put(
  "/cards/:tag_id",
  authenticate,
  upload.single("avatar"),
  async (req, res) => {
    const { tag_id } = req.params;
    const { name, wallet_address } = req.body;
    console.log("Card update request:", { tag_id, name, wallet_address });
    if (!name || !wallet_address) {
      return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin" });
    }
    const updateData = {
      name,
      wallet_address,
      explorer_link: `https://blockexplorer.minepi.com/mainnet/accounts/${wallet_address}`,
      updated_at: Date.now(),
    };
    if (req.file) updateData.avatar_url = `/uploads/${req.file.filename}`;
    try {
      const card = await Card.findOneAndUpdate(
        { tag_id, user_id: req.user_id },
        updateData,
        { new: true }
      );
      if (!card)
        return res
          .status(404)
          .json({ error: "Thẻ không tồn tại hoặc bạn không có quyền" });
      res.json({ message: "Thẻ đã được cập nhật", card });
    } catch (error) {
      console.error("Card update error:", error.message);
      res.status(500).json({ error: "Lỗi server" });
    }
  }
);

// API lấy thông tin thẻ
app.get("/cards/:tag_id", async (req, res) => {
  const { tag_id } = req.params;
  console.log("Get card request:", { tag_id });
  try {
    const card = await Card.findOne({ tag_id });
    if (!card) return res.status(404).json({ error: "Thẻ không tồn tại" });
    res.json(card);
  } catch (error) {
    console.error("Get card error:", error.message);
    res.status(500).json({ error: "Lỗi server" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
