
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

// --------------------------------------------------
// UPLOAD CONFIGURATION
// --------------------------------------------------

const uploadFolder = path.join(__dirname, "uploads");

fs.mkdirSync(uploadFolder, { recursive: true });

const upload = multer({
    dest: uploadFolder,
    limits: {
        files: 5,
        fileSize: 25 * 1024 * 1024
    }
});

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Microplastic Detection Backend is running!"
    });
});

// --------------------------------------------------
// ANALYZE IMAGES USING PYTHON AI SERVICE
// --------------------------------------------------

app.post(
    "/api/analyze",
    upload.array("images", 5),
    async (req, res) => {
        const uploadStreams = [];

        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "No images uploaded."
                });
            }

            console.log(
                `Received ${req.files.length} image(s).`
            );

            const aiServiceUrl =
                process.env.AI_SERVICE_URL;

            if (!aiServiceUrl) {
                throw new Error(
                    "AI_SERVICE_URL environment variable is missing."
                );
            }

            const aiUrl =
                `${aiServiceUrl.replace(/\/+$/, "")}/predict`;

            console.log("AI endpoint:", aiUrl);

            const formData = new FormData();

            for (const file of req.files) {
                const stream = fs.createReadStream(file.path);

                uploadStreams.push(stream);

                formData.append("images", stream, {
                    filename: file.originalname,
                    contentType: file.mimetype
                });
            }

            console.log(
                "Sending images to Python AI service..."
            );

            const pythonResponse = await axios.post(
                aiUrl,
                formData,
                {
                    headers: formData.getHeaders(),
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    timeout: 300000
                }
            );

            console.log(
                "AI response status:",
                pythonResponse.status
            );

            const result = pythonResponse.data;

            if (!result || result.success !== true) {
                console.error(
                    "AI returned an unsuccessful result:",
                    result
                );

                return res.status(502).json({
                    success: false,
                    message:
                        result?.message ||
                        "The AI service did not complete the analysis."
                });
            }

            // Save successful analysis to SQLite.
            try {
                saveAnalysis.run(
                    new Date().toISOString(),
                    Number(
                        result.total_images ?? req.files.length
                    ),
                    Number(result.total_particles ?? 0),
                    JSON.stringify(result.counts ?? {}),
                    JSON.stringify(result.results ?? [])
                );

                console.log("Analysis saved to history.");
            } catch (dbError) {
                console.error(
                    "Could not save analysis history:",
                    dbError.message
                );
            }

            return res.json(result);

        } catch (error) {
            console.error(
                "Analysis error:",
                error.message
            );

            console.error(
                "Axios error code:",
                error.code || "Not provided"
            );

            console.error(
                "AI HTTP status:",
                error.response?.status || "No HTTP response"
            );

            console.error(
                "AI response body:",
                error.response?.data || "No response body"
            );

            const isTimeout =
                error.code === "ECONNABORTED" ||
                error.code === "ETIMEDOUT";

            const statusCode = isTimeout
                ? 504
                : error.response
                    ? 502
                    : 502;

            return res.status(statusCode).json({
                success: false,
                message: isTimeout
                    ? "Python AI service timed out while processing the images."
                    : "The backend could not complete the request to the Python AI service.",
                error: error.response?.data?.message ||
                    error.message
            });

        } finally {
            // Close streams and remove temporary uploaded files.
            for (const stream of uploadStreams) {
                if (!stream.destroyed) {
                    stream.destroy();
                }
            }

            if (req.files) {
                for (const file of req.files) {
                    try {
                        if (fs.existsSync(file.path)) {
                            fs.unlinkSync(file.path);
                        }
                    } catch (cleanupError) {
                        console.error(
                            "Upload cleanup failed:",
                            cleanupError.message
                        );
                    }
                }
            }
        }
    }
);

// --------------------------------------------------
// GET ALL ANALYSIS HISTORY
// --------------------------------------------------

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

        return res.json({
            success: true,
            total_records: history.length,
            history
        });

    } catch (error) {
        console.error(
            "History retrieval error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Could not retrieve analysis history."
        });
    }
});

// --------------------------------------------------
// GET ONE ANALYSIS BY ID
// --------------------------------------------------

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

        return res.json({
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
        console.error(
            "History detail error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Could not retrieve this analysis."
        });
    }
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Node.js server listening on port ${PORT}`
    );

    console.log(
        "AI_SERVICE_URL configured:",
        Boolean(process.env.AI_SERVICE_URL)
    );
});
