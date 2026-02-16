import multer from "multer";
import path from "path";
import { createID } from "../utils/nanoID.js";

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${createID()}${ext}`);
    }
});

export const upload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 }
});
