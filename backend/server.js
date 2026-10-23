const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const {
    saveAnalysis,
    getHistory,
    db
} = require("./database");

const app = express();


app.use(cors());
app.use(express.json());

// Upload configuration
const uploadFolder = path.join(__dirname, "uploads");
fs.mkdirSync(uploadFolder, { recursive: true });

const upload = multer({ dest: uploadFolder });

// Home route
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Microplastic Detection Backend is running!"
    });
});

// Analyze images
app.post("/api/analyze", upload.array("images"), async (req, res) => {
    let pythonResponse;

    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No images uploaded."
            });
        }

        console.log(`Received ${req.files.length} image(s).`);

        const formData = new FormData();

        for (const file of req.files) {
            formData.append("images", fs.createReadStream(file.path), {
                filename: file.originalname,
                contentType: file.mimetype
            });
        }

        const aiServiceUrl = process.env.AI_SERVICE_URL;

        if (!aiServiceUrl) {
            throw new Error("AI_SERVICE_URL environment variable is missing");
        }

        pythonResponse = await axios.post(
            `${aiServiceUrl.replace(/\/+$/, "")}/predict`,
            formData,
            {
                headers: formData.getHeaders(),
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 120000
            }
        );

        const result = pythonResponse.data;

        // Save only successful analysis responses
        if (result && result.success === true) {
            try {
                saveAnalysis.run(
                    new Date().toISOString(),
                    Number(result.total_images ?? req.files.length),
                    Number(result.total_particles ?? 0),
                    JSON.stringify(result.counts ?? {}),
                    JSON.stringify(result.results ?? [])
                );

                console.log("Analysis saved to history.");
            } catch (dbError) {
                // A history error should not discard successful detection.
                console.error("Could not save analysis history:", dbError.message);
            }
        }

        return res.json(result);

    } catch (error) {
        console.error("Analysis error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Could not connect to Python AI service.",
            error: error.message
        });

    } finally {
        // Always clean up temporary Node upload files
        if (req.files) {
            for (const file of req.files) {
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (cleanupError) {
                    console.error("Upload cleanup failed:", cleanupError.message);
                }
            }
        }
    }
});


// Get all saved analyses
app.get("/api/history", (req, res) => {
    try {
        const rows = getHistory.all();

        const history = rows.map(row => ({
            id: row.id,
            analyzed_at: row.analyzed_at,
            total_images: row.total_images,
            total_particles: row.total_particles,
            counts: JSON.parse(row.counts_json),
            results: JSON.parse(row.results_json)
        }));

        res.json({
            success: true,
            total_records: history.length,
            history
        });

    } catch (error) {
        console.error("History retrieval error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not retrieve analysis history."
        });
    }
});

// Get one saved analysis by ID
app.get("/api/history/:id", (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid history ID."
            });
        }

        const row = db.prepare(`
            SELECT * FROM analysis_history WHERE id = ?
        `).get(id);

        if (!row) {
            return res.status(404).json({
                success: false,
                message: "Analysis record not found."
            });
        }

        res.json({
            success: true,
            history: {
                id: row.id,
                analyzed_at: row.analyzed_at,
                total_images: row.total_images,
                total_particles: row.total_particles,
                counts: JSON.parse(row.counts_json),
                results: JSON.parse(row.results_json)
            }
        });

    } catch (error) {
        console.error("History detail error:", error.message);

        res.status(500).json({
            success: false,
            message: "Could not retrieve this analysis."
        });
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Node.js server listening on port ${PORT}`);
});